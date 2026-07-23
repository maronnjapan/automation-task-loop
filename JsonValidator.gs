function parsePastedJson_(rawText) {
  assertApp_(typeof rawText === 'string' && rawText.trim(), 'EMPTY_JSON', 'AI の JSON を貼り付けてください。');
  let text = rawText.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i) || text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) text = fenced[1];
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError('JSON_PARSE_ERROR', 'JSON を読み取れません。コードブロックの外側に説明文がないことを確認してください。', { parseMessage: error.message });
  }
}

function validateMeetingAnalysis_(analysis) {
  const errors = [];
  if (!isPlainObject_(analysis)) errors.push('ルートは JSON オブジェクトである必要があります。');
  if (!nonEmptyString_(analysis && analysis.summary)) errors.push('summary は必須の文字列です。');
  validateArrayField_(analysis, 'decisions', errors);
  validateArrayField_(analysis, 'pendingItems', errors);
  validateArrayField_(analysis, 'actionCandidates', errors);
  if (Array.isArray(analysis && analysis.actionCandidates)) {
    analysis.actionCandidates.forEach(function (action, index) {
      if (!isPlainObject_(action)) errors.push('actionCandidates[' + index + '] はオブジェクトである必要があります。');
      else {
        if (!nonEmptyString_(action.title)) errors.push('actionCandidates[' + index + '].title は必須です。');
        if (!nonEmptyString_(action.description)) errors.push('actionCandidates[' + index + '].description は必須です。');
        if (action.guideRecommended !== undefined && typeof action.guideRecommended !== 'boolean') errors.push('actionCandidates[' + index + '].guideRecommended は真偽値です。');
        if (action.prerequisiteQuestions !== undefined && !isStringArray_(action.prerequisiteQuestions)) {
          errors.push('actionCandidates[' + index + '].prerequisiteQuestions は文字列の配列です。');
        }
      }
    });
  }
  if (!isPlainObject_(analysis && analysis.quiz)) errors.push('quiz は必須のオブジェクトです。');
  else errors.push.apply(errors, validateQuiz_(analysis.quiz));
  throwValidationErrors_(errors, '会議解析 JSON');
  return analysis;
}

function validateAutoReviewResult_(result, expectedGuide) {
  const errors = [];
  if (!isPlainObject_(result)) errors.push('ルートは JSON オブジェクトです。');
  if (!isPlainObject_(result && result.review)) errors.push('review は必須のオブジェクトです。');
  else {
    if (!nonEmptyString_(result.review.summary)) errors.push('review.summary は必須です。');
    ['issues', 'changesMade', 'remainingRisks'].forEach(function (field) {
      if (!isStringArray_(result.review[field])) errors.push('review.' + field + ' は文字列の配列です。');
    });
  }
  if (!isPlainObject_(result && result.workGuide)) errors.push('workGuide は必須のオブジェクトです。');
  throwValidationErrors_(errors, 'AI自動検収 JSON');
  result.workGuide.workGuideId = expectedGuide.workGuideId || '';
  result.workGuide.version = Number(expectedGuide.version || 1);
  result.workGuide.schemaVersion = APP_CONFIG.schemaVersion;
  result.workGuide.sourceSnapshots = JSON.parse(JSON.stringify(expectedGuide.sourceSnapshots || []));
  validateWorkGuide_(result.workGuide);
  return result;
}

