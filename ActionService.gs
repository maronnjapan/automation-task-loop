function listActionCandidates(meetingId) {
  return withClientError_(function () {
    const completed = completedMeetingIds_();
    const quizPassed = passedQuizMeetingIds_();
    const rows = findRows_('Actions', function (row) { return (!meetingId || String(row.meetingId) === String(meetingId)) && !completed[String(row.meetingId)]; });
    return { success: true, actions: rows.reverse().map(function (row) {
      const action = stripRowMetadata_(row);
      action.quizPassed = Boolean(quizPassed[String(action.meetingId)]);
      action.prerequisiteQuestions = parseJsonCell_(action.prerequisiteQuestionsJson, []);
      delete action.prerequisiteQuestionsJson;
      return action;
    }) };
  });
}

function requireAction_(actionId) {
  const action = findRow_('Actions', function (row) { return String(row.actionId) === String(actionId); });
  assertApp_(action, 'ACTION_NOT_FOUND', '作業候補が見つかりません。');
  return action;
}
