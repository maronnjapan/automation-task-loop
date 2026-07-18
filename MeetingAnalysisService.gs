function saveMeetingAnalysis(meetingId, rawText) {
  return withClientError_(function () {
    const analysis = validateMeetingAnalysis_(parsePastedJson_(rawText));
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const meeting = requireMeeting_(meetingId);
      const existing = findRow_('MeetingAnalyses', function (row) { return String(row.meetingId) === String(meetingId); });
      assertApp_(!existing, 'DUPLICATE_ANALYSIS', 'この会議の解析結果は保存済みです。');
      const summaryFile = createMeetingSummaryDocument_(meeting, analysis);
      const jsonFile = createJsonFile_(getFolderByPath_(APP_CONFIG.folderPaths.analysisJson), meeting.meetingId + '_analysis.json', analysis);
      const analyzedAt = nowIso_();
      appendObject_('MeetingAnalyses', {
        meetingId: meeting.meetingId, summaryFileId: summaryFile.getId(), analysisJsonFileId: jsonFile.getId(),
        summary: analysis.summary, decisionsJson: analysis.decisions, pendingItemsJson: analysis.pendingItems,
        quizJson: analysis.quiz, analyzedAt: analyzedAt
      });
      analysis.actionCandidates.forEach(function (candidate) {
        appendObject_('Actions', {
          actionId: createId_('ACT'), meetingId: meeting.meetingId, title: candidate.title,
          description: candidate.description, owner: candidate.owner || '', dueDate: candidate.dueDate || '', status: 'candidate',
          prerequisiteQuestionsJson: candidate.prerequisiteQuestions || defaultPrerequisiteQuestions_(), createdAt: analyzedAt
        });
      });
      updateRow_('Meetings', meeting._rowNumber, { analysisStatus: 'completed' });
      return {
        success: true, meetingId: meeting.meetingId, summaryFileId: summaryFile.getId(), summaryFileUrl: summaryFile.getUrl(),
        analysisJsonFileId: jsonFile.getId(), actionCount: analysis.actionCandidates.length, questionCount: analysis.quiz.questions.length
      };
    } finally {
      lock.releaseLock();
    }
  });
}

function defaultPrerequisiteQuestions_() {
  return [
    'この作業で対象にするファイル・システム・期間は何ですか？',
    '作業に必要な権限や事前承認はそろっていますか？',
    '完了を判断する人と、客観的な完了条件は何ですか？'
  ];
}
