#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gasFiles = readdirSync(projectRoot).filter((name) => name.endsWith('.gs')).sort();
const htmlFiles = readdirSync(projectRoot).filter((name) => name.endsWith('.html')).sort();

for (const file of gasFiles) {
  new vm.Script(readFileSync(resolve(projectRoot, file), 'utf8'), { filename: file });
}
for (const file of htmlFiles) {
  const html = readFileSync(resolve(projectRoot, file), 'utf8');
  for (const [index, match] of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
    new vm.Script(match[1], { filename: `${file}:script-${index}` });
  }
}

const context = vm.createContext({
  console,
  URL,
  LockService: {
    getScriptLock() {
      return { hasLock() { return false; }, waitLock() {}, releaseLock() {} };
    }
  },
  PropertiesService: {
    getScriptProperties() {
      return { getProperty() { return ''; } };
    }
  },
  getRegisteredScriptIds_() { return []; }
});
for (const file of ['Config.gs', 'ErrorService.gs', 'JsonValidator.gs', 'AiPromptService.gs', 'AiProviderAdapters.gs', 'AiGenerationService.gs']) {
  vm.runInContext(readFileSync(resolve(projectRoot, file), 'utf8'), context, { filename: file });
}

const validAnalysis = {
  summary: '会議では公開手順を決定した。',
  decisions: ['金曜日に公開する'],
  pendingItems: [],
  actionCandidates: [{ title: '公開準備', description: '公開準備を完了する', owner: '本人', dueDate: '', prerequisiteQuestions: ['対象は？'], guideRecommended: true }],
  quiz: {
    quizTitle: '理解確認',
    questions: [{
      questionId: 'Q1', type: 'true_false', question: '公開日は金曜日か', choices: ['○', '×'],
      correctChoiceIndexes: [0], explanation: '会議で決定したため', topic: 'decision', sourceReference: '決定事項'
    }]
  }
};
const validGuide = {
  schemaVersion: '1.1', workGuideId: '', version: 1, title: '公開準備', goal: '公開できる状態にする',
  assumptions: ['公開日は決定済み'], prerequisites: ['編集権限を確認する'], warnings: [],
  sourceSnapshots: [{ fileId: 'file-123', fileName: '会議記録', snapshotAt: '2026-07-21T00:00:00.000Z' }],
  steps: [{
    stepId: 'S1', order: 1, type: 'input', title: '内容を確認する', description: '公開内容を読み、誤りがないか確認する。',
    url: 'https://example.com/item', inputs: [{ inputId: 'I1', label: '確認済み', inputType: 'check', required: true }],
    completionCriteria: '確認済みにチェックできている', sourceReferences: ['file-123']
  }]
};

