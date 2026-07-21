function startWorkGuideBuild(actionId, creationMode) {
  return withClientError_(function () {
    const action = requireAction_(actionId);
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
          prerequisiteQuestions: parseJsonCell_(action.prerequisiteQuestionsJson, defaultPrerequisiteQuestions_()),
          prerequisiteAnswers: {},
          selectedSources: [],
          approvedGuidePlan: '',
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
    data.importedWorkGuide = loaded.guide;
    data.revisionWorkGuideId = String(record.workGuideId);
    data.selectedSources = loaded.guide.sourceSnapshots || [];
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 9, status: 'in_progress', dataJson: data, updatedAt: nowIso_() });
    return { success: true, session: hydrateBuildSession_(Object.assign(session, { currentStep: 9, dataJson: data })) };
  });
}

function saveWorkGuideBuildProgress(buildSessionId, step, patch) {
  return withClientError_(function () {
    const session = requireBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    assertApp_(session.status === 'in_progress' || session.status === 'draft', 'BUILD_SESSION_CLOSED', 'この作成セッションは完了済みです。');
    const stepNumber = Number(step);
    assertApp_(Number.isInteger(stepNumber) && stepNumber >= 1 && stepNumber <= 11, 'VALIDATION_ERROR', '作成ステップは1〜11です。');
    const data = parseJsonCell_(session.dataJson, {});
    const allowedKeys = ['knownPrerequisites', 'prerequisiteAnswers', 'selectedSources', 'importedWorkGuide'];
    Object.keys(patch || {}).forEach(function (key) {
      if (allowedKeys.indexOf(key) >= 0) data[key] = patch[key];
    });
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: stepNumber, status: 'in_progress', dataJson: data, updatedAt: nowIso_() });
    return { success: true, session: Object.assign(hydrateBuildSession_(session), { currentStep: stepNumber, data: data }) };
  });
}

function prepareWorkGuidePlanPrompt(buildSessionId, fileIds, knownPrerequisites, prerequisiteAnswers) {
  return withClientError_(function () {
    const session = requireBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    const prepared = prepareWorkGuideContext_(data, fileIds, knownPrerequisites, prerequisiteAnswers);
    data.lastAiPlanPrompt = buildWorkGuidePlanPrompt_(prepared.context);
    data.approvedGuidePlan = '';
    data.lastAiPrompt = '';
    data.lastAiPromptPhase = '';
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 7, dataJson: data, updatedAt: nowIso_() });
    return { success: true, prompt: data.lastAiPlanPrompt, selectedSources: data.selectedSources };
  });
}

function prepareWorkGuidePrompt(buildSessionId, fileIds, knownPrerequisites, prerequisiteAnswers, approvedPlan, confirmed) {
  return withClientError_(function () {
    const session = requireBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    assertApp_(confirmed === true, 'REVIEW_CONFIRMATION_REQUIRED', 'ガイドの目的と具体的な作業内容を確認してください。');
    assertApp_(nonEmptyString_(approvedPlan), 'VALIDATION_ERROR', '生成AIの作業ガイド設計案を貼り付け、必要なら修正してください。');
    const normalizedPlan = approvedPlan.trim();
    assertApp_(normalizedPlan.length <= 50000, 'VALIDATION_ERROR', '作業ガイド設計案は50,000文字以内にしてください。');
    const data = parseJsonCell_(session.dataJson, {});
    const prepared = prepareWorkGuideContext_(data, fileIds, knownPrerequisites, prerequisiteAnswers);
    assertApp_(nonEmptyString_(data.lastAiPlanPrompt), 'GUIDE_PLAN_REQUIRED', '先に人が読むための設計案プロンプトを作成してください。');
    if (data.approvedGuidePlan !== normalizedPlan) {
      recordManualAiInteraction_({ meetingId: session.meetingId, actionId: session.actionId, buildSessionId: session.buildSessionId, phase: 'work_guide_alignment' }, data.lastAiPlanPrompt, normalizedPlan, { valid: true, errors: [] });
    }
    data.approvedGuidePlan = normalizedPlan;
    data.lastAiPrompt = buildWorkGuidePrompt_(prepared.context, normalizedPlan);
    data.lastAiPromptPhase = 'work_guide_generation';
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 7, dataJson: data, updatedAt: nowIso_() });
    return { success: true, prompt: data.lastAiPrompt, selectedSources: data.selectedSources };
  });
}

