/**
 * 手動ガイド作成フロー（GUIDE_DEEPDIVE_DESIGN.md 反映版）。
 * 書き直しループではなく、知識台帳を介した取材ループを中心に据える。
 * STEP 1 候補確認 / 2 既知の前提 / 3 参照資料 / 4 骨格・台帳初期化(P1) /
 * 5 取材ループ(P2×N) / 6 準備度ゲート→ガイド生成(P3) / 7 JSON取込（台帳突合） /
 * 8 机上実行レビュー(P4)・再調整 / 9 編集 / 10 保存
 */
const BUILD_STEP_COUNT = 10;

function startWorkGuideBuild(actionId, creationMode) {
  return withClientError_(function () {
    const action = requireAction_(actionId);
    assertApp_(String(action.status) !== 'guide_not_required', 'ACTION_NOT_GUIDE_TARGET', 'この作業候補はガイド対象から削除されています。');
    requirePassedQuizForMeeting_(action.meetingId);
    const requestedMode = creationMode === 'automatic' ? 'automatic' : 'manual';
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      let session = findRow_('WorkGuideBuildSessions', function (row) {
        return String(row.actionId) === String(actionId) && ['in_progress', 'draft'].indexOf(String(row.status)) >= 0;
      });
      if (!session) {
        const meeting = requireMeeting_(action.meetingId);
        const analysis = findRow_('MeetingAnalyses', function (row) { return String(row.meetingId) === String(action.meetingId); });
        const data = {
          action: {
            actionId: action.actionId, meetingId: action.meetingId, title: action.title,
            description: action.description, owner: action.owner, dueDate: action.dueDate
          },
          meeting: { meetingId: meeting.meetingId, title: meeting.title, summary: analysis ? analysis.summary : '' },
          knownPrerequisites: [],
          // 会議解析の前提質問は一問一答ではなく、台帳初期化（P1）の unknown 候補として使う。
          prerequisiteQuestions: parseJsonCell_(action.prerequisiteQuestionsJson, defaultPrerequisiteQuestions_()),
          selectedSources: [],
          skeleton: null,
          ledger: [],
          interviewRounds: [],
          pendingQuestions: [],
          questionAttempts: {},
          interviewSeeds: [],
          ledgerAudit: [],
          gatePassed: false,
          deskReview: null,
          importedWorkGuide: null,
          creationMode: requestedMode
        };
        session = {
          buildSessionId: createId_('BUILD'), actionId: action.actionId, meetingId: action.meetingId,
          currentStep: 1, status: 'in_progress', dataJson: data, createdAt: nowIso_(), updatedAt: nowIso_()
        };
        appendObject_('WorkGuideBuildSessions', session);
        updateRow_('Actions', action._rowNumber, { status: 'guide_building' });
      } else {
        const data = parseJsonCell_(session.dataJson, {});
        const legacyAutomatic = !data.creationMode && ['generating', 'failed'].indexOf(String(action.automationStatus)) >= 0;
        const currentMode = data.creationMode || (legacyAutomatic ? 'automatic' : 'manual');
        assertApp_(requestedMode !== 'automatic' || currentMode !== 'manual', 'MANUAL_BUILD_IN_PROGRESS', 'この作業候補は手動で作成中のため、自動生成の対象外です。');
        if (data.creationMode !== requestedMode) {
          data.creationMode = requestedMode;
          updateRow_('WorkGuideBuildSessions', session._rowNumber, { dataJson: data, updatedAt: nowIso_() });
          session.dataJson = data;
        }
      }
      return { success: true, session: hydrateBuildSession_(session) };
    } finally {
      lock.releaseLock();
    }
  });
}

function getWorkGuideBuildSession(buildSessionId) {
  return withClientError_(function () {
    return { success: true, session: hydrateBuildSession_(requireBuildSession_(buildSessionId)) };
  });
}

