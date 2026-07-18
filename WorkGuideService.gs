function saveWorkGuide(payload) {
  payload = payload || {};
  const completed = { documentCreated: false, jsonCreated: false, spreadsheetUpdated: false };
  let requestRow = null;
  let state = null;
  const lock = LockService.getScriptLock();
  try {
    assertApp_(nonEmptyString_(payload.requestToken), 'REQUEST_TOKEN_REQUIRED', '保存リクエスト識別子がありません。画面を再読み込みしてください。');
    assertApp_(payload.confirmed === true, 'SAVE_CONFIRMATION_REQUIRED', '保存前の確認に同意してください。');
    validateWorkGuide_(payload.workGuide || {});
    const action = requireAction_(payload.actionId);
    assertApp_(String(action.meetingId) === String(payload.meetingId), 'ID_MISMATCH', '作業候補と会議IDが一致しません。');
    if (payload.buildSessionId) {
      const initialBuild = requireBuildSession_(payload.buildSessionId);
      assertApp_(String(initialBuild.actionId) === String(action.actionId), 'ID_MISMATCH', '作成セッションと作業候補が一致しません。');
    }
    lock.waitLock(30000);
    requestRow = findRow_('SaveRequests', function (row) { return String(row.requestToken) === String(payload.requestToken); });
    const fingerprint = fingerprint_(payload.workGuide);
    if (requestRow) {
      state = parseJsonCell_(requestRow.resultJson, {});
      assertApp_(!state.fingerprint || state.fingerprint === fingerprint, 'REQUEST_TOKEN_REUSED', '同じ保存リクエスト識別子を異なる内容に再利用できません。');
      if (state.success === true) return Object.assign({}, state, { duplicateRequest: true });
      completed.documentCreated = Boolean(state.completed && state.completed.documentCreated);
      completed.jsonCreated = Boolean(state.completed && state.completed.jsonCreated);
      completed.spreadsheetUpdated = Boolean(state.completed && state.completed.spreadsheetUpdated);
    }
    if (payload.buildSessionId) {
      const lockedBuild = requireBuildSession_(payload.buildSessionId);
      assertApp_(String(lockedBuild.status) !== 'completed', 'BUILD_SESSION_CLOSED', 'この作成セッションは保存済みです。');
    }
    if (!requestRow) {
      const guideForId = payload.workGuide || {};
      const existingGuide = guideForId.workGuideId ? findRow_('WorkGuides', function (row) { return String(row.workGuideId) === String(guideForId.workGuideId); }) : null;
      if (guideForId.workGuideId) assertApp_(existingGuide, 'WORK_GUIDE_NOT_FOUND', '更新対象の作業ガイドIDが見つかりません。');
      if (existingGuide) assertApp_(String(existingGuide.actionId) === String(action.actionId), 'ID_MISMATCH', '作業ガイドと作業候補が一致しません。');
      const workGuideId = existingGuide ? String(existingGuide.workGuideId) : createId_('WG');
      const version = existingGuide ? Number(existingGuide.currentVersion) + 1 : 1;
      state = {
        success: false, status: 'processing', fingerprint: fingerprint, workGuideId: workGuideId, version: version,
        workGuideVersionId: workGuideId + '-V' + version, completed: completed,
        documentFileId: '', jsonFileId: '', createdAt: nowIso_()
      };
      appendObject_('SaveRequests', {
        requestToken: payload.requestToken, workGuideId: workGuideId, versionNo: version,
        resultJson: state, createdAt: state.createdAt
      });
      requestRow = findRow_('SaveRequests', function (row) { return String(row.requestToken) === String(payload.requestToken); });
    }

    const guide = JSON.parse(JSON.stringify(payload.workGuide || {}));
    guide.workGuideId = state.workGuideId;
    guide.version = Number(state.version);
    validateWorkGuide_(guide, { expectedWorkGuideId: state.workGuideId });

    if (!completed.documentCreated) {
      const documentFile = createWorkGuideDocument_(guide);
      documentFile.moveTo(getFolderByPath_(APP_CONFIG.folderPaths.guideReady));
      state.documentFileId = documentFile.getId();
      completed.documentCreated = true;
      persistSaveState_(requestRow, state, completed);
    }
    if (!completed.jsonCreated) {
      const jsonFile = createJsonFile_(getFolderByPath_(APP_CONFIG.folderPaths.guideReady), guide.workGuideId + '_v' + guide.version + '.json', guide);
      state.jsonFileId = jsonFile.getId();
      completed.jsonCreated = true;
      persistSaveState_(requestRow, state, completed);
    }
    if (!completed.spreadsheetUpdated) {
      const existingVersion = findRow_('WorkGuideVersions', function (row) { return String(row.workGuideVersionId) === state.workGuideVersionId; });
      if (!existingVersion) {
        appendObject_('WorkGuideVersions', {
          workGuideVersionId: state.workGuideVersionId, workGuideId: guide.workGuideId, versionNo: guide.version,
          goal: guide.goal, assumptionsJson: guide.assumptions, prerequisitesJson: guide.prerequisites,
          warningsJson: guide.warnings, stepsJson: guide.steps, sourceSnapshotsJson: guide.sourceSnapshots,
          documentFileId: state.documentFileId, jsonFileId: state.jsonFileId, createdAt: nowIso_()
        });
      }
      const now = nowIso_();
      const existingGuide = findRow_('WorkGuides', function (row) { return String(row.workGuideId) === String(guide.workGuideId); });
      if (existingGuide) {
        updateRow_('WorkGuides', existingGuide._rowNumber, {
          actionId: action.actionId, meetingId: action.meetingId, title: guide.title, status: APP_CONFIG.statuses.guideReady,
          currentVersion: guide.version, documentFileId: state.documentFileId, jsonFileId: state.jsonFileId, updatedAt: now
        });
      } else {
        appendObject_('WorkGuides', {
          workGuideId: guide.workGuideId, actionId: action.actionId, meetingId: action.meetingId, title: guide.title,
          status: APP_CONFIG.statuses.guideReady, currentVersion: guide.version,
          documentFileId: state.documentFileId, jsonFileId: state.jsonFileId, createdAt: now, updatedAt: now, lastExecutedAt: ''
        });
      }
      updateRow_('Actions', action._rowNumber, { status: 'guide_ready' });
      if (payload.buildSessionId) {
        const build = requireBuildSession_(payload.buildSessionId);
        updateRow_('WorkGuideBuildSessions', build._rowNumber, { currentStep: 11, status: 'completed', updatedAt: now });
      }
      completed.spreadsheetUpdated = true;
      persistSaveState_(requestRow, state, completed);
    }
    const meeting = requireMeeting_(payload.meetingId);
    const elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(meeting.meetingEndedAt).getTime()) / 60000));
    state = Object.assign(state, {
      success: true, status: 'completed', completed: completed,
      documentUrl: DriveApp.getFileById(state.documentFileId).getUrl(),
      jsonUrl: DriveApp.getFileById(state.jsonFileId).getUrl(),
      savedAt: nowIso_(), minutesFromMeetingEnd: elapsedMinutes, within15Minutes: elapsedMinutes <= 15
    });
    updateRow_('SaveRequests', requestRow._rowNumber, { resultJson: state });
    return state;
  } catch (error) {
    const response = {
      success: false, workGuideId: state && state.workGuideId ? state.workGuideId : '',
      version: state && state.version ? state.version : '', completed: completed,
      code: error.code || 'SAVE_FAILED', error: error.message || '作業ガイドの保存に失敗しました。',
      details: error.details || null
    };
    if (requestRow) {
      state = Object.assign(state || {}, response, { status: 'failed', fingerprint: state && state.fingerprint });
      try { updateRow_('SaveRequests', requestRow._rowNumber, { resultJson: state }); } catch (ignored) { console.error(ignored); }
    }
    console.error(error && error.stack ? error.stack : error);
    return response;
  } finally {
    try { lock.releaseLock(); } catch (ignored) { /* lock was not acquired */ }
  }
}

