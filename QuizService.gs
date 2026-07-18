function openQuiz(meetingId, mode) {
  return withClientError_(function () {
    const quiz = getQuizForMeeting_(meetingId);
    assertApp_(['single', 'batch'].indexOf(mode) >= 0, 'VALIDATION_ERROR', '回答方式は single または batch です。');
    let session = findRow_('QuizSessions', function (row) { return String(row.meetingId) === String(meetingId) && String(row.status) !== 'completed'; });
    if (!session) {
      session = {
        quizSessionId: createId_('QUIZ'), meetingId: meetingId, mode: mode, status: 'in_progress',
        answersJson: {}, questionStatesJson: {}, scoreJson: {}, updatedAt: nowIso_()
      };
      appendObject_('QuizSessions', session);
    } else if (session.mode !== mode) {
      updateRow_('QuizSessions', session._rowNumber, { mode: mode, updatedAt: nowIso_() });
      session.mode = mode;
    }
    return { success: true, quiz: redactQuiz_(quiz), session: hydrateQuizSession_(session) };
  });
}

function saveQuizAnswer(quizSessionId, questionId, choiceIndexes) {
  return withClientError_(function () {
    const session = requireQuizSession_(quizSessionId);
    assertApp_(session.status !== 'completed', 'QUIZ_COMPLETED', 'このクイズは採点済みです。');
    const quiz = getQuizForMeeting_(session.meetingId);
    const question = quiz.questions.find(function (item) { return item.questionId === questionId; });
    assertApp_(question, 'QUESTION_NOT_FOUND', '問題が見つかりません。');
    validateQuizChoice_(question, choiceIndexes);
    const answers = parseJsonCell_(session.answersJson, {});
    const states = parseJsonCell_(session.questionStatesJson, {});
    answers[questionId] = choiceIndexes.slice().sort(function (a, b) { return a - b; });
    states[questionId] = 'answered';
    updateRow_('QuizSessions', session._rowNumber, { answersJson: answers, questionStatesJson: states, updatedAt: nowIso_() });
    const immediate = session.mode === 'single' ? scoreQuestion_(question, answers[questionId]) : null;
    return { success: true, saved: true, result: immediate };
  });
}

function markQuizExplanationViewed(quizSessionId, questionId) {
  return withClientError_(function () {
    const session = requireQuizSession_(quizSessionId);
    const states = parseJsonCell_(session.questionStatesJson, {});
    assertApp_(states[questionId] === 'answered' || states[questionId] === 'explanation_viewed', 'ANSWER_REQUIRED', '先に回答してください。');
    states[questionId] = 'explanation_viewed';
    updateRow_('QuizSessions', session._rowNumber, { questionStatesJson: states, updatedAt: nowIso_() });
    return { success: true };
  });
}

function submitQuiz(quizSessionId) {
  return withClientError_(function () {
    const session = requireQuizSession_(quizSessionId);
    const quiz = getQuizForMeeting_(session.meetingId);
    const answers = parseJsonCell_(session.answersJson, {});
    const unanswered = quiz.questions.filter(function (question) { return !Array.isArray(answers[question.questionId]); });
    assertApp_(!unanswered.length, 'UNANSWERED_QUESTIONS', '未回答の問題があります。', { questionIds: unanswered.map(function (question) { return question.questionId; }) });
    const results = quiz.questions.map(function (question) { return scoreQuestion_(question, answers[question.questionId]); });
    const correctCount = results.filter(function (result) { return result.correct; }).length;
    const score = { correctCount: correctCount, total: results.length, percentage: Math.round(correctCount / results.length * 100), results: results };
    updateRow_('QuizSessions', session._rowNumber, { status: 'completed', scoreJson: score, updatedAt: nowIso_() });
    return { success: true, score: score, incorrectExplanations: results.filter(function (result) { return !result.correct; }) };
  });
}

function getQuizForMeeting_(meetingId) {
  const row = findRow_('MeetingAnalyses', function (analysis) { return String(analysis.meetingId) === String(meetingId); });
  assertApp_(row, 'ANALYSIS_NOT_FOUND', '先に会議解析を保存してください。');
  const quiz = parseJsonCell_(row.quizJson, null);
  assertApp_(quiz, 'QUIZ_NOT_FOUND', 'クイズが保存されていません。');
  return quiz;
}

function requireQuizSession_(quizSessionId) {
  const session = findRow_('QuizSessions', function (row) { return String(row.quizSessionId) === String(quizSessionId); });
  assertApp_(session, 'QUIZ_SESSION_NOT_FOUND', 'クイズの回答状態が見つかりません。');
  return session;
}

function hydrateQuizSession_(session) {
  const result = stripRowMetadata_(session);
  result.answers = parseJsonCell_(result.answersJson, {});
  result.questionStates = parseJsonCell_(result.questionStatesJson, {});
  result.score = parseJsonCell_(result.scoreJson, {});
  delete result.answersJson; delete result.questionStatesJson; delete result.scoreJson;
  return result;
}

function redactQuiz_(quiz) {
  return {
    quizTitle: quiz.quizTitle,
    questions: quiz.questions.map(function (question) {
      return { questionId: question.questionId, type: question.type, question: question.question, choices: question.choices, correctCount: question.correctChoiceIndexes.length, topic: question.topic };
    })
  };
}

function validateQuizChoice_(question, choiceIndexes) {
  assertApp_(Array.isArray(choiceIndexes) && choiceIndexes.length, 'VALIDATION_ERROR', '回答を選択してください。');
  if (question.type !== 'multi_choice') assertApp_(choiceIndexes.length === 1, 'VALIDATION_ERROR', 'この問題は1つだけ選択してください。');
  const unique = {};
  choiceIndexes.forEach(function (index) {
    assertApp_(Number.isInteger(index) && index >= 0 && index < question.choices.length, 'VALIDATION_ERROR', '選択肢の値が不正です。');
    assertApp_(!unique[index], 'VALIDATION_ERROR', '同じ選択肢が重複しています。');
    unique[index] = true;
  });
}

function scoreQuestion_(question, answer) {
  const actual = answer.slice().sort(function (a, b) { return a - b; });
  const expected = question.correctChoiceIndexes.slice().sort(function (a, b) { return a - b; });
  return { questionId: question.questionId, correct: JSON.stringify(actual) === JSON.stringify(expected), correctChoiceIndexes: expected, explanation: question.explanation };
}
