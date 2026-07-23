/**
 * Knowledge Ledger (知識台帳) — GUIDE_DEEPDIVE_DESIGN.md の心臓部。
 * ガイドに書く具体値をすべて「出典つきの事実」として confirmed / assumed / unknown の
 * 3状態で管理し、取材ループ（P2）の差分取り込み・準備度採点・台帳突合を機械化する。
 * 台帳にない具体値はガイドに書けない（§4.4 の不変条件）。
 */
const LEDGER_SLOTS = Object.freeze([
  { slot: 'url', label: '開く画面のURL', required: true },
  { slot: 'ui_label', label: '画面表記どおりの操作名', required: true },
  { slot: 'input_value', label: '入力・設定する値', required: true },
  { slot: 'verification', label: '客観的な完了確認', required: true },
  { slot: 'precondition', label: '必要な権限・事前状態', required: true },
  { slot: 'failure_recovery', label: '失敗時の確認とやり直し', required: false },
  { slot: 'caution', label: '不可逆・課金・秘密情報の注意', required: false },
  { slot: 'decision_rule', label: '判断の選択肢と基準', required: false },
  { slot: 'scope', label: 'このステップで変わらないこと', required: false }
]);

const LEDGER_CONFIDENCES = Object.freeze(['confirmed', 'assumed', 'unknown']);
const LEDGER_EVIDENCE_TYPES = Object.freeze(['transcript', 'user_answer', 'artifact', 'ai_knowledge']);

function ledgerSlotKeys_() {
  return LEDGER_SLOTS.map(function (item) { return item.slot; });
}

function ledgerRequiredSlotKeys_() {
  return LEDGER_SLOTS.filter(function (item) { return item.required; }).map(function (item) { return item.slot; });
}

function ledgerSlotLabel_(slot) {
  const found = LEDGER_SLOTS.filter(function (item) { return item.slot === slot; })[0];
  return found ? found.label : slot;
}

