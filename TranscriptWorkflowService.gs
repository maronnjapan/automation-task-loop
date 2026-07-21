/**
 * Dashboard-facing workflow over transcript Google Docs:
 * list every transcript with its progress (register -> analysis -> quiz -> guide),
 * and mark a transcript as done by moving it into 01_文字起こし/完了.
 */
function listTranscriptWorkflows() {
  return withClientError_(function () {
    requireConfigured_();
    const transcriptRoot = getFolderByPath_(APP_CONFIG.folderPaths.transcripts);
    const doneFolderName = APP_CONFIG.folderPaths.transcriptsDone[APP_CONFIG.folderPaths.transcriptsDone.length - 1];
    const entries = [];
    const seen = {};
    function collect(folder, location, completed) {
      listFilesInFolder_(folder, 100).forEach(function (file) {
        if (seen[file.fileId]) return;
        seen[file.fileId] = true;
        file.location = location;
        file.completed = completed;
        entries.push(file);
      });
    }
    collect(transcriptRoot, '', false);
    const subfolders = transcriptRoot.getFolders();
    while (subfolders.hasNext()) {
      const folder = subfolders.next();
      const name = folder.getName();
      collect(folder, name, name === doneFolderName);
    }

    const meetings = getRows_('Meetings');
    const quizSessions = getRows_('QuizSessions');
    const actions = getRows_('Actions');
    const guides = getRows_('WorkGuides');
    entries.forEach(function (entry) {
      const meeting = meetings.find(function (row) { return String(row.transcriptFileId) === String(entry.fileId); });
      if (meeting) {
        entry.meetingId = meeting.meetingId;
        entry.meetingTitle = meeting.title;
        entry.category = meeting.category;
        entry.analysisStatus = meeting.analysisStatus;
        entry.automationStatus = meeting.automationStatus || '';
        entry.automationError = meeting.automationError || '';
        entry.completedAt = meeting.completedAt || '';
        if (String(meeting.workflowStatus) === 'completed') entry.completed = true;
        entry.quizCompleted = quizSessions.some(function (row) { return String(row.meetingId) === String(meeting.meetingId) && String(row.status) === 'completed'; });
        entry.candidateActionCount = actions.filter(function (row) { return String(row.meetingId) === String(meeting.meetingId) && String(row.status) === 'candidate'; }).length;
        entry.guideCount = guides.filter(function (row) { return String(row.meetingId) === String(meeting.meetingId); }).length;
        entry.guideNeedsReviewCount = guides.filter(function (row) { return String(row.meetingId) === String(meeting.meetingId) && String(row.status) === APP_CONFIG.statuses.guideNeedsReview; }).length;
      }
      const stage = transcriptStage_(entry);
      entry.stage = stage.stage;
      entry.stageLabel = stage.label;
    });
    entries.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    return { success: true, transcripts: entries };
  });
}

function transcriptStage_(entry) {
  if (entry.completed) return { stage: 'completed', label: '完了' };
  if (!entry.meetingId) return { stage: 'register', label: '未登録' };
  if (String(entry.analysisStatus) !== 'completed') return { stage: 'analysis', label: '解析待ち' };
  if (!entry.quizCompleted) return { stage: 'quiz', label: entry.guideNeedsReviewCount ? 'クイズ未回答・ガイド承認待ち' : 'クイズ未回答' };
  return { stage: 'guide', label: 'ガイド作成・実行' };
}

function completeTranscript(fileId) {
  return withClientError_(function () {
    requireConfigured_();
    const file = getFileSafely_(fileId);
    assertApp_(file, 'FILE_NOT_FOUND', '文字起こしファイルが見つかりません。');
    const transcriptRoot = getFolderByPath_(APP_CONFIG.folderPaths.transcripts);
    const doneFolder = ensureFolderPath_(transcriptRoot, APP_CONFIG.folderPaths.transcriptsDone.slice(1));
    file.moveTo(doneFolder);
    const meeting = findRow_('Meetings', function (row) { return String(row.transcriptFileId) === String(fileId); });
    if (meeting) updateRow_('Meetings', meeting._rowNumber, { workflowStatus: 'completed', completedAt: nowIso_() });
    return { success: true, fileId: file.getId(), movedTo: APP_CONFIG.folderPaths.transcriptsDone.join('/') };
  });
}

function reopenTranscript(fileId) {
  return withClientError_(function () {
    requireConfigured_();
    const file = getFileSafely_(fileId);
    assertApp_(file, 'FILE_NOT_FOUND', '文字起こしファイルが見つかりません。');
    const meeting = findRow_('Meetings', function (row) { return String(row.transcriptFileId) === String(fileId); });
    const category = meeting && APP_CONFIG.categories.indexOf(String(meeting.category)) >= 0 ? String(meeting.category) : APP_CONFIG.categories[0];
    moveFileToTranscriptCategory_(file, category);
    if (meeting) updateRow_('Meetings', meeting._rowNumber, { workflowStatus: 'active', completedAt: '' });
    return { success: true, fileId: file.getId(), movedTo: APP_CONFIG.folderPaths.transcripts.concat([category]).join('/') };
  });
}
