/**
 * One-click setup and deployment guide.
 * Run this function from the Apps Script editor before deploying the web app.
 * It is idempotent: rerunning repairs missing folders/sheets without deleting data.
 */
function runSetupGuide() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    let rootFolder = null;
    const configuredRootId = properties.getProperty(APP_CONFIG.propertyKeys.rootFolderId);
    if (configuredRootId) {
      try { rootFolder = DriveApp.getFolderById(configuredRootId); } catch (ignored) { rootFolder = null; }
    }
    if (!rootFolder) {
      const roots = DriveApp.getFoldersByName(APP_CONFIG.rootFolderName);
      rootFolder = roots.hasNext() ? roots.next() : DriveApp.createFolder(APP_CONFIG.rootFolderName);
      properties.setProperty(APP_CONFIG.propertyKeys.rootFolderId, rootFolder.getId());
    }

    Object.keys(APP_CONFIG.folderPaths).forEach(function (key) {
      ensureFolderPath_(rootFolder, APP_CONFIG.folderPaths[key]);
    });
    const transcriptRoot = ensureFolderPath_(rootFolder, APP_CONFIG.folderPaths.transcripts);
    APP_CONFIG.categories.forEach(function (category) { ensureFolderPath_(transcriptRoot, [category]); });

    const managementFolder = ensureFolderPath_(rootFolder, APP_CONFIG.folderPaths.management);
    let spreadsheet = null;
    const configuredSpreadsheetId = properties.getProperty(APP_CONFIG.propertyKeys.spreadsheetId);
    if (configuredSpreadsheetId) {
      try { spreadsheet = SpreadsheetApp.openById(configuredSpreadsheetId); } catch (ignored) { spreadsheet = null; }
    }
    if (!spreadsheet) {
      spreadsheet = SpreadsheetApp.create(APP_CONFIG.managementSpreadsheetName);
      DriveApp.getFileById(spreadsheet.getId()).moveTo(managementFolder);
      properties.setProperty(APP_CONFIG.propertyKeys.spreadsheetId, spreadsheet.getId());
    }
    ensureManagementSheets_(spreadsheet);
    properties.setProperty(APP_CONFIG.propertyKeys.setupCompletedAt, nowIso_());

    const diagnostics = runSetupDiagnostics();
    return {
      success: diagnostics.every(function (item) { return item.status === 'ok'; }),
      rootFolderId: rootFolder.getId(),
      rootFolderUrl: rootFolder.getUrl(),
      spreadsheetId: spreadsheet.getId(),
      spreadsheetUrl: spreadsheet.getUrl(),
      diagnostics: diagnostics,
      nextSteps: [
        'runSetupDiagnostics() の全項目が「ok」であることを確認します。',
        'デプロイ > 新しいデプロイ > ウェブアプリを選びます。',
        '次のユーザーとして実行を「自分」、アクセスできるユーザーを「自分のみ」にします。',
        'デプロイ URL を開き、文字起こしファイルを登録します。'
      ]
    };
  } finally {
    lock.releaseLock();
  }
}

function ensureManagementSheets_(spreadsheet) {
  const requiredNames = Object.keys(SHEET_DEFINITIONS);
  requiredNames.forEach(function (sheetName) {
    let sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
    const headers = SHEET_DEFINITIONS[sheetName];
    const existing = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0] : [];
    headers.forEach(function (header, index) {
      if (!existing[index]) sheet.getRange(1, index + 1).setValue(header);
      else assertApp_(String(existing[index]) === header, 'SHEET_HEADER_MISMATCH', sheetName + ' の列 ' + (index + 1) + ' は「' + header + '」である必要があります。既存データを退避してから修正してください。');
    });
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#dbeafe');
    sheet.autoResizeColumns(1, headers.length);
  });
  const defaultSheet = spreadsheet.getSheetByName('シート1') || spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet && spreadsheet.getSheets().length > requiredNames.length) spreadsheet.deleteSheet(defaultSheet);
}

function runSetupDiagnostics() {
  const checks = [];
  const settings = getAppSettings();
  checks.push(diagnostic_('scriptProperties', Boolean(settings.rootFolderId && settings.spreadsheetId), '保存先IDが設定済み'));

  let root = null;
  try { root = DriveApp.getFolderById(settings.rootFolderId); root.getName(); } catch (error) { root = null; }
  checks.push(diagnostic_('rootFolder', Boolean(root), root ? root.getUrl() : 'ルートフォルダを開けません'));
  if (root) {
    Object.keys(APP_CONFIG.folderPaths).forEach(function (key) {
      try {
        const folder = getFolderByPath_(APP_CONFIG.folderPaths[key]);
        checks.push(diagnostic_('folder:' + key, Boolean(folder), APP_CONFIG.folderPaths[key].join('/')));
      } catch (error) {
        checks.push(diagnostic_('folder:' + key, false, error.message));
      }
    });
  }

  let spreadsheet = null;
  try { spreadsheet = SpreadsheetApp.openById(settings.spreadsheetId); } catch (error) { spreadsheet = null; }
  checks.push(diagnostic_('spreadsheet', Boolean(spreadsheet), spreadsheet ? spreadsheet.getUrl() : '管理スプレッドシートを開けません'));
  if (spreadsheet) {
    Object.keys(SHEET_DEFINITIONS).forEach(function (sheetName) {
      const sheet = spreadsheet.getSheetByName(sheetName);
      const actual = sheet ? sheet.getRange(1, 1, 1, SHEET_DEFINITIONS[sheetName].length).getValues()[0].map(String) : [];
      checks.push(diagnostic_('sheet:' + sheetName, JSON.stringify(actual) === JSON.stringify(SHEET_DEFINITIONS[sheetName]), sheet ? 'ヘッダー確認済み' : 'シートがありません'));
    });
  }
  checks.push(diagnostic_('webAppAccess', true, 'appsscript.json は MYSELF / USER_DEPLOYING。デプロイ画面でも「自分のみ」を確認してください。'));
  return checks;
}

function diagnostic_(name, ok, message) {
  return { name: name, status: ok ? 'ok' : 'error', message: message };
}
