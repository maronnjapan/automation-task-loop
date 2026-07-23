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
    assertApp_(String(action.status) !== 'guide_not_required', 'ACTION_NOT_GUIDE_TARGET', 'この作業候補はガイド対象から削除されています。');
    assertApp_(String(action.meetingId) === String(payload.meetingId), 'ID_MISMATCH', '作業候補と会議IDが一致しません。');
    requirePassedQuizForMeeting_(action.meetingId);
    if (payload.buildSessionId) {
      const initialBuild = requireBuildSession_(payload.buildSessionId);
      assertApp_(String(initialBuild.actionId) === String(action.actionId), 'ID_MISMATCH', '作成セッションと作業候補が一致しません。');
      assertApp_(['in_progress', 'draft', 'completed'].indexOf(String(initialBuild.status)) >= 0, 'BUILD_SESSION_CLOSED', 'この作成セッションは終了済みです。');
      const initialBuildData = parseJsonCell_(initialBuild.dataJson, {});
      if (payload.generationMode === 'automatic') {
        assertApp_(initialBuildData.creationMode === 'automatic', 'MANUAL_BUILD_IN_PROGRESS', '手動作成へ切り替えられたため、自動生成したガイドは保存しません。');
      }
      if (isPlainObject_(initialBuildData.skeleton) && Array.isArray(initialBuildData.ledger)) {
        const readiness = computeLedgerReadiness_(initialBuildData.skeleton, initialBuildData.ledger);
        assertApp_(readiness.gatePassed && initialBuildData.gatePassed === true, 'GATE_NOT_PASSED', '準備度ゲートを通過したガイドだけ保存できます。', { holes: readiness.holes });
        const ledgerErrors = assessGuideAgainstLedger_(payload.workGuide, initialBuildData.ledger);
        assertApp_(!ledgerErrors.length, 'LEDGER_MISMATCH', '編集後のガイドが知識台帳と一致しないため保存できません。', { errors: ledgerErrors });
        if (initialBuildData.creationMode !== 'automatic') {
          assertApp_(initialBuildData.deskReview && initialBuildData.deskReview.passed === true, 'DESK_REVIEW_REQUIRED', '机上実行レビューで「完走」を確認してから保存してください。');
          assertApp_(initialBuildData.deskReview.guideFingerprint === fingerprint_(payload.workGuide), 'DESK_REVIEW_STALE', '机上実行レビュー後に内容が変わっています。編集内容を一時保存し、最終稿でもう一度机上実行レビューを行ってください。');
        }
      }
    }
    lock.waitLock(30000);
    requestRow = findRow_('SaveRequests', function (row) { return String(row.requestToken) === String(payload.requestToken); });
    const targetStatus = payload.reviewRequired === true ? APP_CONFIG.statuses.guideNeedsReview : APP_CONFIG.statuses.guideReady;
    const fingerprint = fingerprint_({ workGuide: payload.workGuide, targetStatus: targetStatus });
    if (requestRow) {
      state = parseJsonCell_(requestRow.resultJson, {});
      assertApp_(!state.fingerprint || state.fingerprint === fingerprint, 'REQUEST_TOKEN_REUSED', '同じ保存リクエスト識別子を異なる内容に再利用できません。');
      if (state.success === true) return Object.assign({}, state, { duplicateRequest: true });
      completed.documentCreated = Boolean(state.completed && state.completed.documentCreated);
      completed.jsonCreated = Boolean(state.completed && state.completed.jsonCreated);
      completed.spreadsheetUpdated = Boolean(state.completed && state.completed.spreadsheetUpdated);
      state.targetStatus = state.targetStatus || targetStatus;
    }
    if (payload.buildSessionId) {
      const lockedBuild = requireBuildSession_(payload.buildSessionId);
      assertApp_(['in_progress', 'draft'].indexOf(String(lockedBuild.status)) >= 0 || completed.spreadsheetUpdated, 'BUILD_SESSION_CLOSED', 'この作成セッションは終了済みです。');
      if (payload.generationMode === 'automatic') {
        const lockedBuildData = parseJsonCell_(lockedBuild.dataJson, {});
        assertApp_(lockedBuildData.creationMode === 'automatic', 'MANUAL_BUILD_IN_PROGRESS', '手動作成へ切り替えられたため、自動生成したガイドは保存しません。');
      }
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
        documentFileId: '', jsonFileId: '', targetStatus: targetStatus, createdAt: nowIso_()
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
      documentFile.moveTo(getFolderByPath_(state.targetStatus === APP_CONFIG.statuses.guideNeedsReview ? APP_CONFIG.folderPaths.guideNeedsReview : APP_CONFIG.folderPaths.guideReady));
      state.documentFileId = documentFile.getId();
      completed.documentCreated = true;
      persistSaveState_(requestRow, state, completed);
    }
    if (!completed.jsonCreated) {
      const jsonFile = createJsonFile_(getFolderByPath_(state.targetStatus === APP_CONFIG.statuses.guideNeedsReview ? APP_CONFIG.folderPaths.guideNeedsReview : APP_CONFIG.folderPaths.guideReady), guide.workGuideId + '_v' + guide.version + '.json', guide);
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
          actionId: action.actionId, meetingId: action.meetingId, title: guide.title, status: state.targetStatus,
          currentVersion: guide.version, documentFileId: state.documentFileId, jsonFileId: state.jsonFileId, updatedAt: now,
          reviewedAt: state.targetStatus === APP_CONFIG.statuses.guideReady ? now : '', reviewNote: '',
          generationMode: payload.generationMode || existingGuide.generationMode || 'manual', autoReviewJson: payload.autoReview || {}
        });
      } else {
        appendObject_('WorkGuides', {
          workGuideId: guide.workGuideId, actionId: action.actionId, meetingId: action.meetingId, title: guide.title,
          status: state.targetStatus, currentVersion: guide.version,
          documentFileId: state.documentFileId, jsonFileId: state.jsonFileId, createdAt: now, updatedAt: now, lastExecutedAt: '',
          reviewedAt: state.targetStatus === APP_CONFIG.statuses.guideReady ? now : '', reviewNote: '',
          generationMode: payload.generationMode || 'manual', autoReviewJson: payload.autoReview || {}
        });
      }
      updateRow_('Actions', action._rowNumber, { status: state.targetStatus === APP_CONFIG.statuses.guideNeedsReview ? 'guide_review' : 'guide_ready' });
      if (payload.buildSessionId) {
        const build = requireBuildSession_(payload.buildSessionId);
        updateRow_('WorkGuideBuildSessions', build._rowNumber, { currentStep: 10, status: 'completed', updatedAt: now });
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

function approveWorkGuide(workGuideId, reviewNote) {
  return withClientError_(function () {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const record = requireWorkGuideRecord_(workGuideId);
      requirePassedQuizForMeeting_(record.meetingId);
      assertApp_(String(record.status) === APP_CONFIG.statuses.guideNeedsReview, 'GUIDE_NOT_WAITING_REVIEW', 'この作業ガイドは承認待ちではありません。');
      const documentFile = getFileSafely_(record.documentFileId);
      const jsonFile = getFileSafely_(record.jsonFileId);
      assertApp_(documentFile && jsonFile, 'GUIDE_FILE_NOT_FOUND', '承認対象のドキュメントまたはJSONが見つかりません。');
      const readyFolder = getFolderByPath_(APP_CONFIG.folderPaths.guideReady);
      documentFile.moveTo(readyFolder);
      jsonFile.moveTo(readyFolder);
      const reviewedAt = nowIso_();
      updateRow_('WorkGuides', record._rowNumber, {
        status: APP_CONFIG.statuses.guideReady, reviewedAt: reviewedAt,
        reviewNote: nonEmptyString_(reviewNote) ? reviewNote.trim() : '内容を確認し承認', updatedAt: reviewedAt
      });
      const action = requireAction_(record.actionId);
      updateRow_('Actions', action._rowNumber, { status: 'guide_ready', automationStatus: 'completed', automationError: '' });
      refreshMeetingAutomationStatus_(record.meetingId);
      return { success: true, workGuideId: workGuideId, status: APP_CONFIG.statuses.guideReady, reviewedAt: reviewedAt };
    } finally {
      lock.releaseLock();
    }
  });
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
    return { success: true, workGuides: guides.reverse().map(function (row) {
      const guide = stripRowMetadata_(row);
      guide.autoReview = parseJsonCell_(guide.autoReviewJson, {});
      delete guide.autoReviewJson;
      return guide;
    }) };
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
    const hydratedRecord = stripRowMetadata_(record);
    hydratedRecord.autoReview = parseJsonCell_(hydratedRecord.autoReviewJson, {});
    delete hydratedRecord.autoReviewJson;
    return { success: true, workGuide: guide, workGuideVersionId: versionId, record: hydratedRecord };
  });
}

function requireWorkGuideRecord_(workGuideId) {
  const row = findRow_('WorkGuides', function (guide) { return String(guide.workGuideId) === String(workGuideId); });
  assertApp_(row, 'WORK_GUIDE_NOT_FOUND', '作業ガイドが見つかりません。');
  return row;
}
