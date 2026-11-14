import { getAiBudget, setAiBudgetLimit, setAiModelPricing, clearAiBudgetHistory } from '../ai/budget.mjs';

function amount(value, label) {
  if (value === 'off') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number or off.`);
  return parsed;
}

export async function aiBudgetCommand(args = []) {
  const [action, ...rest] = args;
  if (!action || action === 'show') {
    const data = await getAiBudget();
    const month = new Date().toISOString().slice(0, 7);
    const used = data.ledger.filter((item) => item.month === month && !item.local).reduce((sum, item) => sum + item.costUsd, 0);
    const report = { ...data, currentMonth: month, trackedCloudSpendUsd: Number(used.toFixed(8)), note: 'Usage totals are estimates based on provider usage fields when present and developer-entered model rates. They are not invoices.' };
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  if (action === 'limit') {
    const [which, raw] = rest;
    const names = { request: 'maxRequestUsd', monthly: 'maxMonthlyUsd' };
    if (!names[which] || rest.length !== 2) throw new Error('Usage: paxi ai budget limit <request|monthly> <USD|off>');
    const result = await setAiBudgetLimit(names[which], amount(raw, 'USD limit'));
    console.log(`✓ Saved ${which} AI spend limit: ${raw}.`);
    return result;
  }
  if (action === 'tokens') {
    if (rest.length !== 2 || !/^\d+$/.test(rest[0]) || !/^\d+$/.test(rest[1])) throw new Error('Usage: paxi ai budget tokens <max-input-tokens> <max-output-tokens>');
    const input = Number(rest[0]); const output = Number(rest[1]);
    if (input < 1 || input > 2_000_000 || output < 1 || output > 128_000) throw new Error('Token limits are outside the supported range.');
    const [a, b] = await Promise.all([setAiBudgetLimit('maxInputTokens', input), setAiBudgetLimit('maxOutputTokens', output)]);
    console.log(`✓ Saved token limits: ${input} input / ${output} output.`);
    return b || a;
  }
  if (action === 'price') {
    if (rest.length !== 4) throw new Error('Usage: paxi ai budget price <provider> <model> <input-USD-per-1M> <output-USD-per-1M>');
    const input = Number(rest[2]); const output = Number(rest[3]);
    const result = await setAiModelPricing(rest[0], rest[1], input, output);
    console.log(`✓ Saved your pricing for ${rest[0]}/${rest[1]}.`);
    return result;
  }
  if (action === 'history') {
    if (rest.length) throw new Error('Usage: paxi ai budget history');
    const data = await getAiBudget();
    const entries = data.ledger.slice(-100);
    console.log(JSON.stringify(entries, null, 2));
    return entries;
  }
  if (action === 'clear') {
    if (rest.length !== 1 || rest[0] !== '--confirm') throw new Error('Usage: paxi ai budget clear --confirm');
    const result = await clearAiBudgetHistory({ confirm: true });
    console.log('✓ AI usage estimate history cleared; limits and model rates were preserved.');
    return result;
  }
  throw new Error('Usage: paxi ai budget <show|limit|tokens|price|history|clear>');
}
