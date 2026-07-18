function startWorkGuideBuild(actionId) {
  return withClientError_(function () {
    const action = requireAction_(actionId);
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
        importedWorkGuide: null
      };
      session = {
        buildSessionId: createId_('BUILD'), actionId: action.actionId, meetingId: action.meetingId,
        currentStep: 1, status: 'in_progress', dataJson: data, createdAt: nowIso_(), updatedAt: nowIso_()
      };
      appendObject_('WorkGuideBuildSessions', session);
      updateRow_('Actions', action._rowNumber, { status: 'guide_building' });
    }
    return { success: true, session: hydrateBuildSession_(session) };
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
    const started = startWorkGuideBuild(record.actionId);
    assertApp_(started.success, started.code || 'BUILD_START_FAILED', started.error || '改訂セッションを開始できません。', started.details);
    const session = requireBuildSession_(started.session.buildSessionId);
    const data = parseJsonCell_(session.dataJson, {});
    const loaded = getWorkGuideOrThrow_(workGuideId, Number(record.currentVersion));
    data.importedWorkGuide = loaded.guide;
    data.selectedSources = loaded.guide.sourceSnapshots || [];
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 9, status: 'in_progress', dataJson: data, updatedAt: nowIso_() });
    return { success: true, session: hydrateBuildSession_(Object.assign(session, { currentStep: 9, dataJson: data })) };
  });
}

function saveWorkGuideBuildProgress(buildSessionId, step, patch) {
  return withClientError_(function () {
    const session = requireBuildSession_(buildSessionId);
    assertApp_(session.status === 'in_progress' || session.status === 'draft', 'BUILD_SESSION_CLOSED', 'この作成セッションは完了済みです。');
    const stepNumber = Number(step);
    assertApp_(Number.isInteger(stepNumber) && stepNumber >= 1 && stepNumber <= 10, 'VALIDATION_ERROR', '作成ステップは1〜10です。');
    const data = parseJsonCell_(session.dataJson, {});
    const allowedKeys = ['knownPrerequisites', 'prerequisiteAnswers', 'selectedSources', 'importedWorkGuide'];
    Object.keys(patch || {}).forEach(function (key) {
      if (allowedKeys.indexOf(key) >= 0) data[key] = patch[key];
    });
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: stepNumber, status: 'in_progress', dataJson: data, updatedAt: nowIso_() });
    return { success: true, session: Object.assign(hydrateBuildSession_(session), { currentStep: stepNumber, data: data }) };
  });
}

function prepareWorkGuidePrompt(buildSessionId, fileIds, knownPrerequisites, prerequisiteAnswers) {
  return withClientError_(function () {
    const session = requireBuildSession_(buildSessionId);
    const data = parseJsonCell_(session.dataJson, {});
    const selectedSources = buildSelectedSourceContext_(fileIds || []);
    data.knownPrerequisites = Array.isArray(knownPrerequisites) ? knownPrerequisites.filter(nonEmptyString_) : [];
    data.prerequisiteAnswers = isPlainObject_(prerequisiteAnswers) ? prerequisiteAnswers : {};
    data.selectedSources = selectedSources.map(function (source) {
      return { fileId: source.fileId, fileName: source.fileName, url: source.url, snapshotAt: source.snapshotAt };
    });
    const context = {
      action: data.action,
      meeting: data.meeting,
      knownPrerequisites: data.knownPrerequisites,
      prerequisiteQuestionsAndAnswers: data.prerequisiteQuestions.map(function (question) {
        return { question: question, answer: data.prerequisiteAnswers[question] || '' };
      }),
      selectedSources: selectedSources,
      allowedScripts: listRegisteredActions_(),
      workGuideId: data.importedWorkGuide && data.importedWorkGuide.workGuideId ? data.importedWorkGuide.workGuideId : '',
      version: data.importedWorkGuide && data.importedWorkGuide.version ? Number(data.importedWorkGuide.version) + 1 : 1
    };
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 7, dataJson: data, updatedAt: nowIso_() });
    return { success: true, prompt: buildWorkGuidePrompt_(context), selectedSources: data.selectedSources };
  });
}

function importWorkGuideToBuild(buildSessionId, rawText) {
  return withClientError_(function () {
    const session = requireBuildSession_(buildSessionId);
    const data = parseJsonCell_(session.dataJson, {});
    const guide = parsePastedJson_(rawText);
    if (!guide.sourceSnapshots || !guide.sourceSnapshots.length) guide.sourceSnapshots = data.selectedSources || [];
    validateWorkGuide_(guide);
    data.importedWorkGuide = guide;
    updateRow_('WorkGuideBuildSessions', session._rowNumber, { currentStep: 9, dataJson: data, updatedAt: nowIso_() });
    return { success: true, workGuide: guide };
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
