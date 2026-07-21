function searchDriveSources(query) {
  return withClientError_(function () {
    assertApp_(nonEmptyString_(query) && query.trim().length >= 2, 'VALIDATION_ERROR', '検索語を2文字以上入力してください。');
    const cache = CacheService.getUserCache();
    const cacheKey = 'sourceSearch:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, query.trim())).slice(0, 40);
    const cached = cache.get(cacheKey);
    if (cached) return { success: true, files: JSON.parse(cached), cached: true };
    const escaped = query.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let files = [];
    try {
      const response = Drive.Files.list({
        q: "trashed = false and fullText contains '" + escaped + "'",
        pageSize: 50,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,mimeType,webViewLink,modifiedTime,size)'
      });
      files = (response.files || []).map(function (file) {
        return { fileId: file.id, name: file.name, mimeType: file.mimeType, url: file.webViewLink || '', updatedAt: file.modifiedTime || '', size: file.size || '' };
      });
    } catch (error) {
      const iterator = DriveApp.searchFiles("trashed = false and title contains '" + escaped + "'");
      while (iterator.hasNext() && files.length < 50) files.push(fileToClient_(iterator.next()));
    }
    cache.put(cacheKey, JSON.stringify(files), 300);
    return { success: true, files: files, cached: false };
  });
}

function buildSelectedSourceContext_(fileIds) {
  assertApp_(Array.isArray(fileIds) && fileIds.length <= 10, 'VALIDATION_ERROR', '参照資料は10件以内で選択してください。');
  let remaining = APP_CONFIG.maxSourceCharacters;
  return fileIds.map(function (fileId) {
    const file = getFileSafely_(fileId);
    assertApp_(file, 'FILE_NOT_FOUND', '参照資料が見つかりません: ' + fileId);
    let excerpt = '';
    if (remaining > 0) {
      try {
        excerpt = readTextFile_(fileId, APP_CONFIG.maxTranscriptCharacters).slice(0, remaining);
      } catch (error) {
        excerpt = '[本文を直接取得できない形式です。ファイル名とURLを参照してください]';
      }
      remaining -= excerpt.length;
    }
    return {
      fileId: file.getId(), fileName: file.getName(), url: file.getUrl(),
      snapshotAt: file.getLastUpdated().toISOString(), excerpt: excerpt
    };
  });
}