function startWorkGuideRevision(workGuideId) {
  return withClientError_(function () {
    const record = requireWorkGuideRecord_(workGuideId);
    requirePassedQuizForMeeting_(record.meetingId);
    const started = startWorkGuideBuild(record.actionId);
    assertApp_(started.success, started.code || 'BUILD_START_FAILED', started.error || '改訂セッションを開始できません。', started.details);
    const session = requireBuildSession_(started.session.buildSessionId);
    const data = parseJsonCell_(session.dataJson, {});
    const loaded = getWorkGuideOrThrow_(workGuideId, Number(record.currentVersion));
    data.importedWorkGuide = null;
    data.priorWorkGuide = loaded.guide;
    data.revisionWorkGuideId = String(record.workGuideId);
    data.selectedSources = loaded.guide.sourceSnapshots || [];
    // 実行フィードバック（§9.1）: ガイド外参照の記録を v2 取材ループの初期質問リストにする。
    data.interviewSeeds = collectExecutionExternalReferences_(record.workGuideId);
    // 同じ仕組みで作成した前版の台帳が残っていれば再利用し、実行時に増えた不足だけを取材する。
    const previousSessions = findRows_('WorkGuideBuildSessions', function (row) {
      return String(row.actionId) === String(record.actionId) && String(row.buildSessionId) !== String(session.buildSessionId) && String(row.status) === 'completed';
    }).sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
    if (previousSessions.length) {
      const previousData = parseJsonCell_(previousSessions[0].dataJson, {});
      if (isPlainObject_(previousData.skeleton) && Array.isArray(previousData.ledger)) {
        data.skeleton = JSON.parse(JSON.stringify(previousData.skeleton));
        data.ledger = JSON.parse(JSON.stringify(previousData.ledger));
        data.gatePassed = false;
        pushLedgerAudit_(data, 'revision_reuse', '前版の知識台帳' + data.ledger.length + '件を引き継ぎ');
      }
    }
    if (isPlainObject_(data.skeleton) && data.interviewSeeds.length) {
      const feedbackEntries = data.interviewSeeds.filter(function (seed) {
        const claim = '前回実行でガイド外参照: ' + String(seed.note || '');
        return !(data.ledger || []).some(function (entry) { return String(entry.claim) === claim; });
      }).map(function (seed) {
        return {
          stepRef: resolveDeskReviewStepRef_(data, seed.stepId || ''),
          slot: 'precondition',
          claim: '前回実行でガイド外参照: ' + String(seed.note || ''),
          value: '',
          confidence: 'unknown',
          evidence: { type: 'user_answer', ref: '実行 ' + String(seed.executionId || ''), quote: String(seed.note || '') }
        };
      });
      if (feedbackEntries.length) {
        data.ledger = applyLedgerDiff_(data.ledger || [], feedbackEntries).entries;
        pushLedgerAudit_(data, 'execution_feedback', '前回実行のガイド外参照' + feedbackEntries.length + '件を unknown として追加');
      }
    }
    const nextStep = isPlainObject_(data.skeleton) ? 5 : 4;
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: nextStep, status: 'in_progress', dataJson: data, updatedAt: nowIso_() });
    return { success: true, session: hydrateBuildSession_(Object.assign(session, { currentStep: nextStep, dataJson: data })) };
  });
}

function collectExecutionExternalReferences_(workGuideId) {
  const seeds = [];
  findRows_('WorkGuideExecutions', function (row) { return String(row.workGuideId) === String(workGuideId); }).forEach(function (row) {
    const data = parseJsonCell_(row.executionDataJson, {});
    (Array.isArray(data.externalReferences) ? data.externalReferences : []).forEach(function (reference) {
      seeds.push({
        executionId: String(row.executionId || ''),
        stepId: String(reference.stepId || ''),
        note: String(reference.note || ''),
        at: String(reference.at || '')
      });
    });
  });
  return seeds;
}

function saveWorkGuideBuildProgress(buildSessionId, step, patch) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const stepNumber = Number(step);
    assertApp_(Number.isInteger(stepNumber) && stepNumber >= 1 && stepNumber <= BUILD_STEP_COUNT, 'VALIDATION_ERROR', '作成ステップは1〜' + BUILD_STEP_COUNT + 'です。');
    const data = parseJsonCell_(session.dataJson, {});
    const allowedKeys = ['knownPrerequisites', 'selectedSources', 'importedWorkGuide'];
    Object.keys(patch || {}).forEach(function (key) {
      if (allowedKeys.indexOf(key) >= 0) data[key] = patch[key];
    });
    let effectiveStep = stepNumber;
    let deskReviewInvalidated = false;
    if (isPlainObject_(patch && patch.importedWorkGuide)) {
      validateWorkGuide_(patch.importedWorkGuide);
      if (isPlainObject_(data.skeleton) && Array.isArray(data.ledger)) {
        const ledgerErrors = assessGuideAgainstLedger_(patch.importedWorkGuide, data.ledger);
        assertApp_(!ledgerErrors.length, 'LEDGER_MISMATCH', '編集内容が知識台帳と一致しません。', { errors: ledgerErrors });
      }
      if (!data.deskReview || data.deskReview.guideFingerprint !== fingerprint_(patch.importedWorkGuide)) {
        data.deskReview = null;
        data.lastDeskReviewPrompt = '';
        effectiveStep = 8;
        deskReviewInvalidated = true;
      }
    }
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: effectiveStep, status: 'in_progress', dataJson: data, updatedAt: nowIso_() });
    return { success: true, deskReviewInvalidated: deskReviewInvalidated, session: Object.assign(hydrateBuildSession_(session), { currentStep: effectiveStep, data: data }) };
  });
}

