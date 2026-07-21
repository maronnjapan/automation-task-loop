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
  PropertiesService: {
    getScriptProperties() {
      return { getProperty() { return ''; } };
    }
  },
  getRegisteredScriptIds_() { return []; }
});
for (const file of ['Config.gs', 'ErrorService.gs', 'JsonValidator.gs', 'AiPromptService.gs', 'AiGenerationService.gs']) {
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
assert.equal(vm.runInContext('extractOpenAiOutputText_(openAiResponse)', context), '{"ok":true}');
assert.equal(vm.runInContext('parsePastedJson_("```json\\n{\\\"ok\\\":true}\\n```").ok', context), true);
assert.equal(vm.runInContext('buildWorkGuideAutoReviewPrompt_({allowedScripts:[]}, validGuide).includes("厳格な検収者")', context), true);
vm.runInContext(`
  var repairTestCalls = [];
  requireAiAutomationSettings_ = function () { return { model: 'test-model', maxRepairAttempts: 1 }; };
  invokeOpenAiJson_ = function (settings, prompt, meta) {
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
vm.runInContext(readFileSync(resolve(projectRoot, 'AiAutomationWorkflowService.gs'), 'utf8'), context, { filename: 'AiAutomationWorkflowService.gs' });
assert.equal(vm.runInContext('buildPreflight_(validGuide, {status:"needs_review"}).level', context), 'unavailable');
assert.equal(vm.runInContext('isActionAutoGuideRequired_({guideRecommended:true})', context), true);
assert.equal(vm.runInContext('isActionAutoGuideRequired_({guideRecommended:false})', context), false);

const allHtml = htmlFiles.map((file) => readFileSync(resolve(projectRoot, file), 'utf8')).join('\n');
for (const id of ['ai-api-key', 'ai-auto-enabled', 'guide-review-actions', 'guide-ai-history', 'quiz-ai-history']) {
  assert.match(allHtml, new RegExp(`id=["']${id}["']`), `UI element #${id} is missing`);
}
const config = readFileSync(resolve(projectRoot, 'Config.gs'), 'utf8');
for (const required of ['AiInteractions', 'aiInteractionLogs', 'automationStatus', 'autoReviewJson']) {
  assert.match(config, new RegExp(required), `Configuration ${required} is missing`);
}
const workGuideService = readFileSync(resolve(projectRoot, 'WorkGuideService.gs'), 'utf8');
assert.match(workGuideService, /function approveWorkGuide\(/, 'Approval endpoint is missing');
assert.match(workGuideService, /guideNeedsReview/, 'Generated guides must support needs_review state');

console.log(`Verified ${gasFiles.length} GAS files, ${htmlFiles.length} HTML files, validators, prompts, API parsing, and review UI wiring.`);