context.validAnalysis = validAnalysis;
context.validGuide = validGuide;
assert.equal(vm.runInContext('validateMeetingAnalysis_(validAnalysis).quiz.questions.length', context), 1);
assert.equal(vm.runInContext('validateWorkGuide_(validGuide).steps[0].stepId', context), 'S1');
context.reviewBundle = { review: { summary: '実行可能', issues: [], changesMade: ['完了条件を具体化'], remainingRisks: [] }, workGuide: structuredClone(validGuide) };
assert.equal(vm.runInContext('validateAutoReviewResult_(reviewBundle, validGuide).review.summary', context), '実行可能');
context.openAiResponse = { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }] };
assert.equal(vm.runInContext('parseOpenAiResponse_(openAiResponse).text', context), '{"ok":true}');
context.geminiResponse = { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] };
assert.equal(vm.runInContext('parseGeminiResponse_(geminiResponse).text', context), '{"ok":true}');
context.anthropicResponse = { content: [{ type: 'text', text: '{"ok":true}' }] };
assert.equal(vm.runInContext('parseAnthropicResponse_(anthropicResponse).text', context), '{"ok":true}');
context.openRouterResponse = { choices: [{ message: { content: '{"ok":true}' } }] };
assert.equal(vm.runInContext('parseOpenAiCompatibleResponse_(openRouterResponse).text', context), '{"ok":true}');
assert.equal(vm.runInContext('parsePastedJson_("```json\\n{\\\"ok\\\":true}\\n```").ok', context), true);
assert.equal(vm.runInContext('buildWorkGuideAutoReviewPrompt_({allowedScripts:[]}, validGuide).includes("厳格な検収者")', context), true);
context.promptMeeting = { meetingId: 'MTG-PROMPT', title: '確認会議', category: '定例', meetingEndedAt: '2026-07-21T00:00:00.000Z' };
context.approvedMeetingReview = '# 会議内容の確認案\n## 5. 作成を検討する作業ガイド\n公開準備を行う';
context.approvedGuidePlan = '# 作業ガイド設計案\n## 3. 必要な具体作業\n1. 公開内容を確認する';
assert.equal(vm.runInContext('buildMeetingAnalysisReviewPrompt_(promptMeeting, "文字起こし").includes("この段階ではアプリ用JSONを作りません")', context), true);
assert.equal(vm.runInContext('buildMeetingAnalysisJsonPrompt_(promptMeeting, "文字起こし", approvedMeetingReview).includes(approvedMeetingReview)', context), true);
assert.equal(vm.runInContext('buildWorkGuidePlanPrompt_({action:{title:"公開準備"}}).includes("必要な具体作業")', context), true);
assert.equal(vm.runInContext('buildWorkGuidePrompt_({action:{title:"公開準備"}, selectedSources:[], workGuideId:"", version:1}, approvedGuidePlan).includes(approvedGuidePlan)', context), true);
vm.runInContext(`
  var repairTestCalls = [];
  requireAiAutomationSettings_ = function () { return { model: 'test-model', provider: 'openai', providerLabel: 'OpenAI', maxRepairAttempts: 1 }; };
  invokeAiJson_ = function (settings, prompt, meta) {
    repairTestCalls.push({ prompt: prompt, iteration: meta.iteration });
    return { text: meta.iteration === 1 ? '{"ok":false}' : '{"ok":true}', interactionId: 'AI-' + meta.iteration };
  };
  markAiInteractionValidation_ = function () {};
  var repairedJson = runAiJsonTask_({
    conversationId: 'AICONV-test', prompt: 'JSONでokを返す', maxRepairAttempts: 1,
    validator: function (value) {
      if (!value.ok) throw new AppError('VALIDATION_ERROR', 'okがfalseです', { errors: ['okはtrueです'] });
      return value;
    }
  });
`, context);
assert.equal(vm.runInContext('repairedJson.value.ok', context), true);
assert.equal(vm.runInContext('repairTestCalls.length', context), 2);
assert.equal(vm.runInContext('repairTestCalls[1].prompt.includes("okはtrueです")', context), true);

