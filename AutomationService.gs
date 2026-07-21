/**
 * 時間主導トリガーによる文字起こし登録と、任意の生成AI自動処理。
 * API未設定時は従来どおり登録だけを行い、手動フローへ引き継ぐ。
 */
const AUTO_REGISTER_HANDLER = 'autoRegisterNewTranscripts';
const AUTO_REGISTER_INTERVAL_MINUTES = 5;
const AUTO_REGISTER_LAST_RUN_KEY = 'AUTO_REGISTER_LAST_RUN';

function getAutomationStatus() {
  return withClientError_(function () {
    const lastRun = parseJsonCell_(PropertiesService.getScriptProperties().getProperty(AUTO_REGISTER_LAST_RUN_KEY), null);
    return {
      success: true,
      autoRegisterEnabled: findAutoRegisterTriggers_().length > 0,
      intervalMinutes: AUTO_REGISTER_INTERVAL_MINUTES,
      lastRun: lastRun,
      aiAutomation: getAiAutomationSettings_()
    };
  });
}

function setAutoRegisterEnabled(enabled) {
  return withClientError_(function () {
    const existing = findAutoRegisterTriggers_();
    if (enabled) {
      requireConfigured_();
      if (!existing.length) ScriptApp.newTrigger(AUTO_REGISTER_HANDLER).timeBased().everyMinutes(AUTO_REGISTER_INTERVAL_MINUTES).create();
    } else {
      existing.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    }
    return { success: true, autoRegisterEnabled: Boolean(enabled) };
  });
}

function findAutoRegisterTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === AUTO_REGISTER_HANDLER;
  });
}

function refreshAutoRegisterTriggerSchedule_() {
  const existing = findAutoRegisterTriggers_();
  if (!existing.length) return false;
  ScriptApp.newTrigger(AUTO_REGISTER_HANDLER).timeBased().everyMinutes(AUTO_REGISTER_INTERVAL_MINUTES).create();
  existing.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  return true;
}

/**
 * トリガー本体。01_文字起こし配下(完了フォルダを除く)の未登録ファイルを
 * 会議として登録する。タイトルはファイル名、カテゴリーは格納フォルダから
 * 自動判定される(手動登録と同じ規則)。管理画面の「今すぐ実行」からも呼ばれる。
 */
function autoRegisterNewTranscripts(forceRetry) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, error: '別の処理が実行中のため自動登録をスキップしました。' };
  const summary = { ranAt: nowIso_(), registered: [], skipped: [], analyzedMeetings: [], generatedGuides: [], automationFailures: [], automationPending: [] };
  try {
    const settings = getAppSettings();
    if (!settings.rootFolderId || !settings.spreadsheetId) {
      summary.skipped.push({ name: '(全体)', reason: '初期設定が未完了のため何も行いませんでした。' });
    } else {
      ensureManagementSchemaCurrent_();
      ensureFolderPath_(getRootFolder_(), APP_CONFIG.folderPaths.aiInteractionLogs);
      const listed = listTranscriptFiles();
      const files = listed.success ? listed.files : [];
      files.forEach(function (file) {
        const result = registerMeeting({ transcriptFileId: file.fileId });
        if (result.success) {
          summary.registered.push({ name: file.name, meetingId: result.meeting.meetingId, category: result.meeting.category });
        } else {
          summary.skipped.push({ name: file.name, reason: result.error });
        }
      });
    }
  } finally {
    lock.releaseLock();
  }
  try {
    processPendingAiAutomation_(summary, forceRetry === true);
  } catch (error) {
    summary.automationFailures.push({ phase: 'automation_queue', error: error.message || String(error) });
  }
  PropertiesService.getScriptProperties().setProperty(AUTO_REGISTER_LAST_RUN_KEY, JSON.stringify(summary));
  return { success: true, summary: summary };
}

function runAutoRegisterNow() {
  return withClientError_(function () {
    const result = autoRegisterNewTranscripts(true);
    assertApp_(result.success, 'AUTO_REGISTER_BUSY', result.error || '自動登録を実行できませんでした。');
    return result;
  });
}

/**
 * 複数の作業ガイド、または複数回の実行で繰り返されている input 手順を検出する。
 * 手順名を正規化(数字・記号・空白を除去)して同一視し、
 * 「2つ以上のガイドに存在」または「累計2回以上実行」されたものを候補として返す。
 */
function listAutomationCandidates() {
  return withClientError_(function () {
    requireConfigured_();
    const guideTitles = {};
    getRows_('WorkGuides').forEach(function (row) { guideTitles[String(row.workGuideId)] = String(row.title); });

    const latestByGuide = {};
    getRows_('WorkGuideVersions').forEach(function (row) {
      const id = String(row.workGuideId);
      if (!latestByGuide[id] || Number(row.versionNo) > Number(latestByGuide[id].versionNo)) latestByGuide[id] = row;
    });

    const executedCounts = {};
    getRows_('WorkGuideExecutions').forEach(function (row) {
      const data = parseJsonCell_(row.executionDataJson, {});
      (data.completedStepIds || []).forEach(function (stepId) {
        const key = String(row.workGuideId) + ':' + String(stepId);
        executedCounts[key] = (executedCounts[key] || 0) + 1;
      });
    });

    const groups = {};
    Object.keys(latestByGuide).forEach(function (workGuideId) {
      parseJsonCell_(latestByGuide[workGuideId].stepsJson, []).forEach(function (step) {
        if (String(step.type) !== 'input') return;
        const key = normalizeStepKey_(step.title);
        if (!key) return;
        if (!groups[key]) groups[key] = { sampleTitle: String(step.title), occurrences: [], executionCount: 0 };
        groups[key].occurrences.push({
          workGuideId: workGuideId,
          guideTitle: guideTitles[workGuideId] || workGuideId,
          stepTitle: String(step.title),
          url: String(step.url || '')
        });
        groups[key].executionCount += executedCounts[workGuideId + ':' + step.stepId] || 0;
      });
    });

    const candidates = Object.keys(groups).map(function (key) {
      const group = groups[key];
      const guideIds = {};
      group.occurrences.forEach(function (occurrence) { guideIds[occurrence.workGuideId] = true; });
      group.guideCount = Object.keys(guideIds).length;
      return group;
    }).filter(function (group) {
      return group.guideCount >= 2 || group.executionCount >= 2;
    }).sort(function (a, b) {
      return (b.guideCount + b.executionCount) - (a.guideCount + a.executionCount);
    }).slice(0, 20);

    return { success: true, candidates: candidates };
  });
}

function normalizeStepKey_(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[0-9０-９]/g, '')
    .replace(/[\s、。・,．.:：;／/()（）\[\]「」『』【】\-ー_~〜]/g, '');
}
