import { getProvider } from './providers.mjs';
import { previewAiBudget, recordAiBudgetUsage } from './budget.mjs';


export async function readJsonBounded(response, maxBytes = 2 * 1024 * 1024) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`AI response exceeded the ${maxBytes}-byte limit.`);
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`AI response exceeded the ${maxBytes}-byte limit.`);
    try { return JSON.parse(text); } catch { throw new Error('AI provider returned invalid JSON.'); }
  }
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new Error(`AI response exceeded the ${maxBytes}-byte limit.`); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock?.(); }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { throw new Error('AI provider returned invalid JSON.'); }
}

function normalizeMessages(messages) {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200) throw new Error('AI messages must be a non-empty array of at most 200 messages.');
  for (const [index, message] of messages.entries()) {
    if (!message || !['system', 'user', 'assistant'].includes(message.role)) throw new Error(`AI message ${index + 1} has an unsupported role.`);
    if (typeof message.content === 'string') continue;
    if (!Array.isArray(message.content) || message.content.length === 0 || message.content.length > 100) throw new Error(`AI message ${index + 1} content must be text or a bounded content-part array.`);
    for (const [partIndex, part] of message.content.entries()) {
      if (part?.type === 'text' && typeof part.text === 'string') continue;
      const imageUrl = part?.type === 'image_url' ? part.image_url?.url : null;
      if (typeof imageUrl === 'string' && /^data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageUrl)) continue;
      throw new Error(`AI message ${index + 1} content part ${partIndex + 1} is unsupported; use text or a base64 data:image URL.`);
    }
  }
}

function validateRequestArguments({ model, messages, maxTokens, temperature, maxResponseBytes }) {
  if (typeof model !== 'string' || !model.trim() || model.length > 180 || /[\r\n\0]/.test(model)) throw new Error('AI model ID must be 1–180 characters with no control characters.');
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 128_000) throw new Error('AI maxTokens must be an integer between 1 and 128000.');
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('AI temperature must be a number between 0 and 2.');
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 50 * 1024 * 1024) throw new Error('AI maxResponseBytes must be an integer between 1024 and 52428800.');
  validateMessages(messages);
}