// ---- STEP 4: 骨格抽出＋台帳初期化（P1） ----

function prepareGuideSkeletonPrompt(buildSessionId, fileIds, knownPrerequisites) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    const meeting = requireMeeting_(session.meetingId);
    // 情報源のベースは会議の文字起こし（設計の固定前提）。選択資料に必ず文字起こしを含める。
    const ids = [String(meeting.transcriptFileId)].concat(Array.isArray(fileIds) ? fileIds : []).filter(function (fileId, index, list) {
      return nonEmptyString_(fileId) && list.indexOf(fileId) === index;
    });
    const prepared = prepareWorkGuideContext_(data, ids, knownPrerequisites);
    data.lastSkeletonPrompt = buildGuideSkeletonPrompt_({
      action: data.action,
      meeting: data.meeting,
      knownPrerequisites: data.knownPrerequisites,
      prerequisiteQuestions: data.prerequisiteQuestions || [],
      interviewSeeds: data.interviewSeeds || [],
      priorWorkGuide: data.priorWorkGuide || null,
      selectedSources: prepared.context.selectedSources
    });
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 4, dataJson: data, updatedAt: nowIso_() });
    return { success: true, prompt: data.lastSkeletonPrompt, selectedSources: data.selectedSources };
  });
}

function importGuideSkeleton(buildSessionId, rawText) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(nonEmptyString_(data.lastSkeletonPrompt), 'SKELETON_PROMPT_REQUIRED', '先に骨格・台帳初期化プロンプトを作成し、生成AIの回答を取得してください。');
    assertApp_(nonEmptyString_(rawText), 'VALIDATION_ERROR', '生成AIの回答を貼り付けてください。');
    const parsed = parseSkeletonLedgerReply_(rawText);
    recordManualAiInteraction_({ meetingId: session.meetingId, actionId: session.actionId, buildSessionId: session.buildSessionId, phase: 'ledger_init' }, data.lastSkeletonPrompt, rawText, { valid: true, errors: [] });
    data.skeleton = parsed.skeleton;
    data.ledger = parsed.entries;
    data.interviewRounds = [];
    data.pendingQuestions = [];
    data.gatePassed = false;
    data.deskReview = null;
    pushLedgerAudit_(data, 'init', '台帳初期化: ' + parsed.entries.length + '件のエントリを登録' + (parsed.skipped.length ? '（' + parsed.skipped.length + '件を形式不備で無視）' : ''));
    const readiness = computeLedgerReadiness_(data.skeleton, data.ledger);
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 5, dataJson: data, updatedAt: nowIso_() });
    return { success: true, skeleton: data.skeleton, ledger: data.ledger, readiness: readiness, skipped: parsed.skipped };
  });
}

// ---- STEP 5: 取材ループ（P2） ----

function prepareLedgerInterviewPrompt(buildSessionId, answersText, deferrals) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(isPlainObject_(data.skeleton), 'SKELETON_REQUIRED', '先に STEP 4 で骨格と台帳を初期化してください。');
    const answers = nonEmptyString_(answersText) ? answersText.trim() : '';
    assertApp_(answers.length <= APP_CONFIG.ledgerInterview.maxAnswerCharacters, 'VALIDATION_ERROR', '回答は' + APP_CONFIG.ledgerInterview.maxAnswerCharacters + '文字以内にしてください。');
    // 「作業前に確認でよい」と答えたスロットは、この時点で正式に降格し以後質問させない（§5.3）。
    (Array.isArray(deferrals) ? deferrals : []).forEach(function (deferral) {
      if (!isPlainObject_(deferral)) return;
      deferLedgerSlot_(data, String(deferral.stepRef || ''), String(deferral.slot || ''), deferral.label || '');
    });
    if (Array.isArray(deferrals) && deferrals.length) {
      recordLedgerHumanAction_(session, '質問回答で作業前確認へ降格', deferrals);
    }
    data.lastInterviewPrompt = buildLedgerInterviewPrompt_({
      skeleton: data.skeleton,
      ledger: data.ledger || [],
      previousQuestions: data.pendingQuestions || [],
      questionAttempts: data.questionAttempts || {},
      interviewRounds: data.interviewRounds || [],
      interviewSeeds: data.interviewSeeds || []
    }, answers);
    data.lastInterviewAnswers = answers;
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 5, dataJson: data, updatedAt: nowIso_() });
    return { success: true, prompt: data.lastInterviewPrompt, round: (Array.isArray(data.interviewRounds) ? data.interviewRounds.length : 0) + 1, readiness: computeLedgerReadiness_(data.skeleton, data.ledger || []) };
  });
}