function validateQuiz_(quiz) {
  const errors = [];
  if (!nonEmptyString_(quiz.quizTitle)) errors.push('quiz.quizTitle は必須です。');
  if (!Array.isArray(quiz.questions) || !quiz.questions.length) {
    errors.push('quiz.questions は1件以上必要です。');
    return errors;
  }
  const ids = {};
  quiz.questions.forEach(function (question, index) {
    const path = 'quiz.questions[' + index + ']';
    if (!isPlainObject_(question)) { errors.push(path + ' はオブジェクトです。'); return; }
    if (!nonEmptyString_(question.questionId)) errors.push(path + '.questionId は必須です。');
    else if (ids[question.questionId]) errors.push(path + '.questionId が重複しています。');
    else ids[question.questionId] = true;
    if (['single_choice', 'multi_choice', 'true_false'].indexOf(question.type) < 0) errors.push(path + '.type が許可されていません。');
    if (!nonEmptyString_(question.question)) errors.push(path + '.question は必須です。');
    if (!Array.isArray(question.choices) || question.choices.some(function (choice) { return !nonEmptyString_(choice); })) {
      errors.push(path + '.choices は空でない文字列の配列です。');
    } else {
      if (question.type === 'single_choice' && [3, 4].indexOf(question.choices.length) < 0) errors.push(path + ' は3択または4択にしてください。');
      if (question.type === 'true_false' && question.choices.length !== 2) errors.push(path + ' の○×選択肢は2件必要です。');
      if (question.type === 'multi_choice' && question.choices.length < 2) errors.push(path + ' の複数選択肢は2件以上必要です。');
    }
    if (!Array.isArray(question.correctChoiceIndexes) || !question.correctChoiceIndexes.length) {
      errors.push(path + '.correctChoiceIndexes は1件以上必要です。');
    } else {
      const unique = {};
      question.correctChoiceIndexes.forEach(function (choiceIndex) {
        if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || !question.choices || choiceIndex >= question.choices.length) errors.push(path + '.correctChoiceIndexes に範囲外の値があります。');
        if (unique[choiceIndex]) errors.push(path + '.correctChoiceIndexes に重複があります。');
        unique[choiceIndex] = true;
      });
      if (question.type !== 'multi_choice' && question.correctChoiceIndexes.length !== 1) errors.push(path + ' の正解は1件です。');
    }
    if (!nonEmptyString_(question.explanation)) errors.push(path + '.explanation は必須です。');
    if (!nonEmptyString_(question.topic)) errors.push(path + '.topic は必須です。');
    if (!nonEmptyString_(question.sourceReference)) errors.push(path + '.sourceReference は必須です。');
  });
  return errors;
}

function validateWorkGuide_(guide, options) {
  options = options || {};
  const errors = [];
  if (!isPlainObject_(guide)) errors.push('ルートは JSON オブジェクトである必要があります。');
  if (String(guide && guide.schemaVersion) !== APP_CONFIG.schemaVersion) errors.push('schemaVersion は ' + APP_CONFIG.schemaVersion + ' です。');
  if (guide && guide.workGuideId && !/^WG-[A-Za-z0-9][A-Za-z0-9-]*$/.test(String(guide.workGuideId))) errors.push('workGuideId の形式が不正です。');
  if (options.expectedWorkGuideId && String(guide.workGuideId) !== String(options.expectedWorkGuideId)) errors.push('編集中の workGuideId と JSON の workGuideId が一致しません。');
  if (guide && guide.version !== undefined && (!Number.isInteger(Number(guide.version)) || Number(guide.version) < 1)) errors.push('version は1以上の整数です。');
  ['title', 'goal'].forEach(function (field) { if (!nonEmptyString_(guide && guide[field])) errors.push(field + ' は必須です。'); });
  ['assumptions', 'prerequisites', 'warnings'].forEach(function (field) { if (!isStringArray_(guide && guide[field])) errors.push(field + ' は文字列の配列です。'); });
  if (!Array.isArray(guide && guide.sourceSnapshots)) errors.push('sourceSnapshots は配列です。');
  else guide.sourceSnapshots.forEach(function (snapshot, index) {
    if (!snapshot || !nonEmptyString_(snapshot.fileId) || !nonEmptyString_(snapshot.fileName) || !isIsoDate_(snapshot.snapshotAt)) errors.push('sourceSnapshots[' + index + '] は fileId / fileName / ISO 8601 の snapshotAt が必要です。');
  });
  if (!Array.isArray(guide && guide.steps) || !guide.steps.length) errors.push('steps は1件以上必要です。');
  else validateGuideSteps_(guide.steps, guide.sourceSnapshots || [], errors, options);
  throwValidationErrors_(errors, '作業ガイド JSON');
  return guide;
}

