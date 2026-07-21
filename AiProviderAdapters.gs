/**
 * Provider adapters for the generic generative-AI connector.
 * Each adapter only knows how to build that provider's HTTP request and how
 * to parse that provider's response shape into the common
 * { text, refusals, responseId, usage } result. callAiProvider_() owns the
 * transport (fetch, retry, error handling) and never branches on provider
 * name, so adding a new provider means adding one more entry to AI_PROVIDERS.
 */
const AI_PROVIDERS = Object.freeze({
  openai: Object.freeze({
    label: 'OpenAI',
    buildRequest: buildOpenAiRequest_,
    parseResponse: parseOpenAiResponse_,
    parseErrorMessage: parseOpenAiCompatibleErrorMessage_
  }),
  gemini: Object.freeze({
    label: 'Google Gemini',
    buildRequest: buildGeminiRequest_,
    parseResponse: parseGeminiResponse_,
    parseErrorMessage: parseGeminiErrorMessage_
  }),
  anthropic: Object.freeze({
    label: 'Anthropic Claude',
    buildRequest: buildAnthropicRequest_,
    parseResponse: parseAnthropicResponse_,
    parseErrorMessage: parseAnthropicErrorMessage_
  }),
  openrouter: Object.freeze({
    label: 'OpenRouter',
    buildRequest: buildOpenRouterRequest_,
    parseResponse: parseOpenAiCompatibleResponse_,
    parseErrorMessage: parseOpenAiCompatibleErrorMessage_
  })
});

function getAiProviderAdapter_(providerKey) {
  const adapter = AI_PROVIDERS[providerKey];
  assertApp_(adapter, 'VALIDATION_ERROR', '未対応の生成AIプロバイダーです: ' + providerKey);
  return adapter;
}

function listAiProviderOptions_() {
  return Object.keys(AI_PROVIDERS).map(function (key) {
    return { value: key, label: AI_PROVIDERS[key].label };
  });
}

/**
 * Sends one prompt to the configured provider and returns the extracted
 * text plus metadata. Retries on 429/5xx. Provider-specific request shape
 * and response parsing are delegated to the adapter; this function is the
 * only place that talks to UrlFetchApp.
 */
function callAiProvider_(settings, prompt) {
  const adapter = getAiProviderAdapter_(settings.provider);
  const request = adapter.buildRequest(settings, prompt);
  let responseCode = 0;
  let responseText = '';
  let parsedResponse = null;
  let fetchError = null;
  for (let networkAttempt = 1; networkAttempt <= 2; networkAttempt += 1) {
    try {
      const response = UrlFetchApp.fetch(request.url, {
        method: request.method || 'post',
        contentType: 'application/json',
        headers: request.headers || {},
        payload: request.payload ? JSON.stringify(request.payload) : undefined,
        muteHttpExceptions: true
      });
      responseCode = response.getResponseCode();
      responseText = response.getContentText('UTF-8');
      try { parsedResponse = JSON.parse(responseText); } catch (ignored) { parsedResponse = null; }
      if ((responseCode === 429 || responseCode >= 500) && networkAttempt < 2) {
        Utilities.sleep(1200 * networkAttempt);
        continue;
      }
      break;
    } catch (error) {
      fetchError = error;
      responseText = error.message || String(error);
      if (networkAttempt < 2) Utilities.sleep(1200 * networkAttempt);
    }
  }
  if (fetchError && !responseCode) {
    throw new AppError('AI_CONNECTION_FAILED', adapter.label + ' へ接続できませんでした。', { error: responseText, raw: null });
  }
  if (responseCode < 200 || responseCode >= 300) {
    const message = aiProviderErrorMessage_(adapter, responseCode, responseText, parsedResponse);
    throw new AppError('AI_API_ERROR', message, { status: responseCode, raw: parsedResponse || { raw: responseText } });
  }
  assertApp_(parsedResponse, 'AI_RESPONSE_PARSE_ERROR', adapter.label + ' の応答をJSONとして読み取れませんでした。', { raw: { raw: responseText } });
  const parsed = adapter.parseResponse(parsedResponse);
  if (parsed.refusals && parsed.refusals.length) {
    throw new AppError('AI_REFUSAL', '生成AIが処理を拒否しました。', { refusals: parsed.refusals, raw: parsedResponse });
  }
  return { text: (parsed.text || '').trim(), responseId: parsed.responseId || '', usage: parsed.usage || {}, raw: parsedResponse };
}