context.nowIso_ = () => '2026-07-21T00:00:00.000Z';
context.getFileSafely_ = () => ({ getLastUpdated() { return new Date('2026-07-21T00:00:00.000Z'); } });
vm.runInContext(readFileSync(resolve(projectRoot, 'WorkGuideExecutionService.gs'), 'utf8'), context, { filename: 'WorkGuideExecutionService.gs' });
vm.runInContext(readFileSync(resolve(projectRoot, 'SpreadsheetService.gs'), 'utf8'), context, { filename: 'SpreadsheetService.gs' });
vm.runInContext(readFileSync(resolve(projectRoot, 'QuizService.gs'), 'utf8'), context, { filename: 'QuizService.gs' });
vm.runInContext(readFileSync(resolve(projectRoot, 'WorkGuideBuildService.gs'), 'utf8'), context, { filename: 'WorkGuideBuildService.gs' });
vm.runInContext(readFileSync(resolve(projectRoot, 'AiAutomationWorkflowService.gs'), 'utf8'), context, { filename: 'AiAutomationWorkflowService.gs' });
assert.equal(vm.runInContext('buildPreflight_(validGuide, {status:"needs_review"}).level', context), 'unavailable');
assert.equal(vm.runInContext('isActionAutoGuideRequired_({guideRecommended:true})', context), true);
assert.equal(vm.runInContext('isActionAutoGuideRequired_({guideRecommended:false})', context), false);
vm.runInContext(`
  var queueRows = {
    QuizSessions: [
      { meetingId: 'MTG-A', status: 'completed', scoreJson: { correctCount: 2, total: 2 } },
      { meetingId: 'MTG-B', status: 'completed', scoreJson: { correctCount: 1, total: 2 } },
      { meetingId: 'MTG-C', status: 'retry_required', scoreJson: { correctCount: 2, total: 2 } },
      { meetingId: 'MTG-D', status: 'completed', scoreJson: '{"correctCount":1,"total":1}' }
    ],
    Meetings: [
      { meetingId: 'MTG-A', analysisStatus: 'completed', workflowStatus: 'active' },
      { meetingId: 'MTG-B', analysisStatus: 'completed', workflowStatus: 'active' },
      { meetingId: 'MTG-C', analysisStatus: 'completed', workflowStatus: 'active' },
      { meetingId: 'MTG-D', analysisStatus: 'completed', workflowStatus: 'active' }
    ],
    Actions: [
      { actionId: 'ACT-A1', meetingId: 'MTG-A', status: 'candidate', automationStatus: 'pending', automationAttempts: 0, guideRecommended: true },
      { actionId: 'ACT-B1', meetingId: 'MTG-B', status: 'candidate', automationStatus: 'pending', automationAttempts: 0, guideRecommended: true },
      { actionId: 'ACT-A2', meetingId: 'MTG-A', status: 'candidate', automationStatus: 'pending', automationAttempts: 0, guideRecommended: true },
      { actionId: 'ACT-D1', meetingId: 'MTG-D', status: 'candidate', automationStatus: 'pending', automationAttempts: 0, guideRecommended: true }
    ],
    WorkGuides: []
  };
  getRows_ = function (sheetName) { return queueRows[sheetName] || []; };
  var blockedQuizCode = '';
  try { requirePassedQuizForMeeting_('MTG-B'); } catch (error) { blockedQuizCode = error.code; }
`, context);
assert.equal(vm.runInContext('hasPassedQuizForMeeting_("MTG-A")', context), true);
assert.equal(vm.runInContext('hasPassedQuizForMeeting_("MTG-B")', context), false);
assert.equal(vm.runInContext('hasPassedQuizForMeeting_("MTG-C")', context), false);
assert.equal(vm.runInContext('blockedQuizCode', context), 'QUIZ_PASS_REQUIRED');
assert.equal(vm.runInContext('nextActionForAiGuide_(false, {}, {}).actionId', context), 'ACT-A1');
assert.equal(vm.runInContext('nextActionForAiGuide_(false, {}, {"MTG-A":true}).actionId', context), 'ACT-D1');
assert.equal(vm.runInContext('nextActionForAiGuide_(false, {"ACT-A1":true}, {}).actionId', context), 'ACT-A2');
vm.runInContext(`
  var buildTestSequence = 0;
  queueRows.MeetingAnalyses = [
    { meetingId: 'MTG-A', summary: '会議Aの要約' },
    { meetingId: 'MTG-D', summary: '会議Dの要約' }
  ];
  queueRows.WorkGuideBuildSessions = [];
  findRow_ = function (sheetName, predicate) { return (queueRows[sheetName] || []).find(predicate) || null; };
  requireAction_ = function (actionId) {
    var action = findRow_('Actions', function (row) { return String(row.actionId) === String(actionId); });
    if (!action) throw new AppError('ACTION_NOT_FOUND', '作業候補が見つかりません。');
    return action;
  };
  requireMeeting_ = function (meetingId) {
    var meeting = findRow_('Meetings', function (row) { return String(row.meetingId) === String(meetingId); });
    if (!meeting) throw new AppError('MEETING_NOT_FOUND', '会議が見つかりません。');
    return meeting;
  };
  defaultPrerequisiteQuestions_ = function () { return ['前提条件は？']; };
  stripRowMetadata_ = function (row) { var result = Object.assign({}, row); delete result._rowNumber; return result; };
  createId_ = function () { buildTestSequence += 1; return 'BUILD-' + buildTestSequence; };
  appendObject_ = function (sheetName, value) {
    value._rowNumber = (queueRows[sheetName] || []).length + 2;
    queueRows[sheetName].push(value);
    return value;
  };
  updateRow_ = function (sheetName, rowNumber, updates) {
    var row = (queueRows[sheetName] || []).find(function (item) { return Number(item._rowNumber) === Number(rowNumber); });
    if (row) Object.assign(row, updates);
  };
  queueRows.Actions.forEach(function (row, index) { row._rowNumber = index + 2; });
  queueRows.Meetings.forEach(function (row, index) { row._rowNumber = index + 2; });
  var meetingABuild = startWorkGuideBuild('ACT-A1');
  var meetingDBuild = startWorkGuideBuild('ACT-D1');
  var resumedMeetingABuild = startWorkGuideBuild('ACT-A1');
`, context);
assert.equal(vm.runInContext('meetingABuild.success', context), true);
assert.equal(vm.runInContext('meetingDBuild.success', context), true);
assert.notEqual(vm.runInContext('meetingABuild.session.buildSessionId', context), vm.runInContext('meetingDBuild.session.buildSessionId', context));
assert.equal(vm.runInContext('meetingABuild.session.meetingId', context), 'MTG-A');
assert.equal(vm.runInContext('meetingDBuild.session.meetingId', context), 'MTG-D');
assert.equal(vm.runInContext('resumedMeetingABuild.session.buildSessionId', context), vm.runInContext('meetingABuild.session.buildSessionId', context));
assert.equal(vm.runInContext('queueRows.WorkGuideBuildSessions.length', context), 2);
assert.equal(vm.runInContext('meetingABuild.session.data.creationMode', context), 'manual');
assert.equal(vm.runInContext('nextActionForAiGuide_(false, {}, {}).actionId', context), 'ACT-A2');
vm.runInContext(`
  var automatedMeetingABuild = startWorkGuideBuild('ACT-A2', 'automatic');
  var cancelledMeetingABuild = cancelWorkGuideBuild(meetingABuild.session.buildSessionId);
  var cancelledMeetingABuildAgain = cancelWorkGuideBuild(meetingABuild.session.buildSessionId);
  var restartedCancelledBuild = startWorkGuideBuild('ACT-A1');
`, context);
assert.equal(vm.runInContext('automatedMeetingABuild.session.data.creationMode', context), 'automatic');
assert.equal(vm.runInContext('cancelledMeetingABuild.success', context), true);
assert.equal(vm.runInContext('queueRows.Actions[0].status', context), 'guide_not_required');
assert.equal(vm.runInContext('queueRows.Actions[0].guideRecommended', context), false);
assert.equal(vm.runInContext('queueRows.Actions[0].automationStatus', context), 'not_required');
assert.equal(vm.runInContext('queueRows.WorkGuideBuildSessions[0].status', context), 'cancelled');
assert.equal(vm.runInContext('cancelledMeetingABuildAgain.code', context), 'BUILD_SESSION_CLOSED');
assert.equal(vm.runInContext('restartedCancelledBuild.code', context), 'ACTION_NOT_GUIDE_TARGET');
assert.equal(vm.runInContext('nextActionForAiGuide_(false, {}, {}).actionId', context), 'ACT-A2');
vm.runInContext(`
  var quizTestUpdates = [];
  var quizTestSession = {
    _rowNumber: 2, quizSessionId: 'QUIZ-TEST', meetingId: 'MTG-A', mode: 'batch', status: 'in_progress',
    answersJson: { Q1: [1] }, questionStatesJson: { Q1: 'answered' }, scoreJson: {}
  };
  requireQuizSession_ = function () { return quizTestSession; };
  getQuizForMeeting_ = function () {
    return { questions: [{ questionId: 'Q1', correctChoiceIndexes: [0], explanation: '正解は0' }] };
  };
  updateRow_ = function (sheetName, rowNumber, updates) { quizTestUpdates.push({ sheetName: sheetName, rowNumber: rowNumber, updates: updates }); };
  refreshMeetingAutomationStatus_ = function () {};
  var failedQuizResult = submitQuiz('QUIZ-TEST');
  quizTestSession.status = 'in_progress';
  quizTestSession.answersJson = { Q1: [0] };
  var passedQuizResult = submitQuiz('QUIZ-TEST');
`, context);
assert.equal(vm.runInContext('failedQuizResult.passed', context), false);
assert.equal(vm.runInContext('quizTestUpdates[0].updates.status', context), 'retry_required');
assert.equal(vm.runInContext('Object.keys(quizTestUpdates[0].updates.answersJson).length', context), 0);
assert.equal(vm.runInContext('passedQuizResult.passed', context), true);
assert.equal(vm.runInContext('quizTestUpdates[1].updates.status', context), 'completed');