function nextLedgerEntryId_(entries) {
  let max = 0;
  (entries || []).forEach(function (entry) {
    const match = String(entry.entryId || '').match(/^L-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return 'L-' + String(max + 1).padStart(3, '0');
}

// AI回答・貼り付けエントリを台帳スキーマ（§4.1）へ正規化する。claim と有効な slot /
// confidence だけを必須とし、形式ゆれは既定値で吸収して取材ループを止めない。
function normalizeLedgerEntry_(raw, skipped, position) {
  if (!isPlainObject_(raw)) {
    skipped.push('エントリ' + position + ': オブジェクトではないため無視しました。');
    return null;
  }
  const claim = nonEmptyString_(raw.claim) ? raw.claim.trim() : '';
  if (!claim) {
    skipped.push('エントリ' + position + ': claim が無いため無視しました。');
    return null;
  }
  const slot = String(raw.slot || '').trim();
  if (ledgerSlotKeys_().indexOf(slot) < 0) {
    skipped.push('エントリ' + position + '「' + claim.slice(0, 30) + '」: slot「' + slot + '」が不正なため無視しました。');
    return null;
  }
  let confidence = LEDGER_CONFIDENCES.indexOf(String(raw.confidence || '').trim()) >= 0 ? String(raw.confidence).trim() : 'unknown';
  const evidence = isPlainObject_(raw.evidence) ? raw.evidence : {};
  const evidenceType = LEDGER_EVIDENCE_TYPES.indexOf(String(evidence.type || '').trim()) >= 0
    ? String(evidence.type).trim()
    : (confidence === 'assumed' ? 'ai_knowledge' : 'transcript');
  const value = raw.value === undefined || raw.value === null ? '' : String(raw.value).trim();
  if (confidence === 'confirmed' && !value) confidence = 'unknown';
  if (confidence === 'confirmed' && evidenceType === 'ai_knowledge') confidence = 'assumed';
  return {
    entryId: nonEmptyString_(raw.entryId) ? String(raw.entryId).trim() : '',
    stepRef: nonEmptyString_(raw.stepRef) ? String(raw.stepRef).trim() : '',
    slot: slot,
    claim: claim,
    value: value,
    evidence: {
      type: evidenceType,
      ref: nonEmptyString_(evidence.ref) ? String(evidence.ref).trim() : '',
      quote: nonEmptyString_(evidence.quote) ? String(evidence.quote).trim() : ''
    },
    confidence: confidence,
    note: nonEmptyString_(raw.note) ? String(raw.note).trim() : '',
    deferred: raw.deferred === true,
    updatedAt: nowIso_()
  };
}

// 取材ラウンドの台帳差分を既存台帳へ取り込む。entryId 一致で更新、それ以外は追加。
// confirmed へ更新されたエントリは降格状態を自動解除する。
function applyLedgerDiff_(entries, diffEntries) {
  const ledger = Array.isArray(entries) ? entries.slice() : [];
  const skipped = [];
  let added = 0;
  let updated = 0;
  (Array.isArray(diffEntries) ? diffEntries : []).forEach(function (raw, index) {
    const normalized = normalizeLedgerEntry_(raw, skipped, index + 1);
    if (!normalized) return;
    const existing = normalized.entryId ? ledger.filter(function (entry) { return String(entry.entryId) === normalized.entryId; })[0] : null;
    if (existing) {
      existing.stepRef = normalized.stepRef || existing.stepRef;
      existing.slot = normalized.slot;
      existing.claim = normalized.claim;
      if (normalized.value) existing.value = normalized.value;
      if (normalized.evidence.ref || normalized.evidence.quote || normalized.confidence !== existing.confidence) existing.evidence = normalized.evidence;
      existing.confidence = normalized.confidence;
      if (normalized.note) existing.note = normalized.note;
      if (existing.confidence === 'confirmed') existing.deferred = false;
      else if (raw.deferred === true) existing.deferred = true;
      existing.updatedAt = normalized.updatedAt;
      updated += 1;
    } else {
      normalized.entryId = normalized.entryId && !ledger.some(function (entry) { return String(entry.entryId) === normalized.entryId; })
        ? normalized.entryId
        : nextLedgerEntryId_(ledger);
      ledger.push(normalized);
      added += 1;
    }
  });
  return { entries: ledger, added: added, updated: updated, skipped: skipped };
}

/**
 * 準備度採点（§6）。ステップ×スロットの充足を機械計算し、ヒートマップ表示用の
 * 状態と、ゲート通過可否（confirmed または明示的な降格に全件が落ちているか）を返す。
 */
function computeLedgerReadiness_(skeleton, entries) {
  const skeletonSteps = skeleton && Array.isArray(skeleton.steps) ? skeleton.steps : [];
  const ledger = Array.isArray(entries) ? entries : [];
  const byStepSlot = {};
  ledger.forEach(function (entry) {
    const stepKey = entry.stepRef || '';
    if (!byStepSlot[stepKey]) byStepSlot[stepKey] = {};
    if (!byStepSlot[stepKey][entry.slot]) byStepSlot[stepKey][entry.slot] = [];
    byStepSlot[stepKey][entry.slot].push(entry);
  });
  const slotState = function (slotEntries) {
    if (!slotEntries || !slotEntries.length) return 'missing';
    if (slotEntries.some(function (entry) { return entry.confidence === 'confirmed'; })) return 'confirmed';
    if (slotEntries.every(function (entry) { return entry.deferred === true; })) return 'deferred';
    if (slotEntries.some(function (entry) { return entry.confidence === 'assumed' && entry.deferred !== true; })) return 'assumed';
    return 'unknown';
  };
  const requiredBase = ledgerRequiredSlotKeys_();
  const steps = [];
  const holes = [];
  let totalRequired = 0;
  let totalConfirmed = 0;
  let gatePassed = skeletonSteps.length > 0;
  skeletonSteps.forEach(function (step) {
    const stepKey = String(step.skeletonId || '');
    const stepEntries = byStepSlot[stepKey] || {};
    const slots = {};
    let requiredCount = 0;
    let confirmedCount = 0;
    ledgerSlotKeys_().forEach(function (slot) {
      const state = slotState(stepEntries[slot]);
      slots[slot] = state;
      const required = requiredBase.indexOf(slot) >= 0 || (stepEntries[slot] && stepEntries[slot].length > 0);
      if (!required) return;
      requiredCount += 1;
      if (state === 'confirmed') confirmedCount += 1;
      if (state !== 'confirmed' && state !== 'deferred') {
        gatePassed = false;
        holes.push({ skeletonId: stepKey, title: String(step.title || ''), slot: slot, state: state });
      }
    });
    totalRequired += requiredCount;
    totalConfirmed += confirmedCount;
    steps.push({
      skeletonId: stepKey, title: String(step.title || ''), slots: slots,
      requiredCount: requiredCount, confirmedCount: confirmedCount,
      score: requiredCount ? Math.round((confirmedCount / requiredCount) * 100) : 100
    });
  });
  // ステップ列に紐付かない一般エントリも、未解消のまま黙って消えることはない（§4.4）。
  const openEntries = ledger.filter(function (entry) { return entry.confidence !== 'confirmed' && entry.deferred !== true; });
  const knownStepIds = {};
  skeletonSteps.forEach(function (step) { knownStepIds[String(step.skeletonId || '')] = true; });
  openEntries.forEach(function (entry) {
    if (!knownStepIds[entry.stepRef || '']) {
      gatePassed = false;
      holes.push({ skeletonId: entry.stepRef || '全般', title: entry.claim.slice(0, 30), slot: entry.slot, state: entry.confidence });
    }
  });
  return {
    steps: steps,
    overallScore: totalRequired ? Math.round((totalConfirmed / totalRequired) * 100) : 0,
    gatePassed: gatePassed,
    holes: holes,
    openEntryIds: openEntries.map(function (entry) { return entry.entryId; }),
    confirmedCount: ledger.filter(function (entry) { return entry.confidence === 'confirmed'; }).length,
    deferredCount: ledger.filter(function (entry) { return entry.deferred === true; }).length,
    entryCount: ledger.length
  };
}

// AI がスロット自体を出し忘れた場合も、missing のまま操作不能にしない。
// 明示的な降格や全自動経路では、不足スロットを unknown エントリとして実体化してから扱う。
function materializeMissingLedgerEntries_(skeleton, entries, deferred, evidenceRef) {
  const ledger = Array.isArray(entries) ? entries : [];
  const steps = skeleton && Array.isArray(skeleton.steps) ? skeleton.steps : [];
  steps.forEach(function (step) {
    ledgerSlotKeys_().forEach(function (slot) {
      const exists = ledger.some(function (entry) {
        return String(entry.stepRef || '') === String(step.skeletonId || '') && String(entry.slot || '') === slot;
      });
      if (exists) return;
      ledger.push({
        entryId: nextLedgerEntryId_(ledger),
        stepRef: String(step.skeletonId || ''),
        slot: slot,
        claim: String(step.skeletonId || '') + '「' + String(step.title || '') + '」の' + ledgerSlotLabel_(slot),
        value: '',
        evidence: { type: 'user_answer', ref: evidenceRef || '不足スロットを明示', quote: '' },
        confidence: 'unknown',
        note: 'AIの台帳初期化でスロットが欠落したため、アプリが追加',
        deferred: deferred === true,
        updatedAt: nowIso_()
      });
    });
  });
  return ledger;
}

/**
 * 台帳突合（§7.3）。ガイド本文中の URL と evidenceRefs を抽出し、confirmed エントリに
 * 存在しないものを「出典不明の値」として返す。AIが最後の最後で創作を混ぜる事故を機械で止める。
 */
function assessGuideAgainstLedger_(guide, entries) {
  const errors = [];
  const ledger = Array.isArray(entries) ? entries : [];
  if (!isPlainObject_(guide) || !ledger.length) return errors;
  const allowedUrls = [];
  const deferredUrls = [];
  const confirmedById = {};
  const usedEvidenceRefs = {};
  const allowedConcreteText = [];
  const deferredConcreteText = [];
  ledger.forEach(function (entry) {
    if (entry.deferred === true) {
      [entry.claim, entry.value, entry.note].forEach(function (text) {
        extractUrls_(text).forEach(function (url) { deferredUrls.push(url); });
        if (nonEmptyString_(text)) deferredConcreteText.push(normalizeConcreteText_(text));
      });
    }
    if (entry.confidence !== 'confirmed') return;
    confirmedById[String(entry.entryId)] = entry;
    [entry.value, entry.note, entry.evidence && entry.evidence.quote].forEach(function (text) {
      extractUrls_(text).forEach(function (url) { allowedUrls.push(url); });
      if (nonEmptyString_(text)) allowedConcreteText.push(normalizeConcreteText_(text));
    });
  });
  const urlAllowed = function (url) {
    return allowedUrls.some(function (allowed) {
      return url === allowed || url.indexOf(allowed + '/') === 0 || url.indexOf(allowed + '?') === 0 || url.indexOf(allowed + '#') === 0;
    });
  };
  const deferredUrlAllowed = function (url) {
    return deferredUrls.some(function (allowed) {
      return url === allowed || url.indexOf(allowed + '/') === 0 || url.indexOf(allowed + '?') === 0 || url.indexOf(allowed + '#') === 0;
    });
  };
  const concreteGrounded = function (value, allowedTexts) {
    const normalized = normalizeConcreteText_(value);
    return allowedTexts.some(function (allowed) {
      return allowed.indexOf(normalized) >= 0 || normalized.indexOf(allowed) >= 0;
    });
  };
  (Array.isArray(guide.steps) ? guide.steps : []).forEach(function (step) {
    if (!isPlainObject_(step)) return;
    const label = '手順' + (step.order || '?') + '「' + String(step.title || '').slice(0, 30) + '」';
    if (!nonEmptyString_(step.scopeNote)) errors.push(label + ': scopeNote（このステップで変わらないこと）がありません。');
    if (!isPlainObject_(step.verification) || !nonEmptyString_(step.verification.detail)) errors.push(label + ': 構造化された verification がありません。');
    if (!isPlainObject_(step.failureRecovery) || !Array.isArray(step.failureRecovery.checks) || !step.failureRecovery.checks.length) {
      errors.push(label + ': 構造化された failureRecovery（失敗時の確認点）がありません。');
    }
    const evidenceRefs = Array.isArray(step.evidenceRefs) ? step.evidenceRefs : [];
    if (!evidenceRefs.length) errors.push(label + ': evidenceRefs が空です。使用した confirmed 台帳エントリを指定してください。');
    const stepUrls = extractUrls_(step.url)
      .concat(extractUrls_(step.description))
      .concat(extractUrls_(step.completionCriteria))
      .concat(extractUrls_(step.verification && step.verification.detail))
      .concat(extractUrls_(step.failureRecovery && step.failureRecovery.checks && step.failureRecovery.checks.join('\n')));
    stepUrls.forEach(function (url) {
      if (!urlAllowed(url)) errors.push(label + ': URL「' + url + '」は台帳の confirmed エントリに存在しません（出典不明の値）。台帳へ確認済みで追加するか、ガイドから削除してください。');
    });
    evidenceRefs.forEach(function (entryId) {
      usedEvidenceRefs[String(entryId)] = true;
      const entry = confirmedById[String(entryId)];
      if (!entry) errors.push(label + ': evidenceRefs の「' + entryId + '」は confirmed の台帳エントリではありません。');
    });
    const concreteText = [
      step.description, step.completionCriteria, step.verification && step.verification.detail,
      step.failureRecovery && step.failureRecovery.checks && step.failureRecovery.checks.join('\n')
    ].join('\n');
    extractMajorConcreteValues_(concreteText).forEach(function (value) {
      if (!concreteGrounded(value, allowedConcreteText)) errors.push(label + ': 具体値「' + value + '」は台帳の confirmed エントリに見つかりません。');
    });
  });
  ['assumptions', 'warnings'].forEach(function (field) {
    const text = (Array.isArray(guide[field]) ? guide[field] : []).join('\n');
    extractUrls_(text).forEach(function (url) {
      if (!urlAllowed(url)) errors.push(field + ' のURL「' + url + '」は台帳の confirmed エントリに存在しません。');
    });
    extractMajorConcreteValues_(text).forEach(function (value) {
      if (!concreteGrounded(value, allowedConcreteText)) errors.push(field + ' の具体値「' + value + '」は台帳の confirmed エントリに見つかりません。');
    });
  });
  const prerequisitesText = (Array.isArray(guide.prerequisites) ? guide.prerequisites : []).join('\n');
  extractUrls_(prerequisitesText).forEach(function (url) {
    if (!urlAllowed(url) && !deferredUrlAllowed(url)) errors.push('prerequisites のURL「' + url + '」は confirmed または明示的に降格した台帳エントリに存在しません。');
  });
  extractMajorConcreteValues_(prerequisitesText).forEach(function (value) {
    if (!concreteGrounded(value, allowedConcreteText) && !concreteGrounded(value, deferredConcreteText)) {
      errors.push('prerequisites の具体値「' + value + '」は confirmed または明示的に降格した台帳エントリに見つかりません。');
    }
  });
  ledger.filter(function (entry) { return entry.deferred === true; }).forEach(function (entry) {
    if (prerequisitesText.indexOf(String(entry.claim || '')) < 0) {
      errors.push('作業前に確認へ降格した「' + entry.claim + '」が prerequisites に明示されていません。');
    } else if (nonEmptyString_(entry.value) && prerequisitesText.indexOf(String(entry.value)) < 0) {
      errors.push('降格した「' + entry.claim + '」の現時点の見立て「' + entry.value + '」が prerequisites に明示されていません。');
    }
  });
  ledger.filter(function (entry) {
    return entry.confidence === 'confirmed' && nonEmptyString_(entry.stepRef);
  }).forEach(function (entry) {
    if (!usedEvidenceRefs[String(entry.entryId)]) {
      errors.push('confirmed 台帳エントリ「' + entry.entryId + ' / ' + entry.claim + '」がどの手順の evidenceRefs にも使われていません。');
    }
  });
  return errors.filter(function (error, index) { return errors.indexOf(error) === index; });
}

function extractUrls_(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>）)、。」\]]+/g) || [];
  return matches.map(function (url) { return url.replace(/[\/.,]+$/, ''); });
}