function validateGuideSteps_(steps, snapshots, errors, options) {
  const stepIds = {};
  const orders = {};
  const sourceIds = {};
  snapshots.forEach(function (snapshot) { sourceIds[String(snapshot.fileId)] = true; });
  const registered = options.registeredScriptIds || getRegisteredScriptIds_();
  steps.forEach(function (step, index) {
    const path = 'steps[' + index + ']';
    if (!isPlainObject_(step)) { errors.push(path + ' はオブジェクトです。'); return; }
    if (!nonEmptyString_(step.stepId)) errors.push(path + '.stepId は必須です。');
    else if (stepIds[step.stepId]) errors.push(path + '.stepId が重複しています。');
    else stepIds[step.stepId] = true;
    const order = Number(step.order);
    if (!Number.isInteger(order) || order < 1) errors.push(path + '.order は1以上の整数です。');
    else if (orders[order]) errors.push(path + '.order が重複しています。');
    else orders[order] = true;
    if (['input', 'script'].indexOf(step.type) < 0) errors.push(path + '.type は input または script のみです。');
    if (!nonEmptyString_(step.title)) errors.push(path + '.title は必須です。');
    if (!nonEmptyString_(step.description)) errors.push(path + '.description は必須です。');
    if (step.url && !isAllowedUrl_(step.url)) errors.push(path + '.url は http または https URL です。');
    if (!nonEmptyString_(step.completionCriteria)) errors.push(path + '.completionCriteria は必須です。');
    // GUIDE_DEEPDIVE_DESIGN §7.4 の拡張フィールド（任意。指定する場合は構造を検証する）
    if (step.verification !== undefined) {
      if (!isPlainObject_(step.verification) || ['visual', 'command', 'value_match'].indexOf(step.verification.method) < 0 || !nonEmptyString_(step.verification.detail)) {
        errors.push(path + '.verification は method（visual | command | value_match）と detail が必要です。');
      }
    }
    if (step.failureRecovery !== undefined) {
      if (!isPlainObject_(step.failureRecovery) || !Array.isArray(step.failureRecovery.checks) || step.failureRecovery.checks.some(function (check) { return !nonEmptyString_(check); })) {
        errors.push(path + '.failureRecovery は checks（文字列の配列）が必要です。');
      } else if (step.failureRecovery.resumeFrom !== undefined && typeof step.failureRecovery.resumeFrom !== 'string') {
        errors.push(path + '.failureRecovery.resumeFrom は文字列です。');
      }
    }
    if (step.scopeNote !== undefined && typeof step.scopeNote !== 'string') errors.push(path + '.scopeNote は文字列です。');
    if (step.evidenceRefs !== undefined && (!Array.isArray(step.evidenceRefs) || step.evidenceRefs.some(function (entryId) { return !nonEmptyString_(entryId); }))) {
      errors.push(path + '.evidenceRefs は台帳 entryId の配列です。');
    }
    if (!Array.isArray(step.sourceReferences)) errors.push(path + '.sourceReferences は配列です。');
    else step.sourceReferences.forEach(function (fileId) { if (!sourceIds[String(fileId)]) errors.push(path + '.sourceReferences に sourceSnapshots 未登録の fileId があります。'); });
    if (step.type === 'input') validateInputs_(step.inputs, path, errors);
    if (step.type === 'script') {
      if (!nonEmptyString_(step.scriptId)) errors.push(path + '.scriptId は必須です。');
      else if (registered.indexOf(String(step.scriptId)) < 0) errors.push(path + '.scriptId は AllowedActionRegistry に登録されていません。');
      if (!isPlainObject_(step.scriptParams)) errors.push(path + '.scriptParams はオブジェクトです。');
    }
  });
  for (let expected = 1; expected <= steps.length; expected += 1) {
    if (!orders[expected]) errors.push('steps.order は1からの連番にしてください。');
  }
}