const allHtml = htmlFiles.map((file) => readFileSync(resolve(projectRoot, file), 'utf8')).join('\n');
for (const id of ['ai-api-key', 'ai-auto-enabled', 'manual-guide-create-button', 'copy-analysis-prompt-button', 'analysis-review', 'analysis-review-confirm', 'analysis-json-prompt', 'guide-plan-prompt', 'guide-plan', 'guide-plan-confirm', 'guide-prompt', 'copy-guide-prompt-button', 'guide-json-import', 'copy-revision-prompt-button', 'cancel-guide-build-button', 'guide-review-actions', 'guide-ai-history', 'quiz-ai-history']) {
  assert.match(allHtml, new RegExp(`id=["']${id}["']`), `UI element #${id} is missing`);
}
assert.match(allHtml, /data-view=["']actions["'][^>]*>ガイド作成</, 'Manual guide creation must remain in the main navigation');
assert.match(allHtml, /App\.copyText\(["']guide-prompt["']\)/, 'Manual guide prompts must be copyable without opening a specific AI service');
assert.match(allHtml, /App\.prepareAnalysisJsonPrompt\(\)/, 'Meeting JSON generation must be gated by the human-readable review');
assert.match(allHtml, /App\.prepareGuidePlanPrompt\(\)/, 'Work guide JSON generation must start with a human-readable plan');
const config = readFileSync(resolve(projectRoot, 'Config.gs'), 'utf8');
for (const required of ['AiInteractions', 'aiInteractionLogs', 'automationStatus', 'autoReviewJson']) {
  assert.match(config, new RegExp(required), `Configuration ${required} is missing`);
}
const distCode = readFileSync(resolve(projectRoot, 'dist/Code.gs'), 'utf8');
const firstDistSection = distCode.match(/^\/\/ ===== (.+\.gs) =====$/m);
assert.equal(firstDistSection && firstDistSection[1], 'Config.gs', 'User configuration must be the first section in dist/Code.gs');
const workGuideService = readFileSync(resolve(projectRoot, 'WorkGuideService.gs'), 'utf8');
assert.match(workGuideService, /function approveWorkGuide\(/, 'Approval endpoint is missing');
assert.match(workGuideService, /guideNeedsReview/, 'Generated guides must support needs_review state');
assert.match(workGuideService, /requirePassedQuizForMeeting_\(action\.meetingId\)/, 'Work guide saves must enforce the meeting quiz gate');
const workGuideBuildService = readFileSync(resolve(projectRoot, 'WorkGuideBuildService.gs'), 'utf8');
assert.match(workGuideBuildService, /requirePassedQuizForMeeting_\(action\.meetingId\)/, 'Work guide builds must enforce the meeting quiz gate');
assert.match(workGuideBuildService, /MANUAL_BUILD_IN_PROGRESS/, 'Automatic generation must not take over an active manual build');
assert.match(workGuideBuildService, /GUIDE_PLAN_REQUIRED/, 'New manual guide JSON imports must require an approved human-readable plan');
assert.match(workGuideBuildService, /function cancelWorkGuideBuild\(/, 'Open guide builds must be cancellable');
assert.match(workGuideBuildService, /guide_not_required/, 'Cancelled guide builds must be removed from guide targets');
const actionService = readFileSync(resolve(projectRoot, 'ActionService.gs'), 'utf8');
assert.match(actionService, /status\) !== 'guide_not_required'/, 'Removed guide targets must not reappear in the candidate list');

console.log(`Verified ${gasFiles.length} GAS files, ${htmlFiles.length} HTML files, validators, manual/API guide creation, quiz-gated parallel queues, prompts, API parsing, and review UI wiring.`);
