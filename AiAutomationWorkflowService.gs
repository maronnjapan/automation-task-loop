/**
 * Unattended path:
 * transcript registration -> meeting analysis/quiz -> quiz pass -> guide draft
 * -> AI review and revision -> needs_review. Each meeting advances independently,
 * so a quiz waiting in one meeting never blocks a passed meeting.
 */
function processPendingAiAutomation_(summary, forceRetry) {
  summary = summary || {};
  summary.analyzedMeetings = summary.analyzedMeetings || [];
  summary.generatedGuides = summary.generatedGuides || [];
  summary.automationFailures = summary.automationFailures || [];
  summary.automationPending = summary.automationPending || [];
  const settings = getAiAutomationSettings_();
  if (!settings.autoProcessingEnabled) {
    summary.aiAutomationSkipped = settings.apiKeyConfigured
      ? '生成AIの全自動処理が停止中です。'
      : '生成AIのAPIキーが未設定です。既存の手動フローを利用できます。';
    return summary;
  }

  const deadline = Date.now() + APP_CONFIG.automationTimeBudgetMs;
  let processedItems = 0;
  const attemptedMeetings = {};
  const attemptedActions = {};
  const attemptedGuideMeetings = {};
  let preferGuide = true;
  while (Date.now() < deadline && processedItems < 4) {
    let meeting = null;
    let action = null;
    if (preferGuide) {
      action = claimNextActionForAiGuide_(forceRetry, attemptedActions, attemptedGuideMeetings);
      if (!action) meeting = claimNextMeetingForAiAnalysis_(forceRetry, attemptedMeetings);
    } else {
      meeting = claimNextMeetingForAiAnalysis_(forceRetry, attemptedMeetings);
      if (!meeting) action = claimNextActionForAiGuide_(forceRetry, attemptedActions, attemptedGuideMeetings);
    }
    if (meeting) {
      attemptedMeetings[String(meeting.meetingId)] = true;
      processedItems += 1;
      preferGuide = true;
      try {
        const result = automateMeetingAnalysis_(meeting);
        summary.analyzedMeetings.push(result);
      } catch (error) {
        updateRow_('Meetings', meeting._rowNumber, { automationStatus: 'failed', automationError: error.message || String(error), automationUpdatedAt: nowIso_() });
        summary.automationFailures.push({ meetingId: meeting.meetingId, phase: 'meeting_analysis', error: error.message || String(error) });
      }
      continue;
    }

    if (action) {
      attemptedActions[String(action.actionId)] = true;
      attemptedGuideMeetings[String(action.meetingId)] = true;
      processedItems += 1;
      preferGuide = false;
      try {
        const result = automateActionGuide_(action);
        summary.generatedGuides.push(result);
      } catch (error) {
        const currentAction = findRow_('Actions', function (row) { return String(row.actionId) === String(action.actionId); });
        if (currentAction && isActionAutoGuideRequired_(currentAction) && String(currentAction.status) !== 'guide_not_required') {
          updateRow_('Actions', currentAction._rowNumber, { automationStatus: 'failed', automationError: error.message || String(error) });
          summary.automationFailures.push({ meetingId: action.meetingId, actionId: action.actionId, phase: 'work_guide', error: error.message || String(error) });
        }
      }
      refreshMeetingAutomationStatus_(action.meetingId);
      continue;
    }
    break;
  }

  const stillPendingMeetings = getRows_('Meetings').filter(function (row) {
    return String(row.workflowStatus) !== 'completed' && String(row.analysisStatus) !== 'completed';
  });
  const passedQuizMeetings = passedQuizMeetingIds_();
  const waitingForQuiz = {};
  const stillPendingActions = getRows_('Actions').filter(function (row) {
    if (!isActionAutoGuideRequired_(row) || findGuideForAction_(row.actionId) || String(row.automationStatus) === 'not_required') return false;
    if (!passedQuizMeetings[String(row.meetingId)]) {
      waitingForQuiz[String(row.meetingId)] = true;
      return false;
    }
    return true;
  });
  stillPendingMeetings.forEach(function (row) { summary.automationPending.push({ meetingId: row.meetingId, phase: 'meeting_analysis' }); });
  Object.keys(waitingForQuiz).forEach(function (meetingId) { summary.automationPending.push({ meetingId: meetingId, phase: 'quiz' }); });
  stillPendingActions.forEach(function (row) { summary.automationPending.push({ meetingId: row.meetingId, actionId: row.actionId, phase: 'work_guide' }); });
  return summary;
}

