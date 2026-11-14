import { AI_BUDGET_FILE } from '../lib/paths.mjs';
import { readJson, updateJsonSecure } from '../lib/safe-store.mjs';

const DEFAULTS = {
  schemaVersion: 1,
  limits: { maxRequestUsd: null, maxMonthlyUsd: null, maxInputTokens: 32000, maxOutputTokens: 4096 },
  pricing: {},
  ledger: []
};
const MAX_LEDGER = 3000;
const RATE_KEY = (provider, model) => `${provider}/${model}`;
const finitePositive = (value) => Number.isFinite(value) && value > 0;

function normalize(value = {}) {
  const limits = value?.limits || {};
  const pricing = value?.pricing && typeof value.pricing === 'object' ? value.pricing : {};
  const ledger = Array.isArray(value?.ledger) ? value.ledger.filter((entry) => entry && typeof entry.createdAt === 'string' && Number.isFinite(entry.costUsd)) : [];
  return {
    schemaVersion: 1,
    limits: {
      maxRequestUsd: finitePositive(limits.maxRequestUsd) ? limits.maxRequestUsd : null,
      maxMonthlyUsd: finitePositive(limits.maxMonthlyUsd) ? limits.maxMonthlyUsd : null,
      maxInputTokens: Number.isInteger(limits.maxInputTokens) && limits.maxInputTokens > 0 ? Math.min(limits.maxInputTokens, 2_000_000) : DEFAULTS.limits.maxInputTokens,
      maxOutputTokens: Number.isInteger(limits.maxOutputTokens) && limits.maxOutputTokens > 0 ? Math.min(limits.maxOutputTokens, 128_000) : DEFAULTS.limits.maxOutputTokens
    },
    pricing: Object.fromEntries(Object.entries(pricing).filter(([key, rate]) => /^[a-z0-9._-]{1,48}\/[A-Za-z0-9._:-]{1,128}$/.test(key) && rate && Number.isFinite(rate.inputUsdPerMillion) && rate.inputUsdPerMillion >= 0 && Number.isFinite(rate.outputUsdPerMillion) && rate.outputUsdPerMillion >= 0).slice(0, 200)),
    ledger: ledger.slice(-MAX_LEDGER)
  };
}

function messageText(messages) {
  return (messages || []).map((message) => typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map((part) => part.text || (part.type === 'image_url' ? '[image]' : '')).join(' ') : '').join('\n');
}
export function estimateTokens(messages) {
  const text = messageText(messages);
  const textTokens = Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
  const imageCount = (messages || []).reduce((count, message) => count + (Array.isArray(message.content) ? message.content.filter((part) => part.type === 'image_url').length : 0), 0);
  return Math.max(1, textTokens + imageCount * 768);
}

export async function getAiBudget() {
  return normalize(await readJson(AI_BUDGET_FILE, DEFAULTS));
}

export async function setAiBudgetLimit(name, value) {
  if (!['maxRequestUsd', 'maxMonthlyUsd', 'maxInputTokens', 'maxOutputTokens'].includes(name)) throw new Error('Unsupported AI budget limit.');
  if (value !== null && (!Number.isFinite(value) || value <= 0)) throw new Error('Budget limits must be positive numbers, or off.');
  let result;
  await updateJsonSecure(AI_BUDGET_FILE, DEFAULTS, (current) => {
    const data = normalize(current);
    data.limits[name] = value;
    result = data;
    return data;
  });
  return result;
}

export async function setAiModelPricing(provider, model, inputUsdPerMillion, outputUsdPerMillion) {
  if (!/^[a-z0-9._-]{1,48}$/.test(provider) || !/^[A-Za-z0-9._:-]{1,128}$/.test(model)) throw new Error('Provider or model identifier contains unsupported characters.');
  if (!Number.isFinite(inputUsdPerMillion) || inputUsdPerMillion < 0 || !Number.isFinite(outputUsdPerMillion) || outputUsdPerMillion < 0 || (inputUsdPerMillion === 0 && outputUsdPerMillion === 0)) throw new Error('Input and output prices must be non-negative USD rates per 1 million tokens, with at least one positive rate.');
  const key = RATE_KEY(provider, model);
  let result;
  await updateJsonSecure(AI_BUDGET_FILE, DEFAULTS, (current) => {
    const data = normalize(current);
    data.pricing[key] = { inputUsdPerMillion, outputUsdPerMillion, updatedAt: new Date().toISOString(), source: 'user-configured' };
    result = data;
    return data;
  });
  return result;
}