function importLedgerInterviewReply(buildSessionId, rawText) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(nonEmptyString_(data.lastInterviewPrompt), 'INTERVIEW_PROMPT_REQUIRED', '先に取材プロンプトを作成し、生成AIの回答を取得してください。');
    assertApp_(nonEmptyString_(rawText), 'VALIDATION_ERROR', '生成AIの回答を貼り付けてください。');
    const parsed = parseInterviewReply_(rawText);
    recordManualAiInteraction_({ meetingId: session.meetingId, actionId: session.actionId, buildSessionId: session.buildSessionId, phase: 'ledger_interview' }, data.lastInterviewPrompt, rawText, { valid: true, errors: [] });
    const applied = applyLedgerDiff_(data.ledger || [], parsed.diffEntries);
    data.ledger = applied.entries;
    const attempts = isPlainObject_(data.questionAttempts) ? data.questionAttempts : {};
    parsed.questions.forEach(function (question) {
      const key = interviewQuestionKey_(question);
      attempts[key] = Number(attempts[key] || 0) + 1;
      question.repeatCount = attempts[key];
    });
    data.questionAttempts = attempts;
    data.pendingQuestions = parsed.questions;
    data.lastInterviewPrompt = '';
    data.gatePassed = false;
    const readiness = computeLedgerReadiness_(data.skeleton, data.ledger);
    data.interviewRounds = (Array.isArray(data.interviewRounds) ? data.interviewRounds : []).concat([{
      round: (Array.isArray(data.interviewRounds) ? data.interviewRounds.length : 0) + 1,
      score: readiness.overallScore, confirmedCount: readiness.confirmedCount, at: nowIso_()
    }]);
    pushLedgerAudit_(data, 'interview', 'ラウンド' + data.interviewRounds.length + ': 追加' + applied.added + '件 / 更新' + applied.updated + '件 / 準備度' + readiness.overallScore + '%');
    // 収束の制御（§5.4）: スコアが2ラウンド連続でほぼ増えなければ、残りの降格を提案する。
    const hint = APP_CONFIG.ledgerInterview.stagnantRoundsBeforeDemotionHint;
    const rounds = data.interviewRounds;
    const stagnant = rounds.length > hint && rounds.slice(-hint - 1).every(function (round, index, list) {
      return index === 0 || round.score <= list[index - 1].score;
    });
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: readiness.gatePassed ? 6 : 5, dataJson: data, updatedAt: nowIso_() });
    return {
      success: true, applied: { added: applied.added, updated: applied.updated, skipped: applied.skipped },
      readiness: readiness, questions: parsed.questions, sections: parsed.sections,
      stagnant: stagnant,
      demotionCandidates: parsed.questions.filter(function (question) { return Number(question.repeatCount || 0) >= 2; }),
      round: rounds.length, ledger: data.ledger
    };
  });
}

function interviewQuestionKey_(question) {
  const stepRef = String(question && question.stepRef || '');
  const slot = String(question && question.slot || '');
  if (stepRef && slot) return stepRef + '|' + slot;
  const firstLine = String(question && question.text || '').split(/\r?\n/)[0]
    .replace(/^(?:[>＞]?\s*)?(?:Q\s*\d+|質問\s*\d+|\d+\s*[\.．)])\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return ['unscoped', firstLine].join('|');
}

// ---- STEP 6: 準備度ゲートの操作 ----