function extractMajorConcreteValues_(text) {
  const values = [];
  const source = String(text || '');
  [
    /「([^」\n]{2,100})」/g,
    /`([^`\n]{2,160})`/g
  ].forEach(function (pattern) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const value = String(match[1] || '').trim();
      if (value && !/^作業前に確認/.test(value) && values.indexOf(value) < 0) values.push(value);
    }
  });
  return values;
}

function normalizeConcreteText_(text) {
  return String(text || '').replace(/\s+/g, '').toLowerCase();
}

function parseFencedJsonBlocks_(rawText) {
  const blocks = [];
  const pattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = pattern.exec(String(rawText || ''))) !== null) {
    try { blocks.push(JSON.parse(match[1].trim())); } catch (error) { /* JSON以外のコードブロックは無視 */ }
  }
  return blocks;
}

// P1（骨格抽出＋台帳初期化）の回答から skeleton と ledger を取り出す。
function normalizeSkeletonLedgerResult_(found) {
  assertApp_(isPlainObject_(found) && isPlainObject_(found.skeleton) && Array.isArray(found.ledger), 'SKELETON_PARSE_ERROR', '骨格と台帳は {"skeleton": …, "ledger": […]} の形式で必要です。');
  const skeletonRaw = found.skeleton;
  const steps = (Array.isArray(skeletonRaw.steps) ? skeletonRaw.steps : []).map(function (step, index) {
    return {
      skeletonId: nonEmptyString_(step && step.skeletonId) ? String(step.skeletonId).trim() : 'SK-' + (index + 1),
      title: nonEmptyString_(step && step.title) ? String(step.title).trim() : '手順' + (index + 1)
    };
  });
  assertApp_(steps.length, 'SKELETON_PARSE_ERROR', '骨格のステップ列（skeleton.steps）が空です。');
  const skeleton = {
    purpose: nonEmptyString_(skeletonRaw.purpose) ? String(skeletonRaw.purpose).trim() : '',
    completion: nonEmptyString_(skeletonRaw.completion) ? String(skeletonRaw.completion).trim() : '',
    steps: steps,
    outOfScope: Array.isArray(skeletonRaw.outOfScope) ? skeletonRaw.outOfScope.filter(nonEmptyString_) : []
  };
  const applied = applyLedgerDiff_([], found.ledger);
  return { skeleton: skeleton, entries: applied.entries, skipped: applied.skipped };
}

function parseSkeletonLedgerReply_(rawText) {
  const blocks = parseFencedJsonBlocks_(rawText);
  const found = blocks.filter(function (block) {
    return isPlainObject_(block) && isPlainObject_(block.skeleton) && Array.isArray(block.ledger);
  })[0];
  assertApp_(found, 'SKELETON_PARSE_ERROR', 'AI回答から骨格と台帳のJSONブロックを読み取れません。プロンプトの指定どおり {"skeleton": …, "ledger": […]} を含む ```json ブロックがあるか確認してください。');
  return normalizeSkeletonLedgerResult_(found);
}

