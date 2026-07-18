function registerMeeting(input) {
  return withClientError_(function () {
    requireConfigured_();
    input = input || {};
    assertApp_(nonEmptyString_(input.title), 'VALIDATION_ERROR', '会議名を入力してください。');
    assertApp_(APP_CONFIG.categories.indexOf(input.category) >= 0, 'VALIDATION_ERROR', 'カテゴリーを一覧から選択してください。');
    assertApp_(isIsoDate_(input.meetingEndedAt), 'VALIDATION_ERROR', '会議終了日時を入力してください。');
    const file = getFileSafely_(input.transcriptFileId);
    assertApp_(file, 'FILE_NOT_FOUND', '文字起こしファイルが見つかりません。');
    readTextFile_(file.getId(), APP_CONFIG.maxTranscriptCharacters);
    const duplicate = findRow_('Meetings', function (row) { return String(row.transcriptFileId) === String(file.getId()); });
    assertApp_(!duplicate, 'DUPLICATE_MEETING', 'この文字起こしは登録済みです: ' + (duplicate ? duplicate.meetingId : ''));
    moveFileToTranscriptCategory_(file, input.category);
    const meeting = {
      meetingId: createId_('MTG'), title: input.title.trim(), category: input.category,
      transcriptFileId: file.getId(), meetingEndedAt: new Date(input.meetingEndedAt).toISOString(),
      registeredAt: nowIso_(), analysisStatus: 'pending'
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
    let files = listFilesInFolder_(transcriptRoot, 100);
    const unclassified = transcriptRoot.getFoldersByName('未分類');
    if (unclassified.hasNext()) files = files.concat(listFilesInFolder_(unclassified.next(), 100));
    const unique = {};
    files = files.filter(function (file) {
      if (unique[file.fileId]) return false;
      unique[file.fileId] = true;
      return true;
    });
    return { success: true, files: files };
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