function updateLedgerEntry(buildSessionId, entryId, action, value) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    const entry = (Array.isArray(data.ledger) ? data.ledger : []).filter(function (item) { return String(item.entryId) === String(entryId); })[0];
    assertApp_(entry, 'LEDGER_ENTRY_NOT_FOUND', '台帳エントリが見つかりません: ' + entryId);
    if (action === 'confirm') {
      if (nonEmptyString_(value)) entry.value = value.trim();
      assertApp_(nonEmptyString_(entry.value), 'VALIDATION_ERROR', '確認済みにするには値が必要です。正しい値を入力してください。');
      entry.confidence = 'confirmed';
      entry.deferred = false;
      entry.evidence = { type: 'user_answer', ref: '画面で本人が確認', quote: entry.evidence && entry.evidence.quote ? entry.evidence.quote : '' };
      pushLedgerAudit_(data, 'confirm', entryId + '「' + entry.claim.slice(0, 30) + '」を confirmed 化');
    } else if (action === 'defer') {
      entry.deferred = true;
      pushLedgerAudit_(data, 'defer', entryId + '「' + entry.claim.slice(0, 30) + '」を作業前に確認へ降格');
    } else if (action === 'reopen') {
      entry.deferred = false;
      pushLedgerAudit_(data, 'reopen', entryId + '「' + entry.claim.slice(0, 30) + '」の降格を取り消し');
    } else {
      throw new AppError('VALIDATION_ERROR', '台帳操作は confirm / defer / reopen のみです。');
    }
    entry.updatedAt = nowIso_();
    data.gatePassed = false;
    recordLedgerHumanAction_(session, '台帳エントリを' + action, entry);
    const readiness = computeLedgerReadiness_(data.skeleton, data.ledger);
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { dataJson: data, updatedAt: nowIso_() });
    return { success: true, entry: entry, readiness: readiness, ledger: data.ledger };
  });
}

function deferAllOpenLedgerEntries(buildSessionId) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    data.ledger = materializeMissingLedgerEntries_(data.skeleton, data.ledger || [], false, '人が未確認項目の一括降格を選択');
    let deferred = 0;
    (Array.isArray(data.ledger) ? data.ledger : []).forEach(function (entry) {
      if (entry.confidence !== 'confirmed' && entry.deferred !== true) {
        entry.deferred = true;
        entry.updatedAt = nowIso_();
        deferred += 1;
      }
    });
    pushLedgerAudit_(data, 'defer_all', '残りの未確認' + deferred + '件を作業前に確認へ一括降格');
    recordLedgerHumanAction_(session, '未確認項目を一括降格', { deferredCount: deferred });
    const readiness = computeLedgerReadiness_(data.skeleton, data.ledger);
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { dataJson: data, updatedAt: nowIso_() });
    return { success: true, deferredCount: deferred, readiness: readiness, ledger: data.ledger };
  });
}

function deferLedgerSlot_(data, stepRef, slot, label) {
  const ledger = Array.isArray(data.ledger) ? data.ledger : [];
  let touched = 0;
  ledger.forEach(function (entry) {
    if (String(entry.stepRef) === stepRef && String(entry.slot) === slot && entry.confidence !== 'confirmed' && entry.deferred !== true) {
      entry.deferred = true;
      entry.updatedAt = nowIso_();
      touched += 1;
    }
  });
  if (!touched && ledgerSlotKeys_().indexOf(slot) >= 0) {
    ledger.push({
      entryId: nextLedgerEntryId_(ledger), stepRef: stepRef, slot: slot,
      claim: nonEmptyString_(label) ? label : stepRef + ' の ' + ledgerSlotLabel_(slot),
      value: '', evidence: { type: 'user_answer', ref: '人が作業前確認を選択', quote: '' },
      confidence: 'unknown', note: '', deferred: true, updatedAt: nowIso_()
    });
    touched = 1;
  }
  data.ledger = ledger;
  if (touched) pushLedgerAudit_(data, 'defer', stepRef + ' / ' + slot + ' を作業前に確認へ降格');
}

// ---- STEP 6: ガイド生成（P3）。台帳を唯一の事実源として直列化する ----

function prepareWorkGuidePrompt(buildSessionId, confirmed) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    assertApp_(confirmed === true, 'REVIEW_CONFIRMATION_REQUIRED', '準備度ゲートの内容（確認済みの事実と、作業前に確認へ降格した項目）を確認してください。');
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(isPlainObject_(data.skeleton), 'SKELETON_REQUIRED', '先に STEP 4 で骨格と台帳を初期化してください。');
    const ledger = Array.isArray(data.ledger) ? data.ledger : [];
    const readiness = computeLedgerReadiness_(data.skeleton, ledger);
    assertApp_(readiness.gatePassed, 'GATE_NOT_PASSED', '準備度ゲートを通過していません。unknown / assumed の項目を確認済みにするか、「作業前に確認」へ降格してください。', { holes: readiness.holes });
    data.gatePassed = true;
    data.lastAiPrompt = buildLedgerGuidePrompt_({
      action: data.action,
      meeting: data.meeting,
      skeleton: data.skeleton,
      confirmedEntries: ledger.filter(function (entry) { return entry.confidence === 'confirmed'; }),
      deferredEntries: ledger.filter(function (entry) { return entry.deferred === true; }).map(function (entry) {
        return { entryId: entry.entryId, stepRef: entry.stepRef, slot: entry.slot, claim: entry.claim, value: entry.value, confidence: entry.confidence };
      }),
      allowedScripts: listRegisteredActions_(),
      selectedSources: data.selectedSources || [],
      workGuideId: data.revisionWorkGuideId || '',
      version: data.revisionWorkGuideId ? Number(requireWorkGuideRecord_(data.revisionWorkGuideId).currentVersion) + 1 : 1
    });
    data.lastAiPromptPhase = 'work_guide_generation';
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 6, dataJson: data, updatedAt: nowIso_() });
    return { success: true, prompt: data.lastAiPrompt, readiness: readiness };
  });
}

