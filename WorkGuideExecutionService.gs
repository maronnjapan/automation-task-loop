function preflightWorkGuide(workGuideId, versionNo) {
  return withClientError_(function () {
    const loaded = getWorkGuideOrThrow_(workGuideId, versionNo);
    return { success: true, preflight: buildPreflight_(loaded.guide, loaded.record), workGuide: loaded.guide, workGuideVersionId: loaded.versionId };
  });
}

function startWorkGuideExecution(workGuideId, versionNo, warningConfirmed) {
  return withClientError_(function () {
    const loaded = getWorkGuideOrThrow_(workGuideId, versionNo);
    assertApp_(String(loaded.record.status) === APP_CONFIG.statuses.guideReady, 'GUIDE_APPROVAL_REQUIRED', '作業ガイドを承認してから実行してください。');
    const preflight = buildPreflight_(loaded.guide, loaded.record);
    assertApp_(preflight.level !== 'unavailable', 'PREFLIGHT_FAILED', '実行不可の項目を解消してください。', { checks: preflight.checks });
    if (preflight.level === 'warning') assertApp_(warningConfirmed === true, 'WARNING_CONFIRMATION_REQUIRED', '注意事項を確認してから続行してください。');
    const existing = findRow_('WorkGuideExecutions', function (row) {
      return String(row.workGuideId) === String(workGuideId) && String(row.workGuideVersionId) === String(loaded.versionId) && ['in_progress', 'paused'].indexOf(String(row.status)) >= 0;
    });
    if (existing) return { success: true, resumedExisting: true, execution: hydrateExecution_(existing), workGuide: loaded.guide };
    const execution = {
      executionId: createId_('EXEC'), workGuideId: workGuideId, workGuideVersionId: loaded.versionId,
      status: APP_CONFIG.statuses.executionInProgress, currentStepId: loaded.guide.steps[0].stepId,
      startedAt: nowIso_(), pausedAt: '', completedAt: '',
      executionDataJson: { stepData: {}, completedStepIds: [], scriptResults: {}, preflight: preflight }, notes: ''
    };
    appendObject_('WorkGuideExecutions', execution);
    const guideRecord = requireWorkGuideRecord_(workGuideId);
    updateRow_('WorkGuides', guideRecord._rowNumber, { lastExecutedAt: execution.startedAt });
    return { success: true, execution: hydrateExecution_(execution), workGuide: loaded.guide };
  });
}

function getWorkGuideExecution(executionId) {
  return withClientError_(function () {
    const execution = requireExecution_(executionId);
    const versionNo = String(execution.workGuideVersionId).split('-V').pop();
    const loaded = getWorkGuideOrThrow_(execution.workGuideId, Number(versionNo));
    return { success: true, execution: hydrateExecution_(execution), workGuide: loaded.guide };
  });
}

function saveExecutionStep(executionId, inputValues, scriptParams) {
  return withClientError_(function () {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const execution = requireExecution_(executionId);
      assertApp_(execution.status === APP_CONFIG.statuses.executionInProgress, 'EXECUTION_NOT_ACTIVE', '実行を再開してから保存してください。');
      const versionNo = Number(String(execution.workGuideVersionId).split('-V').pop());
      const guide = getWorkGuideOrThrow_(execution.workGuideId, versionNo).guide;
      const steps = guide.steps.slice().sort(function (a, b) { return a.order - b.order; });
      const stepIndex = steps.findIndex(function (step) { return String(step.stepId) === String(execution.currentStepId); });
      assertApp_(stepIndex >= 0, 'STEP_NOT_FOUND', '現在の手順が作業ガイドにありません。');
      const step = steps[stepIndex];
      const data = parseJsonCell_(execution.executionDataJson, { stepData: {}, completedStepIds: [], scriptResults: {} });
      if (step.type === 'input') {
        validateExecutionInputs_(step, inputValues || {});
        data.stepData[step.stepId] = inputValues || {};
      } else {
        const mergedParams = Object.assign({}, step.scriptParams || {}, scriptParams || {});
        data.stepData[step.stepId] = mergedParams;
        try {
          data.scriptResults[step.stepId] = { success: true, result: executeRegisteredAction_(step.scriptId, mergedParams), executedAt: nowIso_() };
        } catch (scriptError) {
          data.scriptResults[step.stepId] = { success: false, error: scriptError.message || String(scriptError), executedAt: nowIso_() };
          updateRow_('WorkGuideExecutions', execution._rowNumber, { executionDataJson: data });
          throw new AppError('SCRIPT_EXECUTION_FAILED', '登録スクリプトの実行に失敗しました。入力値を確認して再実行してください。', { stepId: step.stepId, scriptId: step.scriptId, error: scriptError.message || String(scriptError) });
        }
      }
      if (data.completedStepIds.indexOf(step.stepId) < 0) data.completedStepIds.push(step.stepId);
      const nextStep = steps[stepIndex + 1] || null;
      updateRow_('WorkGuideExecutions', execution._rowNumber, {
        currentStepId: nextStep ? nextStep.stepId : '', executionDataJson: data,
        notes: execution.notes || ''
      });
      return { success: true, completedStepId: step.stepId, nextStepId: nextStep ? nextStep.stepId : '', allStepsCompleted: !nextStep, executionData: data };
    } finally {
      lock.releaseLock();
    }
  });
}

