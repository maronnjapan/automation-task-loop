function saveMeetingAnalysis(meetingId, rawText, options) {
  return withClientError_(function () {
    options = options || {};
    if (options.skipInteractionLog !== true) {
      assertApp_(options.reviewConfirmed === true, 'REVIEW_CONFIRMATION_REQUIRED', 'JSONを保存する前に、読みやすい確認案で方向性を確認してください。');
      assertApp_(nonEmptyString_(options.approvedReview), 'VALIDATION_ERROR', '確認済みの要約・クイズ・ガイド方針がありません。');
    }
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
          prerequisiteQuestionsJson: candidate.prerequisiteQuestions || defaultPrerequisiteQuestions_(), createdAt: analyzedAt,
          guideRecommended: candidate.guideRecommended !== false, automationStatus: candidate.guideRecommended === false ? 'not_required' : 'pending',
          automationAttempts: 0, automationError: ''
        });
      });
      updateRow_('Meetings', meeting._rowNumber, { analysisStatus: 'completed', automationStatus: 'analysis_completed', automationError: '', automationUpdatedAt: nowIso_() });
      if (options.skipInteractionLog !== true) {
        const transcript = readTextFile_(meeting.transcriptFileId, APP_CONFIG.maxTranscriptCharacters);
        recordManualAiInteraction_({ meetingId: meeting.meetingId, phase: 'meeting_analysis' }, buildMeetingAnalysisJsonPrompt_(meeting, transcript, options.approvedReview.trim()), rawText, { valid: true, errors: [] });
      }
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