function prepareWorkGuideContext_(data, fileIds, knownPrerequisites) {
  const selectedSources = buildSelectedSourceContext_(fileIds || []);
  data.knownPrerequisites = Array.isArray(knownPrerequisites) ? knownPrerequisites.filter(nonEmptyString_) : [];
  data.selectedSources = selectedSources.map(function (source) {
    return { fileId: source.fileId, fileName: source.fileName, url: source.url, snapshotAt: source.snapshotAt };
  });
  return {
    context: {
      action: data.action,
      meeting: data.meeting,
      knownPrerequisites: data.knownPrerequisites,
      selectedSources: selectedSources,
      allowedScripts: listRegisteredActions_(),
      workGuideId: data.revisionWorkGuideId || '',
      version: data.revisionWorkGuideId ? Number(requireWorkGuideRecord_(data.revisionWorkGuideId).currentVersion) + 1 : 1
    }
  };
}

// ---- STEP 7: JSON取込。スキーマ検証に加えて台帳突合（§7.3）を行う ----

function importWorkGuideToBuild(buildSessionId, rawText) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(data.gatePassed === true, 'GATE_NOT_PASSED', 'JSONを取り込む前に、STEP 6 の準備度ゲートを通過してガイド生成プロンプトを作成してください。');
    const guide = parsePastedJson_(rawText);
    // AIが発明したIDで保存に失敗しないよう、改訂時は元のID、新規作成時は空文字へ正規化する。
    guide.workGuideId = data.revisionWorkGuideId || '';
    if (!guide.sourceSnapshots || !guide.sourceSnapshots.length) guide.sourceSnapshots = data.selectedSources || [];
    validateWorkGuide_(guide);
    // 台帳突合: 本文中の URL・evidenceRefs が confirmed エントリに無ければ「出典不明の値」として拒否する。
    const ledgerErrors = assessGuideAgainstLedger_(guide, data.ledger || []);
    if (ledgerErrors.length) {
      if (nonEmptyString_(data.lastAiPrompt)) {
        recordManualAiInteraction_({ meetingId: session.meetingId, actionId: session.actionId, buildSessionId: session.buildSessionId, phase: data.lastAiPromptPhase || 'work_guide_generation' }, data.lastAiPrompt, rawText, { valid: false, errors: ledgerErrors });
      }
      throw new AppError('LEDGER_MISMATCH', '台帳にない具体値がガイドに含まれています（' + ledgerErrors.length + '件）。ハルシネーションの可能性があります。', { errors: ledgerErrors });
    }
    data.importedWorkGuide = guide;
    data.depthFindings = assessWorkGuideDepth_(guide);
    data.deskReview = null;
    if (nonEmptyString_(data.lastAiPrompt)) {
      recordManualAiInteraction_({ meetingId: session.meetingId, actionId: session.actionId, buildSessionId: session.buildSessionId, phase: data.lastAiPromptPhase || 'work_guide_generation' }, data.lastAiPrompt, rawText, { valid: true, errors: [] });
      data.lastAiPrompt = '';
      data.lastAiPromptPhase = '';
    }
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 8, dataJson: data, updatedAt: nowIso_() });
    return { success: true, workGuide: guide, depthFindings: data.depthFindings };
  });
}

// ---- STEP 8: 机上実行レビュー（P4）と再調整 ----

function prepareDeskReviewPrompt(buildSessionId) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(isPlainObject_(data.importedWorkGuide), 'DRAFT_NOT_FOUND', '先に STEP 7 で作業ガイドJSONを取り込んでください。');
    data.lastDeskReviewPrompt = buildDeskReviewPrompt_(data.importedWorkGuide);
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 8, dataJson: data, updatedAt: nowIso_() });
    return { success: true, prompt: data.lastDeskReviewPrompt };
  });
}