function claimNextMeetingForAiAnalysis_(forceRetry, excluded) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const meeting = nextMeetingForAiAnalysis_(forceRetry, excluded);
    if (!meeting) return null;
    const attempt = Number(meeting.automationAttempts || 0) + 1;
    updateRow_('Meetings', meeting._rowNumber, {
      automationStatus: 'analyzing', automationAttempts: attempt,
      automationError: '', automationUpdatedAt: nowIso_()
    });
    meeting.automationStatus = 'analyzing';
    meeting.automationAttempts = attempt;
    return meeting;
  } finally {
    lock.releaseLock();
  }
}

function nextMeetingForAiAnalysis_(forceRetry, excluded) {
  return getRows_('Meetings').find(function (row) {
    if (excluded && excluded[String(row.meetingId)]) return false;
    if (String(row.workflowStatus) === 'completed' || String(row.analysisStatus) === 'completed') return false;
    if (String(row.automationStatus) === 'analyzing') return false;
    if (!forceRetry && Number(row.automationAttempts || 0) >= 3) return false;
    return true;
  }) || null;
}

function nextActionForAiGuide_(forceRetry, excluded, deprioritizedMeetings) {
  const meetings = {};
  getRows_('Meetings').forEach(function (meeting) { meetings[String(meeting.meetingId)] = meeting; });
  const existingGuides = {};
  getRows_('WorkGuides').forEach(function (guide) { existingGuides[String(guide.actionId)] = true; });
  const passedQuizMeetings = passedQuizMeetingIds_();
  const manualBuildActions = activeManualWorkGuideBuildActionIds_();
  const candidates = getRows_('Actions').filter(function (row) {
    if (excluded && excluded[String(row.actionId)]) return false;
    if (!isActionAutoGuideRequired_(row) || existingGuides[String(row.actionId)]) return false;
    if (manualBuildActions[String(row.actionId)]) return false;
    if (String(row.status) === 'guide_ready' || String(row.status) === 'guide_review') return false;
    if (String(row.automationStatus) === 'generating') return false;
    if (!forceRetry && Number(row.automationAttempts || 0) >= 3) return false;
    const meeting = meetings[String(row.meetingId)];
    return Boolean(
      meeting && String(meeting.analysisStatus) === 'completed' && String(meeting.workflowStatus) !== 'completed' &&
      passedQuizMeetings[String(row.meetingId)]
    );
  });
  return candidates.find(function (row) {
    return !deprioritizedMeetings || !deprioritizedMeetings[String(row.meetingId)];
  }) || candidates[0] || null;
}

function activeManualWorkGuideBuildActionIds_() {
  const actions = {};
  getRows_('Actions').forEach(function (row) { actions[String(row.actionId)] = row; });
  const manual = {};
  getRows_('WorkGuideBuildSessions').forEach(function (session) {
    if (['in_progress', 'draft'].indexOf(String(session.status)) < 0) return;
    const data = parseJsonCell_(session.dataJson, {});
    const action = actions[String(session.actionId)] || {};
    const legacyAutomatic = !data.creationMode && ['generating', 'failed'].indexOf(String(action.automationStatus)) >= 0;
    if (data.creationMode !== 'automatic' && !legacyAutomatic) manual[String(session.actionId)] = true;
  });
  return manual;
}

function updateAutomaticWorkGuideBuild_(buildSessionId, currentStep, data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const session = requireOpenBuildSession_(buildSessionId);
    const currentData = parseJsonCell_(session.dataJson, {});
    assertApp_(currentData.creationMode === 'automatic', 'MANUAL_BUILD_IN_PROGRESS', '手動作成へ切り替えられたため、自動生成を停止しました。');
    data.creationMode = 'automatic';
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: currentStep, dataJson: data, updatedAt: nowIso_() });
  } finally {
    lock.releaseLock();
  }
}

function claimNextActionForAiGuide_(forceRetry, excluded, deprioritizedMeetings) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const action = nextActionForAiGuide_(forceRetry, excluded, deprioritizedMeetings);
    if (!action) return null;
    const attempt = Number(action.automationAttempts || 0) + 1;
    updateRow_('Actions', action._rowNumber, {
      automationStatus: 'generating', automationAttempts: attempt, automationError: ''
    });
    action.automationStatus = 'generating';
    action.automationAttempts = attempt;
    return action;
  } finally {
    lock.releaseLock();
  }
}