function pauseWorkGuideExecution(executionId, notes) {
  return withClientError_(function () {
    const execution = requireExecution_(executionId);
    assertApp_(execution.status === APP_CONFIG.statuses.executionInProgress, 'EXECUTION_NOT_ACTIVE', '進行中の実行だけ中断できます。');
    updateRow_('WorkGuideExecutions', execution._rowNumber, { status: APP_CONFIG.statuses.executionPaused, pausedAt: nowIso_(), notes: notes || '' });
    return { success: true };
  });
}

function resumeWorkGuideExecution(executionId) {
  return withClientError_(function () {
    const execution = requireExecution_(executionId);
    assertApp_(execution.status === APP_CONFIG.statuses.executionPaused, 'EXECUTION_NOT_PAUSED', '中断中の実行だけ再開できます。');
    updateRow_('WorkGuideExecutions', execution._rowNumber, { status: APP_CONFIG.statuses.executionInProgress, pausedAt: '', notes: execution.notes || '' });
    return { success: true };
  });
}

function completeWorkGuideExecution(executionId, notes) {
  return withClientError_(function () {
    const execution = requireExecution_(executionId);
    assertApp_([APP_CONFIG.statuses.executionInProgress, APP_CONFIG.statuses.executionPaused].indexOf(String(execution.status)) >= 0, 'EXECUTION_CLOSED', 'この実行は完了済みです。');
    const versionNo = Number(String(execution.workGuideVersionId).split('-V').pop());
    const guide = getWorkGuideOrThrow_(execution.workGuideId, versionNo).guide;
    const data = parseJsonCell_(execution.executionDataJson, {});
    const completedIds = data.completedStepIds || [];
    const missing = guide.steps.filter(function (step) { return completedIds.indexOf(step.stepId) < 0; });
    assertApp_(!missing.length, 'INCOMPLETE_STEPS', '未完了の手順があります。', { stepIds: missing.map(function (step) { return step.stepId; }) });
    const completedAt = nowIso_();
    updateRow_('WorkGuideExecutions', execution._rowNumber, {
      status: APP_CONFIG.statuses.executionCompleted, currentStepId: '', completedAt: completedAt, notes: notes || execution.notes || ''
    });
    const resultFile = createJsonFile_(getFolderByPath_(APP_CONFIG.folderPaths.executionResults), execution.executionId + '.json', {
      executionId: execution.executionId, workGuideId: execution.workGuideId, workGuideVersionId: execution.workGuideVersionId,
      startedAt: execution.startedAt, completedAt: completedAt, executionData: data, notes: notes || execution.notes || ''
    });
    return { success: true, completedAt: completedAt, resultFileId: resultFile.getId(), resultFileUrl: resultFile.getUrl() };
  });
}

function listWorkGuideExecutions(workGuideId) {
  return withClientError_(function () {
    const completed = completedMeetingIds_();
    const guideMeeting = {};
    getRows_('WorkGuides').forEach(function (row) { guideMeeting[String(row.workGuideId)] = String(row.meetingId); });
    const rows = findRows_('WorkGuideExecutions', function (row) {
      if (workGuideId && String(row.workGuideId) !== String(workGuideId)) return false;
      return !completed[guideMeeting[String(row.workGuideId)]];
    });
    return { success: true, executions: rows.reverse().map(hydrateExecution_) };
  });
}