function importDeskReviewReply(buildSessionId, rawText) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(nonEmptyString_(data.lastDeskReviewPrompt), 'DESK_REVIEW_PROMPT_REQUIRED', '先に机上実行レビュープロンプトを作成し、生成AIの回答を取得してください。');
    assertApp_(nonEmptyString_(rawText), 'VALIDATION_ERROR', '生成AIの回答を貼り付けてください。');
    const parsed = parseDeskReviewReply_(rawText);
    assertApp_(parsed.passed || parsed.findings.length, 'DESK_REVIEW_PARSE_ERROR', '机上実行レビュー結果を判定できません。最後のJSONブロックに passed と findings を含めてください。');
    recordManualAiInteraction_({ meetingId: session.meetingId, actionId: session.actionId, buildSessionId: session.buildSessionId, phase: 'desk_review' }, data.lastDeskReviewPrompt, rawText, { valid: true, errors: [] });
    data.lastDeskReviewPrompt = '';
    if (parsed.findings.length) {
      // 詰まりは台帳の unknown として還流し、取材ループ（STEP 5）か降格で解消する（§8）。
      const normalizedFindings = parsed.findings.map(function (finding) {
        finding.stepRef = resolveDeskReviewStepRef_(data, finding.stepRef);
        return finding;
      });
      const applied = applyLedgerDiff_(data.ledger || [], normalizedFindings.map(function (finding) {
        return {
          stepRef: finding.stepRef, slot: finding.slot, claim: '[' + finding.type + '] ' + finding.claim,
          confidence: 'unknown', evidence: { type: 'ai_knowledge', ref: '机上実行レビュー', quote: '' }
        };
      }));
      data.ledger = applied.entries;
      data.gatePassed = false;
      data.deskReview = { passed: false, findings: normalizedFindings, trace: parsed.trace, at: nowIso_() };
      pushLedgerAudit_(data, 'desk_review', '机上実行レビュー: 詰まり' + normalizedFindings.length + '件を台帳へ還流');
    } else {
      data.deskReview = { passed: true, findings: [], trace: parsed.trace, guideFingerprint: fingerprint_(data.importedWorkGuide), at: nowIso_() };
      pushLedgerAudit_(data, 'desk_review', '机上実行レビュー: 完走');
    }
    const readiness = isPlainObject_(data.skeleton) ? computeLedgerReadiness_(data.skeleton, data.ledger || []) : null;
    const nextStep = parsed.findings.length ? 5 : 9;
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: nextStep, dataJson: data, updatedAt: nowIso_() });
    return { success: true, passed: data.deskReview.passed, findings: data.deskReview.findings, trace: parsed.trace, readiness: readiness, ledger: data.ledger || [], currentStep: nextStep };
  });
}

function resolveDeskReviewStepRef_(data, stepRef) {
  const skeleton = data && data.skeleton;
  if (!skeleton || !Array.isArray(skeleton.steps)) return String(stepRef || '');
  if (skeleton.steps.some(function (step) { return String(step.skeletonId) === String(stepRef); })) return String(stepRef);
  const guide = data.importedWorkGuide || data.priorWorkGuide;
  const guideStep = guide && Array.isArray(guide.steps)
    ? guide.steps.filter(function (step) { return String(step.stepId) === String(stepRef); })[0]
    : null;
  if (guideStep && Array.isArray(guideStep.evidenceRefs)) {
    const referenced = (data.ledger || []).filter(function (entry) {
      return guideStep.evidenceRefs.indexOf(entry.entryId) >= 0 && nonEmptyString_(entry.stepRef);
    })[0];
    if (referenced) return String(referenced.stepRef);
  }
  const order = guideStep ? Number(guideStep.order) : Number(String(stepRef || '').replace(/\D/g, ''));
  return skeleton.steps[order - 1] ? String(skeleton.steps[order - 1].skeletonId) : String(stepRef || '');
}

function prepareWorkGuideDepthCheckPrompt(buildSessionId) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(isPlainObject_(data.importedWorkGuide), 'DRAFT_NOT_FOUND', '先に STEP 7 で作業ガイドJSONを取り込んでください。');
    const findings = assessWorkGuideDepth_(data.importedWorkGuide);
    data.depthFindings = findings;
    data.lastAiPrompt = buildWorkGuideDepthCheckPrompt_(data.importedWorkGuide, findings) +
      '\n\n確認済みの知識台帳（ここにない具体値は追加禁止）:\n' + JSON.stringify((data.ledger || []).filter(function (entry) { return entry.confidence === 'confirmed'; }), null, 2);
    data.lastAiPromptPhase = 'work_guide_depth_check';
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 8, dataJson: data, updatedAt: nowIso_() });
    return { success: true, prompt: data.lastAiPrompt, findings: findings };
  });
}