export async function previewAiBudget({ provider, model, messages, maxTokens = 2200, local = false, now = new Date() } = {}) {
  const data = await getAiBudget();
  const inputTokens = estimateTokens(messages);
  const outputTokens = Math.max(1, Number.isInteger(maxTokens) ? maxTokens : 2200);
  const limits = data.limits;
  const errors = [];
  if (inputTokens > limits.maxInputTokens) errors.push(`Estimated input ${inputTokens} tokens exceeds the configured limit of ${limits.maxInputTokens}.`);
  if (outputTokens > limits.maxOutputTokens) errors.push(`Requested output ${outputTokens} tokens exceeds the configured limit of ${limits.maxOutputTokens}.`);
  const rate = data.pricing[RATE_KEY(provider, model)];
  const estimatedCostUsd = rate ? (inputTokens * rate.inputUsdPerMillion + outputTokens * rate.outputUsdPerMillion) / 1_000_000 : null;
  const month = now.toISOString().slice(0, 7);
  const monthlyUsedUsd = data.ledger.filter((entry) => entry.month === month && entry.provider && !entry.local).reduce((sum, entry) => sum + entry.costUsd, 0);
  if (!local && (limits.maxRequestUsd || limits.maxMonthlyUsd) && !rate) errors.push(`No user-configured price exists for ${provider}/${model}; monetary limits cannot be safely evaluated. Add it with paxi ai budget price.`);
  if (!local && limits.maxRequestUsd && estimatedCostUsd !== null && estimatedCostUsd > limits.maxRequestUsd) errors.push(`Estimated request cost $${estimatedCostUsd.toFixed(6)} exceeds the per-request cap $${limits.maxRequestUsd}.`);
  if (!local && limits.maxMonthlyUsd && estimatedCostUsd !== null && monthlyUsedUsd + estimatedCostUsd > limits.maxMonthlyUsd) errors.push(`Estimated request would exceed the monthly cap: $${monthlyUsedUsd.toFixed(4)} used + $${estimatedCostUsd.toFixed(6)} estimated > $${limits.maxMonthlyUsd}.`);
  return {
    allowed: errors.length === 0,
    provider, model, local, inputTokensEstimated: inputTokens, outputTokensRequested: outputTokens,
    estimatedCostUsd, monthlyUsedUsd, month, limits,
    pricingConfigured: Boolean(rate), pricingSource: rate?.source || null,
    estimateDisclaimer: 'Token counts are approximate. Costs use only rates manually entered by the developer and are estimates, not provider invoices.',
    errors
  };
}

function normalizeUsage(usage, estimatedInput, estimatedOutput) {
  const input = usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount ?? estimatedInput;
  const output = usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount ?? estimatedOutput;
  return { inputTokens: Number.isFinite(input) ? input : estimatedInput, outputTokens: Number.isFinite(output) ? output : estimatedOutput, source: usage ? 'provider-usage' : 'estimated' };
}

export async function recordAiBudgetUsage({ provider, model, usage, budgetPreview, local = false }) {
  if (!budgetPreview) return null;
  const tokens = normalizeUsage(usage, budgetPreview.inputTokensEstimated, budgetPreview.outputTokensRequested);
  const rate = (await getAiBudget()).pricing[RATE_KEY(provider, model)];
  if (!rate) return null;
  const costUsd = (tokens.inputTokens * rate.inputUsdPerMillion + tokens.outputTokens * rate.outputUsdPerMillion) / 1_000_000;
  const created = new Date();
  const entry = { createdAt: created.toISOString(), month: created.toISOString().slice(0, 7), provider, model, local: Boolean(local), ...tokens, costUsd, estimate: tokens.source !== 'provider-usage' };
  await updateJsonSecure(AI_BUDGET_FILE, DEFAULTS, (current) => {
    const data = normalize(current);
    data.ledger.push(entry);
    data.ledger = data.ledger.slice(-MAX_LEDGER);
    return data;
  });
  return entry;
}

export async function clearAiBudgetHistory({ confirm = false } = {}) {
  if (!confirm) throw new Error('Clearing AI budget history requires explicit confirmation.');
  await updateJsonSecure(AI_BUDGET_FILE, DEFAULTS, (current) => ({ ...normalize(current), ledger: [] }));
  return { cleared: true };
}