// 保存は妨げない品質チェック。抽象的な手順を検出して指摘文を返し、
// 生成AIとの追加往復（具体度チェックプロンプト / 全自動の追加修正）の入力に使う。
function assessWorkGuideDepth_(guide) {
  const findings = [];
  if (!isPlainObject_(guide)) return findings;
  const depth = APP_CONFIG.workGuideDepth;
  if (!Array.isArray(guide.prerequisites) || !guide.prerequisites.length) {
    findings.push('前提条件が空です。必要な権限・プラン・アカウント・事前に準備する物を書いてください。');
  }
  if (!Array.isArray(guide.warnings) || !guide.warnings.length) {
    findings.push('注意事項が空です。取り返しのつかない操作・課金・データ削除など、失敗すると困る点を書いてください。');
  }
  (Array.isArray(guide.steps) ? guide.steps : []).forEach(function (step) {
    if (!isPlainObject_(step)) return;
    const label = '手順' + (step.order || '?') + '「' + String(step.title || '').slice(0, 30) + '」';
    const description = String(step.description || '');
    if (description.replace(/\s+/g, '').length < depth.minDescriptionLength) {
      findings.push(label + ': 説明が短く抽象的です。開く画面・選ぶメニューやボタンの名称・入力する値（形式と例）・失敗した場合の対処まで書いてください。');
    }
    if (step.type === 'input' && !nonEmptyString_(step.url) && !/https?:\/\//.test(description)) {
      findings.push(label + ': 作業対象のURLがありません。開く画面が分かる場合はURLを設定し、不明なら説明に調べ方か【要確認】を書いてください。');
    }
    if (String(step.completionCriteria || '').replace(/\s+/g, '').length < depth.minCompletionCriteriaLength) {
      findings.push(label + ': 完了確認が曖昧です。画面に表示される文言・返ってくる値・確認する操作など、客観的に判定できる内容にしてください。');
    }
  });
  return findings;
}

function validateInputs_(inputs, path, errors) {
  if (!Array.isArray(inputs)) { errors.push(path + '.inputs は配列です。'); return; }
  const inputIds = {};
  inputs.forEach(function (input, index) {
    const inputPath = path + '.inputs[' + index + ']';
    if (!input || !nonEmptyString_(input.inputId) || !nonEmptyString_(input.label)) errors.push(inputPath + ' は inputId と label が必須です。');
    if (input && inputIds[input.inputId]) errors.push(inputPath + '.inputId が重複しています。');
    if (input) inputIds[input.inputId] = true;
    if (!input || ['text', 'choice', 'check'].indexOf(input.inputType) < 0) errors.push(inputPath + '.inputType が許可されていません。');
    if (input && input.inputType === 'choice' && (!Array.isArray(input.choices) || !input.choices.length)) errors.push(inputPath + '.choices は1件以上必要です。');
    if (input && typeof input.required !== 'boolean') errors.push(inputPath + '.required は真偽値です。');
  });
}

function isAllowedUrl_(value) {
  if (!value) return true;
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (error) {
    return /^https?:\/\/[^\s]+$/i.test(String(value));
  }
}

function isIsoDate_(value) {
  return nonEmptyString_(value) && !isNaN(Date.parse(value));
}

function isStringArray_(value) {
  return Array.isArray(value) && value.every(nonEmptyString_);
}

function isPlainObject_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString_(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateArrayField_(object, field, errors) {
  if (!Array.isArray(object && object[field])) errors.push(field + ' は配列です。');
}

function throwValidationErrors_(errors, label) {
  const unique = errors.filter(function (error, index) { return errors.indexOf(error) === index; });
  if (unique.length) throw new AppError('VALIDATION_ERROR', label + ' に ' + unique.length + ' 件の問題があります。', { errors: unique });
}