function automateMeetingAnalysis_(meeting) {
  const transcript = readTextFile_(meeting.transcriptFileId, APP_CONFIG.maxTranscriptCharacters);
  const prompt = buildMeetingAnalysisPrompt_(meeting, transcript);
  const generated = runAiJsonTask_({
    prompt: prompt,
    phase: 'meeting_analysis',
    meta: { meetingId: meeting.meetingId },
    validator: function (value) { return validateMeetingAnalysis_(value); }
  });
  const saved = saveMeetingAnalysis(meeting.meetingId, JSON.stringify(generated.value), { skipInteractionLog: true });
  assertApp_(saved && saved.success, saved && saved.code || 'ANALYSIS_SAVE_FAILED', saved && saved.error || '自動生成した会議解析を保存できませんでした。', saved && saved.details);
  updateRow_('Meetings', meeting._rowNumber, { automationStatus: 'quiz_ready', automationError: '', automationUpdatedAt: nowIso_() });
  refreshMeetingAutomationStatus_(meeting.meetingId);
  return {
    meetingId: meeting.meetingId,
    title: meeting.title,
    quizQuestionCount: saved.questionCount,
    actionCount: saved.actionCount,
    conversationId: generated.conversationId
  };
}

function automateActionGuide_(action) {
  const existing = findGuideForAction_(action.actionId);
  if (existing) return { actionId: action.actionId, workGuideId: existing.workGuideId, skippedExisting: true };
  requirePassedQuizForMeeting_(action.meetingId);
  const meeting = requireMeeting_(action.meetingId);
  const analysisRow = findRow_('MeetingAnalyses', function (row) { return String(row.meetingId) === String(action.meetingId); });
  assertApp_(analysisRow, 'ANALYSIS_NOT_FOUND', '作業ガイドの前に会議解析が必要です。');
  const started = startWorkGuideBuild(action.actionId, 'automatic');
  assertApp_(started && started.success, started && started.code || 'BUILD_START_FAILED', started && started.error || '作成セッションを開始できません。', started && started.details);
  const session = requireBuildSession_(started.session.buildSessionId);
  const data = parseJsonCell_(session.dataJson, {});
  const selectedSources = buildSelectedSourceContext_([meeting.transcriptFileId]);
  data.knownPrerequisites = [];
  data.selectedSources = selectedSources.map(function (source) {
    return { fileId: source.fileId, fileName: source.fileName, url: source.url, snapshotAt: source.snapshotAt };
  });
  const sourceContext = {
    action: data.action,
    meeting: {
      meetingId: meeting.meetingId,
      title: meeting.title,
      summary: analysisRow.summary,
      decisions: parseJsonCell_(analysisRow.decisionsJson, []),
      pendingItems: parseJsonCell_(analysisRow.pendingItemsJson, [])
    },
    knownPrerequisites: [],
    prerequisiteQuestionsAndAnswers: (data.prerequisiteQuestions || []).map(function (question) { return { question: question, answer: '' }; }),
    selectedSources: selectedSources,
    allowedScripts: listRegisteredActions_(),
    workGuideId: '',
    version: 1
  };
  updateAutomaticWorkGuideBuild_(session.buildSessionId, 4, data);

  let reviewedValue = null;
  let conversationId = '';
  if (isPlainObject_(data.importedWorkGuide) && isPlainObject_(data.autoReview) && isPlainObject_(data.skeleton) && Array.isArray(data.ledger)) {
    validateWorkGuide_(data.importedWorkGuide);
    const resumedLedgerErrors = assessGuideAgainstLedger_(data.importedWorkGuide, data.ledger);
    assertApp_(!resumedLedgerErrors.length, 'LEDGER_MISMATCH', '再開した自動生成ガイドが知識台帳と一致しません。', { errors: resumedLedgerErrors });
    reviewedValue = { workGuide: data.importedWorkGuide, review: data.autoReview };
  } else {
    // P1: 文字起こしから骨格と台帳を初期化する。API経路でも手動経路と同じ状態モデルを使う。
    const initialized = runAiJsonTask_({
      prompt: buildGuideSkeletonPrompt_(sourceContext, { jsonOnly: true }),
      phase: 'ledger_init',
      meta: { meetingId: meeting.meetingId, actionId: action.actionId, buildSessionId: session.buildSessionId },
      validator: function (value) { return normalizeSkeletonLedgerResult_(value); }
    });
    data.skeleton = initialized.value.skeleton;
    data.ledger = materializeMissingLedgerEntries_(data.skeleton, initialized.value.entries, false, '全自動経路で不足スロットを追加');
    // 全自動経路では人へ質問できない。unknown / assumed は黙って消さず、すべて作業前確認へ降格する。
    data.ledger.forEach(function (entry) {
      if (entry.confidence !== 'confirmed') {
        entry.deferred = true;
        entry.updatedAt = nowIso_();
      }
    });
    data.gatePassed = true;
    pushLedgerAudit_(data, 'auto_init', '全自動で台帳' + data.ledger.length + '件を初期化し、未確認項目を作業前確認へ降格');
    const readiness = computeLedgerReadiness_(data.skeleton, data.ledger);
    assertApp_(readiness.gatePassed, 'GATE_NOT_PASSED', '全自動経路の準備度ゲートを通過できません。', { holes: readiness.holes });
    updateAutomaticWorkGuideBuild_(session.buildSessionId, 6, data);

    const guideContext = {
      action: data.action,
      meeting: sourceContext.meeting,
      skeleton: data.skeleton,
      confirmedEntries: data.ledger.filter(function (entry) { return entry.confidence === 'confirmed'; }),
      deferredEntries: data.ledger.filter(function (entry) { return entry.deferred === true; }),
      allowedScripts: sourceContext.allowedScripts,
      selectedSources: selectedSources,
      workGuideId: '',
      version: 1
    };
    const generated = runAiJsonTask_({
      prompt: buildLedgerGuidePrompt_(guideContext, { jsonOnly: true }),
      phase: 'work_guide_generation',
      meta: { meetingId: meeting.meetingId, actionId: action.actionId, buildSessionId: session.buildSessionId },
      validator: function (guide) {
        guide.workGuideId = '';
        guide.version = 1;
        guide.schemaVersion = APP_CONFIG.schemaVersion;
        guide.sourceSnapshots = JSON.parse(JSON.stringify(data.selectedSources));
        validateWorkGuide_(guide);
        const ledgerErrors = assessGuideAgainstLedger_(guide, data.ledger);
        if (ledgerErrors.length) throw new AppError('VALIDATION_ERROR', '生成ガイドが知識台帳と一致しません。', { errors: ledgerErrors });
        return guide;
      }
    });
    const reviewed = runAiJsonTask_({
      prompt: buildWorkGuideAutoReviewPrompt_(Object.assign({}, sourceContext, {
        skeleton: data.skeleton,
        confirmedLedger: guideContext.confirmedEntries,
        deferredLedger: guideContext.deferredEntries
      }), generated.value),
      phase: 'work_guide_review_revision',
      conversationId: generated.conversationId,
      meta: { meetingId: meeting.meetingId, actionId: action.actionId, buildSessionId: session.buildSessionId },
      validator: function (value) {
        const validated = validateAutoReviewResult_(value, generated.value);
        const ledgerErrors = assessGuideAgainstLedger_(validated.workGuide, data.ledger);
        if (ledgerErrors.length) throw new AppError('VALIDATION_ERROR', 'AI検収後のガイドが知識台帳と一致しません。', { errors: ledgerErrors });
        return validated;
      }
    });
    reviewedValue = reviewed.value;
    conversationId = generated.conversationId;
    // 机上実行レビュー（P4）: 生成・検収とは別コンテキストの「初見の作業者」に通し読みさせる。
    // 自動経路では人へ質問できないため、詰まりは「作業前に確認」へ自動降格し、残存リスクに記録する。
    const deskReviewed = runAiJsonTask_({
      prompt: buildDeskReviewPrompt_(reviewedValue.workGuide, { jsonOnly: true }),
      phase: 'desk_review',
      meta: { meetingId: meeting.meetingId, actionId: action.actionId, buildSessionId: session.buildSessionId },
      validator: function (value) { return validateDeskReviewResult_(value); }
    });
    if (deskReviewed.value.findings.length) {
      const deskFindings = deskReviewed.value.findings.map(function (finding) {
        finding.stepRef = resolveDeskReviewStepRef_(data, finding.stepRef);
        return finding;
      });
      const deskLedger = applyLedgerDiff_(data.ledger, deskFindings.map(function (finding) {
        return {
          stepRef: finding.stepRef,
          slot: finding.slot,
          claim: finding.claim,
          confidence: 'unknown',
          deferred: true,
          evidence: { type: 'ai_knowledge', ref: '全自動の机上実行レビュー', quote: '' }
        };
      }));
      data.ledger = deskLedger.entries;
      data.ledger.forEach(function (entry) {
        if (entry.confidence !== 'confirmed') entry.deferred = true;
      });
      applyDeskReviewFindingsToGuide_(reviewedValue.workGuide, deskFindings);
      reviewedValue.review.remainingRisks = reviewedValue.review.remainingRisks.concat(deskFindings.map(function (finding) {
        return '机上実行レビュー[' + finding.type + ']' + (finding.stepRef ? ' ' + finding.stepRef : '') + ': ' + finding.claim + '（作業前に確認へ降格）';
      }));
      reviewedValue.review.changesMade = reviewedValue.review.changesMade.concat(['机上実行レビューの詰まり' + deskFindings.length + '件を前提条件「作業前に確認」へ降格']);
      pushLedgerAudit_(data, 'desk_review', '全自動の机上実行レビュー' + deskFindings.length + '件を作業前確認へ降格');
    }
    const remainingDepthFindings = assessWorkGuideDepth_(reviewedValue.workGuide);
    if (remainingDepthFindings.length) {
      reviewedValue.review.remainingRisks = reviewedValue.review.remainingRisks.concat(remainingDepthFindings.map(function (item) { return '具体度チェック残: ' + item; }));
    }
    data.importedWorkGuide = reviewedValue.workGuide;
    data.autoReview = reviewedValue.review;
    data.deskReview = {
      passed: deskReviewed.value.findings.length === 0,
      findings: deskReviewed.value.findings.map(function (finding) {
        finding.stepRef = resolveDeskReviewStepRef_(data, finding.stepRef);
        return finding;
      }),
      trace: deskReviewed.value.trace,
      at: nowIso_()
    };
    const finalLedgerErrors = assessGuideAgainstLedger_(reviewedValue.workGuide, data.ledger);
    assertApp_(!finalLedgerErrors.length, 'LEDGER_MISMATCH', '机上実行レビュー後のガイドが知識台帳と一致しません。', { errors: finalLedgerErrors });
    updateAutomaticWorkGuideBuild_(session.buildSessionId, 9, data);
  }
  const saved = saveWorkGuide({
    requestToken: 'auto-' + action.actionId + '-initial',
    confirmed: true,
    reviewRequired: true,
    generationMode: 'automatic',
    autoReview: reviewedValue.review,
    buildSessionId: session.buildSessionId,
    actionId: action.actionId,
    meetingId: meeting.meetingId,
    workGuide: reviewedValue.workGuide
  });
  assertApp_(saved && saved.success, saved && saved.code || 'GUIDE_SAVE_FAILED', saved && saved.error || '自動生成した作業ガイドを保存できませんでした。', saved && saved.details);
  linkAiInteractionsToWorkGuide_(action.actionId, saved.workGuideId);
  updateRow_('Actions', action._rowNumber, { status: 'guide_review', automationStatus: 'completed', automationError: '' });
  refreshMeetingAutomationStatus_(meeting.meetingId);
  return {
    meetingId: meeting.meetingId,
    actionId: action.actionId,
    workGuideId: saved.workGuideId,
    title: reviewedValue.workGuide.title,
    status: APP_CONFIG.statuses.guideNeedsReview,
    review: reviewedValue.review,
    conversationId: conversationId
  };
}

