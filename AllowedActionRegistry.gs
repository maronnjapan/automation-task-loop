const ALLOWED_ACTION_IMPLEMENTATIONS = Object.freeze({
  UTILITY_TIMESTAMP: Object.freeze({
    name: '現在日時を記録',
    description: '実行時点の ISO 8601 日時とタイムゾーンを返します。',
    params: [],
    impactNote: 'Drive や外部データは変更しません。実行結果に日時を記録します。',
    handler: registeredActionTimestamp_
  }),
  DRIVE_COPY_FILE: Object.freeze({
    name: 'Drive ファイルを複製',
    description: '指定ファイルを指定フォルダへ、指定名で複製します。',
    params: [
      { name: 'sourceFileId', type: 'string', required: true, label: '複製元ファイルID' },
      { name: 'destinationFolderId', type: 'string', required: true, label: '保存先フォルダID' },
      { name: 'newName', type: 'string', required: true, label: '複製後の名前' }
    ],
    impactNote: '指定した Drive フォルダに新しいファイルを1件作成します。元ファイルは変更しません。',
    handler: registeredActionCopyDriveFile_
  }),
  DRIVE_MOVE_FILE: Object.freeze({
    name: 'Drive ファイルを移動',
    description: '指定ファイルを指定フォルダへ移動します。',
    params: [
      { name: 'sourceFileId', type: 'string', required: true, label: '移動するファイルID' },
      { name: 'destinationFolderId', type: 'string', required: true, label: '移動先フォルダID' }
    ],
    impactNote: 'ファイルの格納場所が変わります。ファイルの内容は変更しません。',
    handler: registeredActionMoveDriveFile_
  }),
  DRIVE_CREATE_FOLDER: Object.freeze({
    name: 'Drive フォルダを作成',
    description: '指定フォルダの直下にサブフォルダを作成します。同名フォルダがあればそれを返します。',
    params: [
      { name: 'parentFolderId', type: 'string', required: true, label: '親フォルダID' },
      { name: 'folderName', type: 'string', required: true, label: '作成するフォルダ名' }
    ],
    impactNote: '指定した親フォルダにサブフォルダを最大1件作成します。既存フォルダは変更しません。',
    handler: registeredActionCreateDriveFolder_
  }),
  DOC_CREATE_TEXT: Object.freeze({
    name: 'Google ドキュメントを作成',
    description: '指定フォルダに、指定タイトル・本文の Google ドキュメントを新規作成します。',
    params: [
      { name: 'destinationFolderId', type: 'string', required: true, label: '保存先フォルダID' },
      { name: 'title', type: 'string', required: true, label: 'ドキュメントのタイトル' },
      { name: 'body', type: 'string', required: false, label: '本文(省略可)' }
    ],
    impactNote: '指定した Drive フォルダに新しいドキュメントを1件作成します。既存ファイルは変更しません。',
    handler: registeredActionCreateDocument_
  }),
  SHEET_APPEND_ROW: Object.freeze({
    name: 'スプレッドシートへ行を追加',
    description: '指定スプレッドシートの指定シート末尾に1行追記します。値はカンマ区切りで指定します。',
    params: [
      { name: 'spreadsheetId', type: 'string', required: true, label: 'スプレッドシートID' },
      { name: 'sheetName', type: 'string', required: false, label: 'シート名(省略時は先頭シート)' },
      { name: 'values', type: 'string', required: true, label: '追記する値(カンマ区切り)' }
    ],
    impactNote: '指定したスプレッドシートの末尾に1行追加します。既存の行は変更しません。',
    handler: registeredActionAppendSheetRow_
  }),
  GMAIL_CREATE_DRAFT: Object.freeze({
    name: 'Gmail 下書きを作成',
    description: '宛先・件名・本文を指定して Gmail の下書きを作成します。送信はしません。',
    params: [
      { name: 'to', type: 'string', required: true, label: '宛先メールアドレス' },
      { name: 'subject', type: 'string', required: true, label: '件名' },
      { name: 'body', type: 'string', required: true, label: '本文' }
    ],
    impactNote: 'Gmail に下書きを1件作成します。メールの自動送信は行いません(送信は本人が下書きを確認して行います)。',
    handler: registeredActionCreateGmailDraft_
  }),
  CALENDAR_CREATE_EVENT: Object.freeze({
    name: 'カレンダー予定を作成',
    description: 'デフォルトカレンダーへ、タイトル・開始・終了日時を指定して予定を作成します。',
    params: [
      { name: 'title', type: 'string', required: true, label: '予定のタイトル' },
      { name: 'startAt', type: 'string', required: true, label: '開始日時(ISO 8601)' },
      { name: 'endAt', type: 'string', required: true, label: '終了日時(ISO 8601)' },
      { name: 'description', type: 'string', required: false, label: '説明(省略可)' }
    ],
    impactNote: '本人のデフォルトカレンダーに予定を1件作成します。ゲスト招待や通知の自動送信は行いません。',
    handler: registeredActionCreateCalendarEvent_
  })
});