function aiProviderErrorMessage_(adapter, status, body, parsedResponse) {
  let message = '';
  try { message = adapter.parseErrorMessage(parsedResponse); } catch (ignored) { message = ''; }
  return adapter.label + ' APIエラー' + (status ? '（HTTP ' + status + '）' : '') + ': ' + (message || previewText_(body) || '応答がありません。');
}

/* ---------- OpenAI (Responses API) ---------- */

function buildOpenAiRequest_(settings, prompt) {
  return {
    url: 'https://api.openai.com/v1/responses',
    headers: { Authorization: 'Bearer ' + settings.apiKey },
    payload: {
      model: settings.model,
      input: prompt,
      text: { format: { type: 'json_object' } },
      reasoning: { effort: 'low' },
      max_output_tokens: 16000,
      store: false
    }
  };
}

function parseOpenAiResponse_(response) {
  const texts = [];
  const refusals = [];
  (response && response.output || []).forEach(function (item) {
    if (item && item.type === 'message') (item.content || []).forEach(function (content) {
      if (content.type === 'output_text' && typeof content.text === 'string') texts.push(content.text);
      if (content.type === 'refusal' && content.refusal) refusals.push(content.refusal);
    });
  });
  return { text: texts.join('\n'), refusals: refusals, responseId: response.id || '', usage: response.usage || {} };
}

/* ---------- Google Gemini ---------- */

function buildGeminiRequest_(settings, prompt) {
  return {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(settings.model) + ':generateContent',
    headers: { 'x-goog-api-key': settings.apiKey },
    payload: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    }
  };
}

function parseGeminiResponse_(response) {
  const candidate = (response && response.candidates || [])[0] || {};
  const refusals = [];
  if (response && response.promptFeedback && response.promptFeedback.blockReason) refusals.push(response.promptFeedback.blockReason);
  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') refusals.push(candidate.finishReason);
  const parts = (candidate.content && candidate.content.parts) || [];
  const text = parts.map(function (part) { return part.text || ''; }).join('\n');
  return { text: text, refusals: refusals, responseId: response.responseId || '', usage: response.usageMetadata || {} };
}

function parseGeminiErrorMessage_(parsedResponse) {
  return parsedResponse && parsedResponse.error && parsedResponse.error.message ? parsedResponse.error.message : '';
}

/* ---------- Anthropic Claude ---------- */

function buildAnthropicRequest_(settings, prompt) {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' },
    payload: {
      model: settings.model,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }]
    }
  };
}

function parseAnthropicResponse_(response) {
  const refusals = response && response.stop_reason === 'refusal' ? ['refusal'] : [];
  const text = (response && response.content || [])
    .filter(function (block) { return block && block.type === 'text'; })
    .map(function (block) { return block.text || ''; })
    .join('\n');
  return { text: text, refusals: refusals, responseId: response.id || '', usage: response.usage || {} };
}

function parseAnthropicErrorMessage_(parsedResponse) {
  return parsedResponse && parsedResponse.error && parsedResponse.error.message ? parsedResponse.error.message : '';
}

/* ---------- OpenRouter (OpenAI-compatible chat completions) ---------- */

function buildOpenRouterRequest_(settings, prompt) {
  return {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      Authorization: 'Bearer ' + settings.apiKey,
      'HTTP-Referer': 'https://script.google.com/',
      'X-Title': APP_CONFIG.appName
    },
    payload: {
      model: settings.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 16000
    }
  };
}

function parseOpenAiCompatibleResponse_(response) {
  const choice = (response && response.choices || [])[0] || {};
  const message = choice.message || {};
  const refusals = [];
  if (message.refusal) refusals.push(message.refusal);
  if (choice.finish_reason === 'content_filter') refusals.push(choice.finish_reason);
  return { text: message.content || '', refusals: refusals, responseId: response.id || '', usage: response.usage || {} };
}

function parseOpenAiCompatibleErrorMessage_(parsedResponse) {
  if (!parsedResponse || !parsedResponse.error) return '';
  if (typeof parsedResponse.error === 'string') return parsedResponse.error;
  return parsedResponse.error.message || '';
}
