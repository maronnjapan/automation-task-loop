function getRootFolder_() {
  const settings = requireConfigured_();
  try {
    return DriveApp.getFolderById(settings.rootFolderId);
  } catch (error) {
    throw new AppError('ROOT_FOLDER_UNAVAILABLE', '保存先ルートフォルダを開けません。設定または権限を確認してください。');
  }
}

function getFolderByPath_(pathParts) {
  let folder = getRootFolder_();
  pathParts.forEach(function (name) {
    const folders = folder.getFoldersByName(name);
    assertApp_(folders.hasNext(), 'FOLDER_NOT_FOUND', '保存フォルダがありません: ' + pathParts.join('/'));
    folder = folders.next();
  });
  return folder;
}

function ensureFolderPath_(rootFolder, pathParts) {
  let folder = rootFolder;
  pathParts.forEach(function (name) {
    const matches = folder.getFoldersByName(name);
    folder = matches.hasNext() ? matches.next() : folder.createFolder(name);
  });
  return folder;
}

function getFileSafely_(fileId) {
  if (!fileId) return null;
  try {
    const file = DriveApp.getFileById(String(fileId));
    file.getName();
    return file;
  } catch (error) {
    return null;
  }
}

function readTextFile_(fileId, maxCharacters) {
  const file = getFileSafely_(fileId);
  assertApp_(file, 'FILE_NOT_FOUND', '指定したファイルが見つからないか、読み取り権限がありません。');
  const mimeType = file.getMimeType();
  let text;
  if (mimeType === MimeType.GOOGLE_DOCS) {
    text = readGoogleDocAllTabsText_(fileId);
  } else if (mimeType === MimeType.GOOGLE_SHEETS) {
    text = SpreadsheetApp.openById(fileId).getSheets().map(function (sheet) {
      const values = sheet.getDataRange().getDisplayValues();
      return '# ' + sheet.getName() + '\n' + values.map(function (row) { return row.join('\t'); }).join('\n');
    }).join('\n\n');
  } else if (mimeType === MimeType.PLAIN_TEXT || mimeType === MimeType.CSV || mimeType === 'application/json') {
    text = file.getBlob().getDataAsString('UTF-8');
  } else {
    throw new AppError('UNSUPPORTED_TEXT_FILE', '本文を取得できる形式は Google ドキュメント、Google スプレッドシート、テキスト、CSV、JSON です。');
  }
  const limit = maxCharacters || APP_CONFIG.maxTranscriptCharacters;
  assertApp_(text.length <= limit, 'FILE_TOO_LARGE', 'ファイルが読み取り上限（' + limit + '文字）を超えています。');
  return text;
}

function readGoogleDocAllTabsText_(fileId) {
  const document = DocumentApp.openById(fileId);
  if (typeof document.getTabs !== 'function') return document.getBody().getText();
  const tabs = [];
  (function collect(list) {
    (list || []).forEach(function (tab) {
      tabs.push(tab);
      collect(typeof tab.getChildTabs === 'function' ? tab.getChildTabs() : []);
    });
  })(document.getTabs());
  if (tabs.length <= 1) return document.getBody().getText();
  return tabs.map(function (tab) {
    return '## タブ: ' + tab.getTitle() + '\n' + tab.asDocumentTab().getBody().getText();
  }).join('\n\n');
}

function createJsonFile_(folder, fileName, data) {
  return folder.createFile(fileName, JSON.stringify(data, null, 2), MimeType.PLAIN_TEXT);
}

function detectTranscriptCategory_(file) {
  try {
    const parents = file.getParents();
    while (parents.hasNext()) {
      const name = parents.next().getName();
      if (APP_CONFIG.categories.indexOf(name) >= 0) return name;
    }
  } catch (error) {
    console.error(error);
  }
  return '';
}

function moveFileToTranscriptCategory_(file, category) {
  const transcriptRoot = getFolderByPath_(APP_CONFIG.folderPaths.transcripts);
  const categoryFolder = ensureFolderPath_(transcriptRoot, [category]);
  file.moveTo(categoryFolder);
  return categoryFolder.getId();
}

function listFilesInFolder_(folder, limit) {
  const files = folder.getFiles();
  const result = [];
  while (files.hasNext() && result.length < (limit || 100)) {
    const file = files.next();
    result.push(fileToClient_(file));
  }
  return result;
}

function fileToClient_(file) {
  return {
    fileId: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    url: file.getUrl(),
    updatedAt: file.getLastUpdated().toISOString()
  };
}