// P2（取材ラウンド）の回答から台帳差分と「## 6. 次の質問」を取り出す。
function parseInterviewReply_(rawText) {
  const text = String(rawText || '');
  const blocks = parseFencedJsonBlocks_(text);
  let diffEntries = [];
  blocks.some(function (block) {
    if (Array.isArray(block)) { diffEntries = block; return true; }
    if (isPlainObject_(block) && Array.isArray(block.entries)) { diffEntries = block.entries; return true; }
    if (isPlainObject_(block) && Array.isArray(block.ledger)) { diffEntries = block.ledger; return true; }
    return false;
  });
  return { diffEntries: diffEntries, questions: parseInterviewQuestions_(text), sections: parseInterviewSections_(text) };
}

function parseInterviewSections_(text) {
  const sections = {};
  const titles = { '1': 'echo', '2': 'ledger', '3': 'contradictions', '4': 'assumedAudit', '5': 'readiness', '6': 'questions' };
  const pattern = /^##\s*([1-6])[^\n]*$/gm;
  const found = [];
  let match;
  while ((match = pattern.exec(text)) !== null) found.push({ number: match[1], start: match.index, bodyStart: match.index + match[0].length });
  found.forEach(function (section, index) {
    const end = index + 1 < found.length ? found[index + 1].start : text.length;
    sections[titles[section.number]] = text.slice(section.bodyStart, end).trim();
  });
  return sections;
}

