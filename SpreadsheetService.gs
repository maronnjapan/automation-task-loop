function getManagementSpreadsheet_() {
  const settings = requireConfigured_();
  try {
    return SpreadsheetApp.openById(settings.spreadsheetId);
  } catch (error) {
    throw new AppError('SPREADSHEET_UNAVAILABLE', '管理スプレッドシートを開けません。設定または権限を確認してください。');
  }
}

function getSheet_(sheetName) {
  const sheet = getManagementSpreadsheet_().getSheetByName(sheetName);
  assertApp_(sheet, 'SHEET_NOT_FOUND', sheetName + ' シートがありません。runSetupGuide() を再実行してください。');
  return sheet;
}

function appendObject_(sheetName, value) {
  const headers = SHEET_DEFINITIONS[sheetName];
  assertApp_(headers, 'UNKNOWN_SHEET', '未定義のシートです: ' + sheetName);
  const row = headers.map(function (header) {
    const cell = value[header];
    if (cell === undefined || cell === null) return '';
    return typeof cell === 'object' ? JSON.stringify(cell) : cell;
  });
  const lock = LockService.getScriptLock();
  const alreadyHeld = lock.hasLock();
  if (!alreadyHeld) lock.waitLock(30000);
  try {
    const sheet = getSheet_(sheetName);
    const range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length);
    range.setNumberFormat('@').setValues([row]);
    return value;
  } finally {
    if (!alreadyHeld) lock.releaseLock();
  }
}

function getRows_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(function (row) {
    return row.some(function (cell) { return cell !== ''; });
  }).map(function (row, index) {
    const object = { _rowNumber: index + 2 };
    headers.forEach(function (header, cellIndex) { object[header] = row[cellIndex]; });
    return object;
  });
}

function findRow_(sheetName, predicate) {
  const rows = getRows_(sheetName);
  for (let index = 0; index < rows.length; index += 1) {
    if (predicate(rows[index])) return rows[index];
  }
  return null;
}

function findRows_(sheetName, predicate) {
  return getRows_(sheetName).filter(predicate);
}

function updateRow_(sheetName, rowNumber, updates) {
  const headers = SHEET_DEFINITIONS[sheetName];
  const sheet = getSheet_(sheetName);
  Object.keys(updates).forEach(function (key) {
    const column = headers.indexOf(key) + 1;
    if (column < 1) return;
    const value = updates[key];
    sheet.getRange(rowNumber, column).setNumberFormat('@').setValue(typeof value === 'object' ? JSON.stringify(value) : value);
  });
}

function upsertObject_(sheetName, keyName, keyValue, value) {
  const existing = findRow_(sheetName, function (row) { return String(row[keyName]) === String(keyValue); });
  if (existing) {
    updateRow_(sheetName, existing._rowNumber, value);
    return Object.assign(existing, value);
  }
  return appendObject_(sheetName, value);
}

function parseJsonCell_(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return fallback;
  }
}