function extractText(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((part) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
  return '';
}

export async function requestModel({ providerId, baseUrl, apiKey, model, messages, maxTokens = 1800, temperature = 0.2, signal, maxResponseBytes = 2 * 1024 * 1024 }) {
  validateRequestArguments({ model, messages, maxTokens, temperature, maxResponseBytes });
  const provider = getProvider(providerId);
  const base = new URL(baseUrl || provider.baseUrl);
  const local = provider.category === 'local';
  if (base.username || base.password || base.search || base.hash) throw new Error('Provider endpoint URLs cannot contain credentials, query strings or fragments.');
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) {
    throw new Error('Cloud providers must use HTTPS. HTTP is supported only for loopback local AI endpoints.');
  }
  if (!local && !apiKey) throw new Error(`No API key is available for ${provider.name}. Add it with paxi ai key add ${providerId} or set ${(provider.envKey ? [provider.envKey, ...(provider.envAliases || [])] : []).join(' or ')}.`);
  let url;
  let headers = { 'Content-Type': 'application/json' };
  let body;
  const normalized = normalizeMessages(messages);
  const budgetPreview = await previewAiBudget({ provider: providerId, model, messages, maxTokens, local });
  if (!budgetPreview.allowed) throw new Error(`AI budget guard blocked this request: ${budgetPreview.errors.join(' ')}`);
  if (provider.protocol === 'anthropic') {
    url = new URL(`${base.pathname.replace(/\/$/, '')}/v1/messages`, base.origin);
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    const system = normalized.filter((entry) => entry.role === 'system').map((entry) => String(entry.content)).join('\n');
    body = { model, max_tokens: maxTokens, temperature, ...(system ? { system } : {}), messages: normalized.filter((entry) => entry.role !== 'system').map((entry) => ({ role: entry.role === 'assistant' ? 'assistant' : 'user', content: typeof entry.content === 'string' ? entry.content : entry.content.map((part) => part.type === 'image_url' ? ({ type: 'image', source: { type: 'base64', media_type: part.image_url.url.match(/^data:([^;]+);base64,/)?.[1] || 'image/png', data: part.image_url.url.split(',')[1] } }) : ({ type: 'text', text: part.text || '' })) })) };
  } else if (provider.protocol === 'gemini') {
    url = new URL(`${base.pathname.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`, base.origin);
    headers['x-goog-api-key'] = apiKey;
    const system = normalized.filter((entry) => entry.role === 'system').map((entry) => String(entry.content)).join('\n');
    body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: normalized.filter((entry) => entry.role !== 'system').map((entry) => ({ role: entry.role === 'assistant' ? 'model' : 'user', parts: typeof entry.content === 'string' ? [{ text: entry.content }] : entry.content.map((part) => part.type === 'image_url' ? ({ inline_data: { mime_type: part.image_url.url.match(/^data:([^;]+);base64,/)?.[1] || 'image/png', data: part.image_url.url.split(',')[1] } }) : ({ text: part.text || '' })) })),
      // Gemini 3.8+ rejects legacy sampling fields such as temperature/topP/topK.
      generationConfig: { maxOutputTokens: maxTokens }
    };
  } else {
    url = new URL(`${base.pathname.replace(/\/+$/, '')}/chat/completions`, base.origin);
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (providerId === 'openai') {
      // OpenAI now recommends max_completion_tokens; max_tokens is deprecated.
      // GPT-6 reasoning routes reject legacy sampling parameters such as temperature.
      const reasoningModel = /^(?:gpt-6(?:[.-]|$)|o[1-9])/i.test(model);
      const openAiMessages = reasoningModel
        ? normalized.map((message) => message.role === 'system' ? { ...message, role: 'developer' } : message)
        : normalized;
      body = { model, max_completion_tokens: maxTokens, messages: openAiMessages };
      if (!reasoningModel) body.temperature = temperature;
    } else {
      body = { model, temperature, max_tokens: maxTokens, messages: normalized };
    }
  }
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: signal || AbortSignal.timeout(120000) });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('AI request timed out. Check model size, device performance and network connectivity.');
    throw new Error(`AI provider connection failed: ${error.message}`);
  }
  const payload = await readJsonBounded(response, maxResponseBytes).catch((error) => {
    if (response.ok) throw error;
    return { error: { message: error.message } };
  });
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(`${provider.name} request failed: ${String(message).slice(0, 900)}`);
  }
  let answer = '';
  if (provider.protocol === 'anthropic') answer = extractText(payload?.content);
  else if (provider.protocol === 'gemini') answer = extractText(payload?.candidates?.[0]?.content?.parts);
  else answer = extractText(payload?.choices?.[0]?.message?.content);
  if (!answer) throw new Error(`${provider.name} returned no readable answer. Confirm the model supports the requested input type.`);
  const usage = payload?.usage || payload?.usageMetadata || null;
  const budgetUsage = await recordAiBudgetUsage({ provider: providerId, model, usage, budgetPreview, local });
  return { answer, provider: providerId, model, usage, budget: { ...budgetPreview, recorded: Boolean(budgetUsage), recordedCostUsd: budgetUsage?.costUsd ?? null, usageSource: budgetUsage?.source ?? null } };
}

export function modelListEndpoint(providerId, baseUrl) {
  const provider = getProvider(providerId);
  const base = new URL(baseUrl || provider.baseUrl);
  if (provider.protocol === 'gemini') return new URL(`${base.pathname.replace(/\/$/, '')}/models`, base.origin);
  if (provider.protocol === 'anthropic') return new URL('/v1/models', base.origin);
  if (provider.category === 'local' && providerId === 'ollama') return new URL('/api/tags', base.origin);
  return new URL(`${base.pathname.replace(/\/+$/, '')}/models`, base.origin);
}
