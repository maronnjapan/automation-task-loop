/**
 * Generic generative-AI connection used by the unattended workflow. The
 * actual HTTP request/response shape per provider (OpenAI, Google Gemini,
 * Anthropic Claude, or any OpenRouter-proxied model) lives in
 * AiProviderAdapters.gs; this file only handles settings storage and
 * interaction logging, so it never needs to change when a provider is added.
 * The API key is kept in Script Properties and is never returned to the
 * browser or written to an interaction log. Every prompt/response pair is
 * archived in Drive so the human reviewer can inspect how a guide was
 * produced later.
 */
function getAiAutomationSettings_() {
  const properties = PropertiesService.getScriptProperties();
  const storedProvider = properties.getProperty(APP_CONFIG.propertyKeys.aiProvider) || APP_CONFIG.defaultAiProvider;
  const provider = AI_PROVIDERS[storedProvider] ? storedProvider : APP_CONFIG.defaultAiProvider;
  const key = properties.getProperty(APP_CONFIG.propertyKeys.aiApiKey)
    || (provider === 'openai' ? properties.getProperty(APP_CONFIG.propertyKeys.legacyOpenAiApiKey) : '')
    || '';
  const model = properties.getProperty(APP_CONFIG.propertyKeys.aiModel)
    || (provider === 'openai' ? properties.getProperty(APP_CONFIG.propertyKeys.legacyOpenAiModel) : '')
    || APP_CONFIG.defaultAiModels[provider] || '';
  const consent = properties.getProperty(APP_CONFIG.propertyKeys.aiDataConsent) === 'true';
  const enabled = properties.getProperty(APP_CONFIG.propertyKeys.aiAutomationEnabled) === 'true';
  const repairAttempts = Number(properties.getProperty(APP_CONFIG.propertyKeys.aiMaxRepairAttempts) || APP_CONFIG.defaultAiMaxRepairAttempts);
  return {
    provider: provider,
    providerLabel: getAiProviderAdapter_(provider).label,
    providerOptions: listAiProviderOptions_(),
    model: model,
    apiKeyConfigured: Boolean(key),
    dataConsent: consent,
    autoProcessingEnabled: enabled && Boolean(key) && consent,
    requestedAutoProcessingEnabled: enabled,
    maxRepairAttempts: Number.isInteger(repairAttempts) && repairAttempts >= 0 && repairAttempts <= 2 ? repairAttempts : APP_CONFIG.defaultAiMaxRepairAttempts
  };
}

function getAiAutomationSettings() {
  return withClientError_(function () {
    return { success: true, settings: getAiAutomationSettings_() };
  });
}

function saveAiAutomationSettings(input) {
  return withClientError_(function () {
    input = input || {};
    requireConfigured_();
    ensureManagementSchemaCurrent_();
    ensureFolderPath_(getRootFolder_(), APP_CONFIG.folderPaths.aiInteractionLogs);
    const properties = PropertiesService.getScriptProperties();
    const provider = nonEmptyString_(input.provider) ? input.provider.trim() : APP_CONFIG.defaultAiProvider;
    assertApp_(AI_PROVIDERS[provider], 'VALIDATION_ERROR', '未対応の生成AIプロバイダーです。');
    const model = nonEmptyString_(input.model) ? input.model.trim() : APP_CONFIG.defaultAiModels[provider];
    assertApp_(/^[A-Za-z0-9._\/-]{2,120}$/.test(model || ''), 'VALIDATION_ERROR', 'モデル名の形式が不正です。');
    const repairAttempts = Number(input.maxRepairAttempts);
    assertApp_(Number.isInteger(repairAttempts) && repairAttempts >= 0 && repairAttempts <= 2, 'VALIDATION_ERROR', 'JSON自動修復回数は0〜2回です。');
    if (input.clearApiKey === true) properties.deleteProperty(APP_CONFIG.propertyKeys.aiApiKey);
    else if (nonEmptyString_(input.apiKey)) {
      const apiKey = input.apiKey.trim();
      assertApp_(apiKey.length >= 20 && apiKey.length <= 300, 'VALIDATION_ERROR', 'APIキーの形式を確認してください。');
      properties.setProperty(APP_CONFIG.propertyKeys.aiApiKey, apiKey);
    }
    const keyConfigured = Boolean(properties.getProperty(APP_CONFIG.propertyKeys.aiApiKey) || (provider === 'openai' && properties.getProperty(APP_CONFIG.propertyKeys.legacyOpenAiApiKey)));
    const consent = input.dataConsent === true;
    const enabled = input.autoProcessingEnabled === true;
    assertApp_(!enabled || keyConfigured, 'AI_API_KEY_REQUIRED', '全自動処理を有効にするにはAPIキーを設定してください。');
    assertApp_(!enabled || consent, 'AI_DATA_CONSENT_REQUIRED', '会議記録をAI APIへ送信することを確認してください。');
    properties.setProperties((function () {
      const values = {};
      values[APP_CONFIG.propertyKeys.aiProvider] = provider;
      values[APP_CONFIG.propertyKeys.aiModel] = model;
      values[APP_CONFIG.propertyKeys.aiMaxRepairAttempts] = String(repairAttempts);
      values[APP_CONFIG.propertyKeys.aiDataConsent] = String(consent);
      values[APP_CONFIG.propertyKeys.aiAutomationEnabled] = String(enabled);
      return values;
    })(), false);
    if (enabled && findAutoRegisterTriggers_().length) refreshAutoRegisterTriggerSchedule_();
    return { success: true, settings: getAiAutomationSettings_() };
  });
}