function requestAiWorkGuideRevision(workGuideId, feedback) {
  return withClientError_(function () {
    assertApp_(nonEmptyString_(feedback), 'VALIDATION_ERROR', '直してほしい点を入力してください。');
    const record = requireWorkGuideRecord_(workGuideId);
    requirePassedQuizForMeeting_(record.meetingId);
    const loaded = getWorkGuideOrThrow_(workGuideId, Number(record.currentVersion));
    const action = requireAction_(record.actionId);
    const meeting = requireMeeting_(record.meetingId);
    const sourceContext = buildSelectedSourceContext_([meeting.transcriptFileId]);
    const context = {
      action: stripRowMetadata_(action),
      meeting: { meetingId: meeting.meetingId, title: meeting.title },
      selectedSources: sourceContext,
      allowedScripts: listRegisteredActions_(),
      humanFeedback: feedback.trim(),
      workGuideId: workGuideId,
      version: Number(record.currentVersion) + 1
    };
    const expected = JSON.parse(JSON.stringify(loaded.guide));
    expected.workGuideId = workGuideId;
    expected.version = Number(record.currentVersion) + 1;
    const revised = runAiJsonTask_({
      requireEnabled: false,
      prompt: buildWorkGuideRevisionPrompt_(expected, feedback.trim()) + '\n\n根拠コンテキスト:\n' + JSON.stringify(context, null, 2),
      phase: 'human_requested_revision',
      meta: { meetingId: meeting.meetingId, actionId: action.actionId, workGuideId: workGuideId },
      validator: function (guide) {
        guide.workGuideId = workGuideId;
        guide.version = expected.version;
        guide.schemaVersion = APP_CONFIG.schemaVersion;
        guide.sourceSnapshots = JSON.parse(JSON.stringify(expected.sourceSnapshots || []));
        return validateWorkGuide_(guide, { expectedWorkGuideId: workGuideId });
      }
    });
    const reviewed = runAiJsonTask_({
      requireEnabled: false,
      conversationId: revised.conversationId,
      prompt: buildWorkGuideAutoReviewPrompt_(context, revised.value),
      phase: 'work_guide_review_revision',
      meta: { meetingId: meeting.meetingId, actionId: action.actionId, workGuideId: workGuideId },
      validator: function (value) { return validateAutoReviewResult_(value, revised.value); }
    });
    const remainingDepthFindings = assessWorkGuideDepth_(reviewed.value.workGuide);
    if (remainingDepthFindings.length) {
      reviewed.value.review.remainingRisks = reviewed.value.review.remainingRisks.concat(remainingDepthFindings.map(function (item) { return '具体度チェック残: ' + item; }));
    }
    const saved = saveWorkGuide({
      requestToken: 'ai-revision-' + workGuideId + '-v' + expected.version + '-' + fingerprint_(feedback.trim()).slice(0, 16), confirmed: true, reviewRequired: true,
      generationMode: 'automatic_revision', autoReview: reviewed.value.review,
      actionId: action.actionId, meetingId: meeting.meetingId, workGuide: reviewed.value.workGuide
    });
    assertApp_(saved && saved.success, saved && saved.code || 'GUIDE_SAVE_FAILED', saved && saved.error || '修正版を保存できませんでした。', saved && saved.details);
    linkAiInteractionsToWorkGuide_(action.actionId, saved.workGuideId);
    return { success: true, workGuideId: saved.workGuideId, version: saved.version, review: reviewed.value.review };
  });
}