function buildPreflight_(guide, record) {
  const checks = [];
  if (record && String(record.status) !== APP_CONFIG.statuses.guideReady) {
    checks.push(preflightCheck_('guide_approval', 'unavailable', 'この作業ガイドは承認待ちです。内容を確認して「このガイドでOK」を押してください。'));
  }
  guide.sourceSnapshots.forEach(function (snapshot) {
    const file = getFileSafely_(snapshot.fileId);
    if (!file) checks.push(preflightCheck_('source_exists:' + snapshot.fileId, 'unavailable', snapshot.fileName + ' が見つかりません。'));
    else if (file.getLastUpdated().getTime() > new Date(snapshot.snapshotAt).getTime() + 1000) checks.push(preflightCheck_('source_updated:' + snapshot.fileId, 'warning', snapshot.fileName + ' はガイド作成後に更新されています。'));
    else checks.push(preflightCheck_('source_current:' + snapshot.fileId, 'ok', snapshot.fileName + ' はスナップショット時点から更新されていません。'));
  });
  guide.steps.forEach(function (step) {
    if (step.url) {
      checks.push(preflightCheck_('url:' + step.stepId, isAllowedUrl_(step.url) ? 'ok' : 'unavailable', isAllowedUrl_(step.url) ? 'URL形式は有効です。' : 'URL形式が不正です。'));
      const driveTargetId = extractDriveTargetId_(step.url);
      if (driveTargetId) {
        const targetExists = driveTargetExists_(driveTargetId);
        checks.push(preflightCheck_('drive_target:' + step.stepId, targetExists ? 'ok' : 'unavailable', targetExists ? 'URLの対象ファイルまたはフォルダが存在します。' : 'URLの対象ファイルまたはフォルダが見つかりません。'));
      }
    }
    if (step.type === 'script') {
      const registered = getRegisteredScriptIds_().indexOf(String(step.scriptId)) >= 0;
      checks.push(preflightCheck_('script:' + step.stepId, registered ? 'ok' : 'unavailable', registered ? step.scriptId + ' は登録済みです。' : step.scriptId + ' は未登録です。'));
      if (registered) {
        const implementation = ALLOWED_ACTION_IMPLEMENTATIONS[step.scriptId];
        if (!implementation) {
          checks.push(preflightCheck_('script_implementation:' + step.stepId, 'unavailable', step.scriptId + ' の実装がコードにありません。'));
        } else try { validateScriptParams_(implementation.params, step.scriptParams || {}); checks.push(preflightCheck_('script_params:' + step.stepId, 'ok', '必要な固定パラメータがそろっています。')); }
        catch (error) { checks.push(preflightCheck_('script_params:' + step.stepId, 'warning', error.message + ' 実行画面で入力してください。')); }
      }
    }
  });
  guide.prerequisites.forEach(function (prerequisite, index) {
    checks.push(preflightCheck_('prerequisite:' + index, 'warning', '現在も有効か本人確認: ' + prerequisite));
  });
  const level = checks.some(function (check) { return check.level === 'unavailable'; }) ? 'unavailable' : checks.some(function (check) { return check.level === 'warning'; }) ? 'warning' : 'ok';
  return { level: level, label: level === 'ok' ? '問題なし' : level === 'warning' ? '注意あり' : '実行不可', checkedAt: nowIso_(), checks: checks };
}

function preflightCheck_(id, level, message) { return { id: id, level: level, message: message }; }

function extractDriveTargetId_(url) {
  if (!/https?:\/\/(?:drive|docs)\.google\.com\//i.test(String(url))) return '';
  const pathMatch = String(url).match(/\/(?:d|folders)\/([A-Za-z0-9_-]{10,})/);
  if (pathMatch) return pathMatch[1];
  const queryMatch = String(url).match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return queryMatch ? queryMatch[1] : '';
}

function driveTargetExists_(targetId) {
  if (getFileSafely_(targetId)) return true;
  try {
    const folder = DriveApp.getFolderById(targetId);
    folder.getName();
    return true;
  } catch (error) {
    return false;
  }
}

function validateExecutionInputs_(step, values) {
  assertApp_(isPlainObject_(values), 'VALIDATION_ERROR', '入力値の形式が不正です。');
  (step.inputs || []).forEach(function (input) {
    const value = values[input.inputId];
    if (input.required) {
      const filled = input.inputType === 'check' ? value === true : value !== undefined && value !== null && String(value).trim() !== '';
      assertApp_(filled, 'REQUIRED_INPUT_MISSING', input.label + ' を入力してください。');
    }
    if (input.inputType === 'choice' && value !== undefined) assertApp_(input.choices.indexOf(value) >= 0, 'INVALID_CHOICE', input.label + ' は一覧から選択してください。');
  });
}

function requireExecution_(executionId) {
  const row = findRow_('WorkGuideExecutions', function (execution) { return String(execution.executionId) === String(executionId); });
  assertApp_(row, 'EXECUTION_NOT_FOUND', '実行セッションが見つかりません。');
  return row;
}

function hydrateExecution_(row) {
  const execution = stripRowMetadata_(row);
  execution.executionData = parseJsonCell_(execution.executionDataJson, {});
  delete execution.executionDataJson;
  return execution;
}

function getWorkGuideOrThrow_(workGuideId, versionNo) {
  const record = requireWorkGuideRecord_(workGuideId);
  let fileId = record.jsonFileId;
  let actualVersion = Number(record.currentVersion);
  if (versionNo && Number(versionNo) !== actualVersion) {
    const version = findRow_('WorkGuideVersions', function (row) { return String(row.workGuideId) === String(workGuideId) && Number(row.versionNo) === Number(versionNo); });
    assertApp_(version, 'WORK_GUIDE_VERSION_NOT_FOUND', '指定バージョンが見つかりません。');
    fileId = version.jsonFileId;
    actualVersion = Number(version.versionNo);
  }
  const guide = JSON.parse(readTextFile_(fileId, APP_CONFIG.maxTranscriptCharacters));
  return { guide: guide, versionId: workGuideId + '-V' + actualVersion, record: record };
}