function testAiAutomationConnection() {
  return withClientError_(function () {
    const settings = requireAiAutomationSettings_(false);
    const result = callAiProvider_(settings, 'Reply with the single word: OK');
    assertApp_(nonEmptyString_(result.text), 'AI_CONNECTION_FAILED', '接続はできましたが、応答本文が空でした。');
    return { success: true, provider: settings.provider, model: settings.model, message: settings.providerLabel + ' へ接続できました。' };
  });
}

function requireAiAutomationSettings_(requireEnabled) {
  const publicSettings = getAiAutomationSettings_();
  const properties = PropertiesService.getScriptProperties();
  const apiKey = properties.getProperty(APP_CONFIG.propertyKeys.aiApiKey)
    || (publicSettings.provider === 'openai' ? properties.getProperty(APP_CONFIG.propertyKeys.legacyOpenAiApiKey) : '')
    || '';
  assertApp_(apiKey, 'AI_API_KEY_REQUIRED', '管理・診断画面で生成AIのAPIキーを設定してください。');
  assertApp_(publicSettings.dataConsent, 'AI_DATA_CONSENT_REQUIRED', '会議記録をAI APIへ送信する設定が未確認です。');
  if (requireEnabled !== false) assertApp_(publicSettings.autoProcessingEnabled, 'AI_AUTOMATION_DISABLED', '生成AIによる全自動処理が停止中です。');
  return Object.assign({}, publicSettings, { apiKey: apiKey });
}

function runAiJsonTask_(options) {
  options = options || {};
  const settings = requireAiAutomationSettings_(options.requireEnabled !== false);
  assertApp_(nonEmptyString_(options.prompt), 'VALIDATION_ERROR', 'AIへ送るプロンプトがありません。');
  assertApp_(typeof options.validator === 'function', 'VALIDATION_ERROR', 'AI回答の検証処理がありません。');
  const conversationId = options.conversationId || createId_('AICONV');
  const maxRepairs = options.maxRepairAttempts === undefined ? settings.maxRepairAttempts : Number(options.maxRepairAttempts);
  const originalPrompt = 'APIのJSONモードを使用しています。コードブロックや前後の説明は付けず、JSONオブジェクトだけを返してください。\n\n' + options.prompt;
  let prompt = originalPrompt;
  let lastError = null;
  for (let iteration = 1; iteration <= maxRepairs + 1; iteration += 1) {
    const invoked = invokeAiJson_(settings, prompt, Object.assign({}, options.meta || {}, {
      conversationId: conversationId,
      phase: options.phase || 'generation',
      iteration: iteration
    }));
    try {
      const parsed = parsePastedJson_(invoked.text);
      const validated = options.validator(parsed);
      markAiInteractionValidation_(invoked.interactionId, { valid: true, errors: [] }, 'completed', '');
      return { value: validated, text: invoked.text, conversationId: conversationId, interactionId: invoked.interactionId, responseId: invoked.responseId, usage: invoked.usage || {} };
    } catch (error) {
      lastError = error;
      const errors = validationErrorMessages_(error);
      markAiInteractionValidation_(invoked.interactionId, { valid: false, errors: errors }, 'invalid', error.message || String(error));
      if (iteration > maxRepairs) break;
      prompt = buildAiJsonRepairPrompt_(originalPrompt, invoked.text, errors);
    }
  }
  throw new AppError('AI_OUTPUT_INVALID', 'AI回答を自動修復しても検証に通りませんでした。AI対話履歴から回答とエラーを確認できます。', {
    errors: validationErrorMessages_(lastError), conversationId: conversationId
  });
}

function invokeAiJson_(settings, prompt, meta) {
  let result;
  try {
    result = callAiProvider_(settings, prompt);
  } catch (error) {
    const responseData = (error.details && error.details.raw) || { error: error.message || String(error) };
    const failedId = recordAiInteraction_(meta, settings, prompt, responseData, '', 'failed', error.message || String(error));
    if (error instanceof AppError) {
      error.details = Object.assign({}, error.details || {}, { interactionId: failedId });
      throw error;
    }
    throw new AppError('AI_CONNECTION_FAILED', settings.providerLabel + ' への接続に失敗しました。', { interactionId: failedId, error: String(error) });
  }
  const interactionId = recordAiInteraction_(meta, settings, prompt, result.raw, result.text, 'received', '');
  assertApp_(nonEmptyString_(result.text), 'AI_EMPTY_RESPONSE', settings.providerLabel + ' から回答本文を取得できませんでした。', { interactionId: interactionId });
  return { text: result.text, interactionId: interactionId, responseId: result.responseId, usage: result.usage || {} };
}