function parseInterviewQuestions_(text) {
  const sections = parseInterviewSections_(text);
  const body = sections.questions || '';
  if (!body.trim()) return [];
  const chunks = body.split(/\n(?=\s*(?:[>＞]?\s*)?(?:Q\s*\d|質問\s*\d|\d+\s*[\.．)]))/);
  const questions = [];
  chunks.forEach(function (chunk) {
    const trimmed = chunk.trim();
    if (!trimmed || !/^(?:[>＞]?\s*)?(?:Q\s*\d|質問\s*\d|\d+\s*[\.．)])/.test(trimmed)) return;
    const tag = trimmed.match(/\[\s*対象\s*[:：]\s*([^\/\]]+?)\s*\/\s*スロット\s*[:：]\s*([a-z_]+)\s*\]/);
    questions.push({
      questionId: 'Q' + (questions.length + 1),
      text: trimmed,
      stepRef: tag ? tag[1].trim() : '',
      slot: tag && ledgerSlotKeys_().indexOf(tag[2].trim()) >= 0 ? tag[2].trim() : ''
    });
  });
  const limit = APP_CONFIG.ledgerInterview && APP_CONFIG.ledgerInterview.maxQuestionsPerRound
    ? Number(APP_CONFIG.ledgerInterview.maxQuestionsPerRound)
    : 5;
  return questions.slice(0, limit);
}