function listAllowedActions() {
  return withClientError_(function () {
    return { success: true, registered: listRegisteredActions_(), available: listAvailableActionImplementations_() };
  });
}

function registerAllowedAction(scriptId) {
  return withClientError_(function () {
    const definition = ALLOWED_ACTION_IMPLEMENTATIONS[String(scriptId)];
    assertApp_(definition, 'UNKNOWN_SCRIPT', 'コードに実装されていないスクリプトは登録できません。');
    const existing = findRow_('AllowedActionRegistry', function (row) { return String(row.scriptId) === String(scriptId); });
    assertApp_(!existing, 'DUPLICATE_SCRIPT', 'このスクリプトは登録済みです。');
    appendObject_('AllowedActionRegistry', {
      scriptId: scriptId, name: definition.name, description: definition.description,
      paramsJson: definition.params, impactNote: definition.impactNote, registeredAt: nowIso_()
    });
    return { success: true, scriptId: scriptId };
  });
}

function unregisterAllowedAction(scriptId) {
  return withClientError_(function () {
    const existing = findRow_('AllowedActionRegistry', function (row) { return String(row.scriptId) === String(scriptId); });
    assertApp_(existing, 'SCRIPT_NOT_REGISTERED', '登録スクリプトが見つかりません。');
    const used = getRows_('WorkGuideVersions').some(function (row) {
      return parseJsonCell_(row.stepsJson, []).some(function (step) { return step.type === 'script' && String(step.scriptId) === String(scriptId); });
    });
    assertApp_(!used, 'SCRIPT_IN_USE', '保存済み作業ガイドが参照しているため削除できません。');
    getSheet_('AllowedActionRegistry').deleteRow(existing._rowNumber);
    return { success: true, scriptId: scriptId };
  });
}

function getRegisteredScriptIds_() {
  if (!getAppSettings().spreadsheetId) return [];
  return getRows_('AllowedActionRegistry').map(function (row) { return String(row.scriptId); });
}

function listRegisteredActions_() {
  if (!getAppSettings().spreadsheetId) return [];
  return getRows_('AllowedActionRegistry').map(function (row) {
    return {
      scriptId: String(row.scriptId), name: String(row.name), description: String(row.description),
      params: parseJsonCell_(row.paramsJson, []), impactNote: String(row.impactNote)
    };
  });
}

function listAvailableActionImplementations_() {
  const registered = getRegisteredScriptIds_();
  return Object.keys(ALLOWED_ACTION_IMPLEMENTATIONS).map(function (scriptId) {
    const definition = ALLOWED_ACTION_IMPLEMENTATIONS[scriptId];
    return { scriptId: scriptId, name: definition.name, description: definition.description, params: definition.params, impactNote: definition.impactNote, registered: registered.indexOf(scriptId) >= 0 };
  });
}

function executeRegisteredAction_(scriptId, params) {
  const registry = findRow_('AllowedActionRegistry', function (row) { return String(row.scriptId) === String(scriptId); });
  assertApp_(registry, 'SCRIPT_NOT_REGISTERED', '登録されていないスクリプトは実行できません。');
  const implementation = ALLOWED_ACTION_IMPLEMENTATIONS[String(scriptId)];
  assertApp_(implementation && typeof implementation.handler === 'function', 'SCRIPT_IMPLEMENTATION_MISSING', '登録スクリプトの実装が見つかりません。');
  validateScriptParams_(implementation.params, params);
  return implementation.handler(params || {});
}

function validateScriptParams_(definitions, params) {
  assertApp_(isPlainObject_(params), 'VALIDATION_ERROR', 'スクリプトパラメータはオブジェクトです。');
  definitions.forEach(function (definition) {
    const value = params[definition.name];
    if (definition.required) assertApp_(value !== undefined && value !== null && String(value).trim() !== '', 'SCRIPT_PARAM_REQUIRED', definition.label + ' は必須です。');
    if (value !== undefined && definition.type === 'string') assertApp_(typeof value === 'string', 'SCRIPT_PARAM_TYPE', definition.label + ' は文字列です。');
  });
}