function recordAiInteraction_(meta, settings, prompt, responseData, responsePreview, status, errorMessage) {
  const interactionId = createId_('AI');
  const spreadsheet = getManagementSpreadsheet_();
  if (!spreadsheet.getSheetByName('AiInteractions')) ensureManagementSheets_(spreadsheet);
  const folder = ensureFolderPath_(getRootFolder_(), APP_CONFIG.folderPaths.aiInteractionLogs);
  const requestFile = createJsonFile_(folder, interactionId + '_request.json', {
    interactionId: interactionId, conversationId: meta.conversationId || '', phase: meta.phase || '', iteration: Number(meta.iteration || 1),
    provider: settings.provider || APP_CONFIG.defaultAiProvider, model: settings.model, prompt: prompt, createdAt: nowIso_()
  });
  const responseFile = createJsonFile_(folder, interactionId + '_response.json', {
    interactionId: interactionId, response: responseData, createdAt: nowIso_()
  });
  appendObject_('AiInteractions', {
    interactionId: interactionId, conversationId: meta.conversationId || '', meetingId: meta.meetingId || '', actionId: meta.actionId || '',
    workGuideId: meta.workGuideId || '', buildSessionId: meta.buildSessionId || '', phase: meta.phase || '', iteration: Number(meta.iteration || 1),
    provider: settings.provider || APP_CONFIG.defaultAiProvider, model: settings.model, requestFileId: requestFile.getId(), responseFileId: responseFile.getId(),
    requestPreview: previewText_(prompt), responsePreview: previewText_(responsePreview || JSON.stringify(responseData || {})),
    status: status || 'received', validationJson: {}, error: errorMessage || '', createdAt: nowIso_()
  });
  return interactionId;
}

function recordManualAiInteraction_(meta, prompt, responseText, validation) {
  if (!nonEmptyString_(prompt) || !nonEmptyString_(responseText)) return '';
  const settings = { provider: 'manual', model: 'manual-copy-paste' };
  const interactionId = recordAiInteraction_(Object.assign({ conversationId: createId_('AICONV'), iteration: 1 }, meta || {}), settings, prompt, { text: responseText }, responseText, 'completed', '');
  markAiInteractionValidation_(interactionId, validation || { valid: true, errors: [] }, 'completed', '');
  const row = findRow_('AiInteractions', function (item) { return String(item.interactionId) === String(interactionId); });
  if (row) updateRow_('AiInteractions', row._rowNumber, { model: 'copy-paste' });
  return interactionId;
}

function markAiInteractionValidation_(interactionId, validation, status, errorMessage) {
  const row = findRow_('AiInteractions', function (item) { return String(item.interactionId) === String(interactionId); });
  if (row) updateRow_('AiInteractions', row._rowNumber, { validationJson: validation || {}, status: status || row.status, error: errorMessage || '' });
}

function linkAiInteractionsToWorkGuide_(actionId, workGuideId) {
  findRows_('AiInteractions', function (row) {
    return String(row.actionId) === String(actionId) && !row.workGuideId;
  }).forEach(function (row) { updateRow_('AiInteractions', row._rowNumber, { workGuideId: workGuideId }); });
}

function listAiInteractions(filter) {
  return withClientError_(function () {
    filter = filter || {};
    let linkedActionId = filter.actionId || '';
    if (filter.workGuideId && !linkedActionId) {
      const guide = requireWorkGuideRecord_(filter.workGuideId);
      linkedActionId = guide.actionId;
    }
    const rows = findRows_('AiInteractions', function (row) {
      if (filter.meetingId && String(row.meetingId) !== String(filter.meetingId)) return false;
      if (linkedActionId && String(row.actionId) !== String(linkedActionId) && String(row.workGuideId) !== String(filter.workGuideId || '')) return false;
      if (filter.workGuideId && String(row.workGuideId) !== String(filter.workGuideId) && String(row.actionId) !== String(linkedActionId)) return false;
      return Boolean(filter.meetingId || linkedActionId || filter.workGuideId);
    }).reverse().slice(0, 50).map(function (row) {
      const item = stripRowMetadata_(row);
      item.validation = parseJsonCell_(item.validationJson, {});
      delete item.validationJson;
      const requestFile = getFileSafely_(item.requestFileId);
      const responseFile = getFileSafely_(item.responseFileId);
      item.requestUrl = requestFile ? requestFile.getUrl() : '';
      item.responseUrl = responseFile ? responseFile.getUrl() : '';
      return item;
    });
    return { success: true, interactions: rows };
  });
}

function validationErrorMessages_(error) {
  if (error && error.details && Array.isArray(error.details.errors)) return error.details.errors.slice();
  return [error && error.message ? error.message : String(error || '不明な検証エラー')];
}

function previewText_(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 600 ? text.slice(0, 600) + '…' : text;
}