function persistSaveState_(requestRow, state, completed) {
  state.completed = Object.assign({}, completed);
  updateRow_('SaveRequests', requestRow._rowNumber, { resultJson: state });
}

function fingerprint_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value || {}), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest);
}

function listWorkGuides() {
  return withClientError_(function () {
    const completed = completedMeetingIds_();
    const guides = getRows_('WorkGuides').filter(function (row) { return !completed[String(row.meetingId)]; });
    return { success: true, workGuides: guides.reverse().map(stripRowMetadata_) };
  });
}

function getWorkGuide(workGuideId, versionNo) {
  return withClientError_(function () {
    const record = requireWorkGuideRecord_(workGuideId);
    let fileId = record.jsonFileId;
    let versionId = workGuideId + '-V' + Number(record.currentVersion);
    if (versionNo && Number(versionNo) !== Number(record.currentVersion)) {
      const version = findRow_('WorkGuideVersions', function (row) { return String(row.workGuideId) === String(workGuideId) && Number(row.versionNo) === Number(versionNo); });
      assertApp_(version, 'WORK_GUIDE_VERSION_NOT_FOUND', '指定バージョンが見つかりません。');
      fileId = version.jsonFileId;
      versionId = version.workGuideVersionId;
    }
    const guide = JSON.parse(readTextFile_(fileId, APP_CONFIG.maxTranscriptCharacters));
    return { success: true, workGuide: guide, workGuideVersionId: versionId, record: stripRowMetadata_(record) };
  });
}

function requireWorkGuideRecord_(workGuideId) {
  const row = findRow_('WorkGuides', function (guide) { return String(guide.workGuideId) === String(workGuideId); });
  assertApp_(row, 'WORK_GUIDE_NOT_FOUND', '作業ガイドが見つかりません。');
  return row;
}
