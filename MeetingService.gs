function registerMeeting(input) {
  return withClientError_(function () {
    requireConfigured_();
    input = input || {};
    assertApp_(!nonEmptyString_(input.meetingEndedAt) || isIsoDate_(input.meetingEndedAt), 'VALIDATION_ERROR', '会議終了日時の形式が不正です。');
    const file = getFileSafely_(input.transcriptFileId);
    assertApp_(file, 'FILE_NOT_FOUND', '文字起こしファイルが見つかりません。');
    readTextFile_(file.getId(), APP_CONFIG.maxTranscriptCharacters);
    const duplicate = findRow_('Meetings', function (row) { return String(row.transcriptFileId) === String(file.getId()); });
    assertApp_(!duplicate, 'DUPLICATE_MEETING', 'この文字起こしは登録済みです: ' + (duplicate ? duplicate.meetingId : ''));
    const title = nonEmptyString_(input.title) ? input.title.trim() : file.getName();
    let category = input.category;
    if (APP_CONFIG.categories.indexOf(category) < 0) category = detectTranscriptCategory_(file) || APP_CONFIG.categories[0];
    moveFileToTranscriptCategory_(file, category);
    const meeting = {
      meetingId: createId_('MTG'), title: title, category: category,
      transcriptFileId: file.getId(),
      meetingEndedAt: nonEmptyString_(input.meetingEndedAt) ? new Date(input.meetingEndedAt).toISOString() : nowIso_(),
      registeredAt: nowIso_(), analysisStatus: 'pending', workflowStatus: 'active', completedAt: ''
    };
    appendObject_('Meetings', meeting);
    return { success: true, meeting: meeting };
  });
}

function listMeetings() {
  return withClientError_(function () {
    return { success: true, meetings: getRows_('Meetings').reverse().map(stripRowMetadata_) };
  });
}

function listTranscriptFiles() {
  return withClientError_(function () {
    const transcriptRoot = getFolderByPath_(APP_CONFIG.folderPaths.transcripts);
    const doneFolderName = APP_CONFIG.folderPaths.transcriptsDone[APP_CONFIG.folderPaths.transcriptsDone.length - 1];
    let files = listFilesInFolder_(transcriptRoot, 100).map(function (file) { file.location = ''; return file; });
    const subfolders = transcriptRoot.getFolders();
    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      const folderName = folder.getName();
      if (folderName === doneFolderName) continue;
      files = files.concat(listFilesInFolder_(folder, 100).map(function (file) { file.location = folderName; return file; }));
    }
    const registered = {};
    getRows_('Meetings').forEach(function (row) { registered[String(row.transcriptFileId)] = true; });
    const unique = {};
    files = files.filter(function (file) {
      if (unique[file.fileId] || registered[file.fileId]) return false;
      unique[file.fileId] = true;
      return true;
    });
    return { success: true, files: files };
  });
}

function getTranscriptFileDefaults(fileId) {
  return withClientError_(function () {
    requireConfigured_();
    const file = getFileSafely_(fileId);
    assertApp_(file, 'FILE_NOT_FOUND', '文字起こしファイルが見つかりません。');
    return { success: true, defaults: { title: file.getName(), category: detectTranscriptCategory_(file) } };
  });
}

function getMeeting(meetingId) {
  return withClientError_(function () {
    const meeting = requireMeeting_(meetingId);
    const analysis = findRow_('MeetingAnalyses', function (row) { return String(row.meetingId) === String(meetingId); });
    return { success: true, meeting: stripRowMetadata_(meeting), analysis: analysis ? hydrateAnalysisRow_(analysis) : null };
  });
}

function getMeetingAnalysisPrompt(meetingId) {
  return withClientError_(function () {
    const meeting = requireMeeting_(meetingId);
    const transcript = readTextFile_(meeting.transcriptFileId, APP_CONFIG.maxTranscriptCharacters);
    return { success: true, prompt: buildMeetingAnalysisPrompt_(meeting, transcript), characterCount: transcript.length };
  });
}

function requireMeeting_(meetingId) {
  const meeting = findRow_('Meetings', function (row) { return String(row.meetingId) === String(meetingId); });
  assertApp_(meeting, 'MEETING_NOT_FOUND', '会議が見つかりません。');
  return meeting;
}

function stripRowMetadata_(row) {
  if (!row) return row;
  const copy = Object.assign({}, row);
  delete copy._rowNumber;
  return copy;
}

function hydrateAnalysisRow_(row) {
  const copy = stripRowMetadata_(row);
  copy.decisions = parseJsonCell_(copy.decisionsJson, []);
  copy.pendingItems = parseJsonCell_(copy.pendingItemsJson, []);
  copy.quiz = parseJsonCell_(copy.quizJson, {});
  delete copy.decisionsJson;
  delete copy.pendingItemsJson;
  delete copy.quizJson;
  return copy;
}