function prepareWorkGuideContext_(data, fileIds, knownPrerequisites, prerequisiteAnswers) {
  const selectedSources = buildSelectedSourceContext_(fileIds || []);
  data.knownPrerequisites = Array.isArray(knownPrerequisites) ? knownPrerequisites.filter(nonEmptyString_) : [];
  data.prerequisiteAnswers = isPlainObject_(prerequisiteAnswers) ? prerequisiteAnswers : {};
  data.selectedSources = selectedSources.map(function (source) {
    return { fileId: source.fileId, fileName: source.fileName, url: source.url, snapshotAt: source.snapshotAt };
  });
  return {
    context: {
      action: data.action,
      meeting: data.meeting,
      knownPrerequisites: data.knownPrerequisites,
      prerequisiteQuestionsAndAnswers: (data.prerequisiteQuestions || []).map(function (question) {
        return { question: question, answer: data.prerequisiteAnswers[question] || '' };
      }),
      selectedSources: selectedSources,
      allowedScripts: listRegisteredActions_(),
      workGuideId: data.revisionWorkGuideId || '',
      version: data.revisionWorkGuideId ? Number(requireWorkGuideRecord_(data.revisionWorkGuideId).currentVersion) + 1 : 1
    }
  };
}

function importWorkGuideToBuild(buildSessionId, rawText) {
  return withClientError_(function () {
    const session = requireBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(data.revisionWorkGuideId || nonEmptyString_(data.approvedGuidePlan), 'GUIDE_PLAN_REQUIRED', 'JSONを取り込む前に、作業ガイドの目的と具体作業を設計案で確認してください。');
    const guide = parsePastedJson_(rawText);
    // AIが発明したIDで保存に失敗しないよう、改訂時は元のID、新規作成時は空文字へ正規化する。
    guide.workGuideId = data.revisionWorkGuideId || '';
    if (!guide.sourceSnapshots || !guide.sourceSnapshots.length) guide.sourceSnapshots = data.selectedSources || [];
    validateWorkGuide_(guide);
    data.importedWorkGuide = guide;
    if (nonEmptyString_(data.lastAiPrompt)) {
      recordManualAiInteraction_({ meetingId: session.meetingId, actionId: session.actionId, buildSessionId: session.buildSessionId, phase: data.lastAiPromptPhase || 'work_guide_generation' }, data.lastAiPrompt, rawText, { valid: true, errors: [] });
      data.lastAiPrompt = '';
      data.lastAiPromptPhase = '';
    }
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 9, dataJson: data, updatedAt: nowIso_() });
    return { success: true, workGuide: guide };
  });
}

function prepareWorkGuideRevisionPrompt(buildSessionId, feedback) {
  return withClientError_(function () {
    const session = requireBuildSession_(buildSessionId);
    requirePassedQuizForMeeting_(session.meetingId);
    const data = parseJsonCell_(session.dataJson, {});
    assertApp_(isPlainObject_(data.importedWorkGuide), 'DRAFT_NOT_FOUND', '先に STEP 8 で作業ガイドJSONを取り込んでください。');
    assertApp_(nonEmptyString_(feedback), 'VALIDATION_ERROR', 'レビュー指摘を入力してください。');
    data.reviewFeedbacks = (Array.isArray(data.reviewFeedbacks) ? data.reviewFeedbacks : []).concat([{ feedback: feedback.trim(), createdAt: nowIso_() }]);
    data.lastAiPrompt = buildWorkGuideRevisionPrompt_(data.importedWorkGuide, feedback.trim());
    data.lastAiPromptPhase = 'work_guide_revision';
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 9, dataJson: data, updatedAt: nowIso_() });
    return { success: true, prompt: data.lastAiPrompt };
  });
}

function requireBuildSession_(buildSessionId) {
  const session = findRow_('WorkGuideBuildSessions', function (row) { return String(row.buildSessionId) === String(buildSessionId); });
  assertApp_(session, 'BUILD_SESSION_NOT_FOUND', '作業ガイド作成セッションが見つかりません。');
  return session;
}

function hydrateBuildSession_(session) {
  const result = stripRowMetadata_(session);
  result.currentStep = Number(result.currentStep);
  result.data = parseJsonCell_(result.dataJson, {});
  delete result.dataJson;
  return result;
}