function registeredActionTimestamp_() {
  return { executedAt: nowIso_(), timeZone: Session.getScriptTimeZone() };
}

function registeredActionCopyDriveFile_(params) {
  const source = getFileSafely_(params.sourceFileId);
  assertApp_(source, 'FILE_NOT_FOUND', '複製元ファイルが見つかりません。');
  const destination = getFolderSafely_(params.destinationFolderId);
  assertApp_(destination, 'FOLDER_NOT_FOUND', '保存先フォルダが見つかりません。');
  const copy = source.makeCopy(params.newName.trim(), destination);
  return { fileId: copy.getId(), name: copy.getName(), url: copy.getUrl(), createdAt: nowIso_() };
}

function registeredActionMoveDriveFile_(params) {
  const source = getFileSafely_(params.sourceFileId);
  assertApp_(source, 'FILE_NOT_FOUND', '移動するファイルが見つかりません。');
  const destination = getFolderSafely_(params.destinationFolderId);
  assertApp_(destination, 'FOLDER_NOT_FOUND', '移動先フォルダが見つかりません。');
  source.moveTo(destination);
  return { fileId: source.getId(), name: source.getName(), url: source.getUrl(), movedTo: destination.getName(), movedAt: nowIso_() };
}

function registeredActionCreateDriveFolder_(params) {
  const parent = getFolderSafely_(params.parentFolderId);
  assertApp_(parent, 'FOLDER_NOT_FOUND', '親フォルダが見つかりません。');
  const folder = ensureFolderPath_(parent, [params.folderName.trim()]);
  return { folderId: folder.getId(), name: folder.getName(), url: folder.getUrl(), createdAt: nowIso_() };
}

function registeredActionCreateDocument_(params) {
  const destination = getFolderSafely_(params.destinationFolderId);
  assertApp_(destination, 'FOLDER_NOT_FOUND', '保存先フォルダが見つかりません。');
  const document = DocumentApp.create(params.title.trim());
  if (params.body) document.getBody().setText(String(params.body));
  document.saveAndClose();
  const file = DriveApp.getFileById(document.getId());
  file.moveTo(destination);
  return { fileId: file.getId(), name: file.getName(), url: file.getUrl(), createdAt: nowIso_() };
}

function registeredActionAppendSheetRow_(params) {
  let spreadsheet;
  try { spreadsheet = SpreadsheetApp.openById(String(params.spreadsheetId)); } catch (error) { spreadsheet = null; }
  assertApp_(spreadsheet, 'SPREADSHEET_NOT_FOUND', '指定したスプレッドシートを開けません。');
  const sheet = params.sheetName ? spreadsheet.getSheetByName(String(params.sheetName)) : spreadsheet.getSheets()[0];
  assertApp_(sheet, 'SHEET_NOT_FOUND', '指定したシートが見つかりません: ' + params.sheetName);
  const values = String(params.values).split(',').map(function (value) { return value.trim(); });
  sheet.appendRow(values);
  return { spreadsheetId: spreadsheet.getId(), sheetName: sheet.getName(), appendedRow: sheet.getLastRow(), values: values, appendedAt: nowIso_() };
}

function registeredActionCreateGmailDraft_(params) {
  assertApp_(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(params.to).trim()), 'VALIDATION_ERROR', '宛先メールアドレスの形式が不正です。');
  const draft = GmailApp.createDraft(params.to.trim(), params.subject.trim(), String(params.body));
  return { draftId: draft.getId(), to: params.to.trim(), subject: params.subject.trim(), createdAt: nowIso_() };
}

function registeredActionCreateCalendarEvent_(params) {
  const start = new Date(String(params.startAt));
  const end = new Date(String(params.endAt));
  assertApp_(!isNaN(start.getTime()), 'VALIDATION_ERROR', '開始日時は ISO 8601 形式で指定してください。');
  assertApp_(!isNaN(end.getTime()), 'VALIDATION_ERROR', '終了日時は ISO 8601 形式で指定してください。');
  assertApp_(end.getTime() > start.getTime(), 'VALIDATION_ERROR', '終了日時は開始日時より後にしてください。');
  const event = CalendarApp.getDefaultCalendar().createEvent(params.title.trim(), start, end, { description: String(params.description || '') });
  return { eventId: event.getId(), title: event.getTitle(), startAt: start.toISOString(), endAt: end.toISOString(), createdAt: nowIso_() };
}

function getFolderSafely_(folderId) {
  if (!folderId) return null;
  try {
    const folder = DriveApp.getFolderById(String(folderId));
    folder.getName();
    return folder;
  } catch (error) {
    return null;
  }
}