function prepareWorkGuideRevisionPrompt(buildSessionId, feedback) {
  return withClientError_(function () {
    const session = requireOpenBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(isPlainObject_(data.importedWorkGuide), 'DRAFT_NOT_FOUND', '先に STEP 7 で作業ガイドJSONを取り込んでください。');
    assertApp_(nonEmptyString_(feedback), 'VALIDATION_ERROR', 'レビュー指摘を入力してください。');
    data.reviewFeedbacks = (Array.isArray(data.reviewFeedbacks) ? data.reviewFeedbacks : []).concat([{ feedback: feedback.trim(), createdAt: nowIso_() }]);
    data.lastAiPrompt = buildWorkGuideRevisionPrompt_(data.importedWorkGuide, feedback.trim()) +
      '\n\n確認済みの知識台帳（ここにない具体値は追加禁止）:\n' + JSON.stringify((data.ledger || []).filter(function (entry) { return entry.confidence === 'confirmed'; }), null, 2);
    data.lastAiPromptPhase = 'work_guide_revision';
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 8, dataJson: data, updatedAt: nowIso_() });
    return { success: true, prompt: data.lastAiPrompt };
  });
}

function cancelWorkGuideBuild(buildSessionId) {
  return withClientError_(function () {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    let meetingId = '';
    let actionId = '';
    try {
      const session = requireOpenBuildSession_(buildSessionId);
      const data = parseJsonCell_(session.dataJson, {});
      assertApp_(!data.revisionWorkGuideId, 'REVISION_CANNOT_REMOVE_TARGET', '保存済みガイドの改訂ではガイド対象から削除できません。');
      const existingGuide = findRow_('WorkGuides', function (row) {
        return String(row.actionId) === String(session.actionId);
      });
      assertApp_(!existingGuide, 'GUIDE_ALREADY_SAVED', '保存済みの作業ガイドがあるため、ガイド対象から削除できません。');
      const action = requireAction_(session.actionId);
      meetingId = String(session.meetingId);
      actionId = String(session.actionId);
      updateRow_('WorkGuideBuildSessions', session._rowNumber, { status: 'cancelled', updatedAt: nowIso_() });
      updateRow_('Actions', action._rowNumber, {
        status: 'guide_not_required',
        guideRecommended: false,
        automationStatus: 'not_required',
        automationError: ''
      });
    } finally {
      lock.releaseLock();
    }
    refreshMeetingAutomationStatus_(meetingId);
    return { success: true, buildSessionId: String(buildSessionId), actionId: actionId, status: 'guide_not_required' };
  });
}

function pushLedgerAudit_(data, type, detail) {
  data.ledgerAudit = (Array.isArray(data.ledgerAudit) ? data.ledgerAudit : []).concat([{ at: nowIso_(), type: type, detail: detail }]);
}

function recordLedgerHumanAction_(session, actionLabel, detail) {
  recordManualAiInteraction_(
    { meetingId: session.meetingId, actionId: session.actionId, buildSessionId: session.buildSessionId, phase: 'ledger_change' },
    '知識台帳の画面操作: ' + actionLabel,
    JSON.stringify({ action: actionLabel, detail: detail, at: nowIso_() }, null, 2),
    { valid: true, errors: [] }
  );
}

function requireBuildSession_(buildSessionId) {
  const session = findRow_('WorkGuideBuildSessions', function (row) { return String(row.buildSessionId) === String(buildSessionId); });
  assertApp_(session, 'BUILD_SESSION_NOT_FOUND', '作業ガイド作成セッションが見つかりません。');
  return session;
}

function requireOpenBuildSession_(buildSessionId) {
  const session = requireBuildSession_(buildSessionId);
  assertApp_(['in_progress', 'draft'].indexOf(String(session.status)) >= 0, 'BUILD_SESSION_CLOSED', 'この作成セッションは終了済みです。');
  return session;
}

function hydrateBuildSession_(session) {
  const result = stripRowMetadata_(session);
  result.currentStep = Number(result.currentStep);
  result.data = parseJsonCell_(result.dataJson, {});
  delete result.dataJson;
  if (isPlainObject_(result.data.skeleton)) {
    result.readiness = computeLedgerReadiness_(result.data.skeleton, result.data.ledger || []);
  }
  return result;
}