// P4（机上実行レビュー）の回答を解析する。手動貼り付け（トレース文＋jsonブロック）と
// API自動（JSONオブジェクトのみ）の両方を受け付ける。
function parseDeskReviewReply_(rawText) {
  const text = String(rawText || '');
  let parsed = null;
  try { parsed = JSON.parse(text.trim()); } catch (error) { /* 貼り付けはブロック探索へ */ }
  const blocks = parsed ? [parsed] : parseFencedJsonBlocks_(text);
  let findings = [];
  let trace = [];
  let passedFlag = null;
  blocks.some(function (block) {
    if (Array.isArray(block)) { findings = block; return true; }
    if (isPlainObject_(block) && (Array.isArray(block.findings) || typeof block.passed === 'boolean')) {
      findings = Array.isArray(block.findings) ? block.findings : [];
      trace = Array.isArray(block.trace) ? block.trace.filter(nonEmptyString_) : [];
      if (typeof block.passed === 'boolean') passedFlag = block.passed;
      return true;
    }
    return false;
  });
  const normalized = normalizeDeskReviewFindings_(findings);
  const passed = normalized.length === 0 && (passedFlag === true || /完走/.test(text));
  return { passed: passed, findings: normalized, trace: trace };
}

function normalizeDeskReviewFindings_(findings) {
  const typeToSlot = {
    MISSING_INFO: 'input_value', AMBIGUOUS_CHECK: 'verification', WRONG_ORDER: 'decision_rule',
    RISK_UNFLAGGED: 'caution', JARGON: 'ui_label'
  };
  return (Array.isArray(findings) ? findings : []).map(function (finding) {
    if (!isPlainObject_(finding) || !nonEmptyString_(finding.claim)) return null;
    const rawType = String(finding.type || '').trim().toUpperCase();
    const type = Object.prototype.hasOwnProperty.call(typeToSlot, rawType) ? rawType : 'MISSING_INFO';
    const slot = ledgerSlotKeys_().indexOf(String(finding.slot || '').trim()) >= 0
      ? String(finding.slot).trim()
      : (typeToSlot[type] || 'precondition');
    return {
      stepRef: nonEmptyString_(finding.stepRef) ? String(finding.stepRef).trim() : '',
      slot: slot,
      type: type,
      claim: String(finding.claim).trim()
    };
  }).filter(function (finding) { return finding !== null; });
}