function isActionAutoGuideRequired_(action) {
  return action.guideRecommended === true || String(action.guideRecommended).toLowerCase() === 'true' || action.guideRecommended === '';
}

function findGuideForAction_(actionId) {
  return findRow_('WorkGuides', function (row) { return String(row.actionId) === String(actionId); });
}

function refreshMeetingAutomationStatus_(meetingId) {
  const meeting = findRow_('Meetings', function (row) { return String(row.meetingId) === String(meetingId); });
  if (!meeting || String(meeting.analysisStatus) !== 'completed') return;
  if (!hasPassedQuizForMeeting_(meetingId)) {
    updateRow_('Meetings', meeting._rowNumber, { automationStatus: 'quiz_ready', automationError: '', automationUpdatedAt: nowIso_() });
    return;
  }
  const required = findRows_('Actions', function (row) { return String(row.meetingId) === String(meetingId) && isActionAutoGuideRequired_(row); });
  const failed = required.some(function (row) { return String(row.automationStatus) === 'failed' && !findGuideForAction_(row.actionId); });
  const pending = required.some(function (row) { return !findGuideForAction_(row.actionId); });
  const status = failed ? 'partial_failed' : pending ? 'guide_generation_pending' : required.length ? 'review_ready' : 'quiz_ready';
  updateRow_('Meetings', meeting._rowNumber, { automationStatus: status, automationError: failed ? '一部の作業ガイド生成に失敗しました。' : '', automationUpdatedAt: nowIso_() });
}
