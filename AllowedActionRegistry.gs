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
  let destination;
  try { destination = DriveApp.getFolderById(params.destinationFolderId); destination.getName(); } catch (error) { destination = null; }
  assertApp_(destination, 'FOLDER_NOT_FOUND', '保存先フォルダが見つかりません。');
  const copy = source.makeCopy(params.newName.trim(), destination);
  return { fileId: copy.getId(), name: copy.getName(), url: copy.getUrl(), createdAt: nowIso_() };
}