// API自動経路の机上実行レビュー結果の検証（runAiJsonTask_ の validator として使う）。
function validateDeskReviewResult_(result) {
  const errors = [];
  if (!isPlainObject_(result)) errors.push('ルートは JSON オブジェクトです。');
  else {
    if (typeof result.passed !== 'boolean') errors.push('passed は真偽値です。');
    if (result.trace !== undefined && (!Array.isArray(result.trace) || result.trace.some(function (line) { return !nonEmptyString_(line); }))) errors.push('trace は文字列の配列です。');
    if (!Array.isArray(result.findings)) errors.push('findings は配列です（詰まりが無ければ空配列）。');
    if (result.passed === true && Array.isArray(result.findings) && result.findings.length) errors.push('passed=true の場合、findings は空配列です。');
    if (result.passed === false && Array.isArray(result.findings) && !result.findings.length) errors.push('passed=false の場合、findings に詰まりを1件以上入れてください。');
  }
  throwValidationErrors_(errors, '机上実行レビュー JSON');
  result.findings = normalizeDeskReviewFindings_(result.findings);
  if (result.passed === false && !result.findings.length) {
    throw new AppError('VALIDATION_ERROR', '机上実行レビュー JSON に有効な finding がありません。', { errors: ['findings[].claim は必須です。'] });
  }
  result.trace = Array.isArray(result.trace) ? result.trace.filter(nonEmptyString_) : [];
  return result;
}

// 全自動経路: 人へ質問できないため、机上実行レビューの詰まりは
// 「作業前に確認」へ自動降格して前提条件に明示する（§12）。
function applyDeskReviewFindingsToGuide_(guide, findings) {
  const prerequisites = Array.isArray(guide.prerequisites) ? guide.prerequisites : [];
  (findings || []).forEach(function (finding) {
    const line = '作業前に確認: ' + finding.claim + (finding.stepRef ? '（' + finding.stepRef + '）' : '');
    if (prerequisites.indexOf(line) < 0) prerequisites.push(line);
  });
  guide.prerequisites = prerequisites;
  return guide;
}
