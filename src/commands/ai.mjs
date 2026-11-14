import { getConfig, setConfigValue, setConfigValues } from '../lib/config.mjs';
import { ask } from '../lib/prompt.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';
import { buildAdaptiveContext } from '../doctor/adaptive-context.mjs';
import { requestModel } from '../ai/transport.mjs';
import { resolveConfiguredRoute, unlockProviderKeyForRequest, aiStudio } from '../ai/studio.mjs';
import { resolveTaskRoute } from '../ai/task-router.mjs';
import { recommendAgentRoute } from '../ai/agent-selector.mjs';
import { listVaultProviders, vaultExists } from '../ai/vault.mjs';

function parseUrl(value, allowRemote) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error('Do not embed credentials, query strings or fragments in the AI endpoint URL.');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) throw new Error('AI endpoints must use HTTPS. HTTP is permitted only for localhost.');
  if (!allowRemote && !loopback) throw new Error('Local AI mode only connects to localhost.');
  return url;
}

export async function readBoundedJson(response, maxBytes = 2 * 1024 * 1024) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`AI response is too large (${declared} bytes; limit ${maxBytes}).`);
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`AI response exceeded the ${maxBytes}-byte limit.`);
    try { return JSON.parse(text); } catch { throw new Error('AI provider returned invalid JSON. Check the configured endpoint and response format.'); }
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`AI response exceeded the ${maxBytes}-byte limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock?.(); }
  try { return JSON.parse(Buffer.concat(chunks, total).toString('utf8')); }
  catch { throw new Error('AI provider returned invalid JSON. Check the configured endpoint and response format.'); }
}

export async function aiConfigure(args = []) {
  let mode = null;
  let url = null;
  let model = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--mode' && args[i + 1]) mode = args[++i];
    else if (args[i] === '--url' && args[i + 1]) url = args[++i];
    else if (args[i] === '--model' && args[i + 1]) model = args[++i];
    else throw new Error('Usage: paxi ai configure --mode off|local|api [--url <endpoint>] [--model <name>]');
  }
  if (!['off', 'local', 'api'].includes(mode)) throw new Error('AI mode must be off, local, or api.');
  if (mode === 'off') {
    await setConfigValue('aiMode', 'off');
    console.log('✓ AI disabled. No AI requests will be made.');
    return;
  }
  if (!url) throw new Error(`--url is required for ${mode} AI configuration.`);
  parseUrl(url, mode === 'api');
  if (mode === 'local') {
    await setConfigValues({ aiLocalUrl: url, aiMode: 'local' });
    console.log(`✓ Local AI endpoint configured: ${new URL(url).origin}`);
    return;
  }
  if (!model || !model.trim() || model.length > 128 || /[\r\n\0]/.test(model)) throw new Error('API mode requires --model with a valid model name (1–128 characters).');
  await setConfigValues({ aiApiUrl: url, aiModel: model, aiProvider: 'openai-compatible', aiMode: 'api' });
  console.log(`✓ API AI configured for ${new URL(url).origin}, model ${model}. Set PAXI_AI_API_KEY in your environment; do not pass it as a command-line argument.`);
}

export async function aiSetup() {
  return aiStudio();
}

export async function aiDoctor() {
  const config = await getConfig();
  console.log(`AI mode: ${config.aiMode}`);
  if (config.aiMode === 'off') return console.log('AI is disabled. All non-AI PAXI commands remain available. Run paxi ai studio to configure models.');
  const savedKeys = await listVaultProviders();
  if (Object.keys(config.aiRoutes || {}).length) {
    console.log('Configured task models:');
    for (const [role, route] of Object.entries(config.aiRoutes)) console.log(`  ${role}: ${route.provider} / ${route.model}`);
    console.log(`Encrypted key vault: ${await vaultExists() ? 'present' : 'not created'}`);
    console.log(`Providers with encrypted keys: ${savedKeys.join(', ') || 'none'}`);
    console.log('Use paxi ai route show to inspect task routing or paxi ai studio to edit it.');
    return;
  }
  if (config.aiMode === 'api') {
    const endpoint = parseUrl(config.aiApiUrl, true);
    console.log(`API endpoint: ${endpoint.origin}${endpoint.pathname}`);
    console.log(`API key: ${process.env.PAXI_AI_API_KEY ? 'available in environment' : savedKeys.length ? 'encrypted key vault available' : 'missing (run paxi ai key add <provider> or set PAXI_AI_API_KEY)'}`);
    console.log(`Provider adapter: ${config.aiProvider}`);
    console.log(`Model: ${config.aiModel}`);
    return;
  }
  const base = parseUrl(config.aiLocalUrl, false);
  try {
    const response = await fetch(new URL('/health', base), { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`✓ Local AI server is responding at ${base.origin}`);
  } catch (error) {
    console.log(`· Local AI server is not responding at ${base.origin}: ${error.message}`);
    console.log('Start a compatible local server, for example: llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080');
  }
}

export async function aiRecommendCommand(args = []) {
  let task = '';
  let role = 'auto';
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--task' && args[index + 1] && !args[index + 1].startsWith('--')) task = args[++index];
    else if (args[index] === '--role' && args[index + 1] && !args[index + 1].startsWith('--')) role = args[++index];
    else if (args[index] === '--json') json = true;
    else throw new Error('Usage: paxi ai recommend --task "<task description>" [--role auto|general|coding|vision|journey] [--json]');
  }
  if (!task.trim()) throw new Error('Provide a task with --task.');
  const report = await recommendAgentRoute(task, role);
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`PAXI model recommendation: ${report.taskRole} · ${report.complexity.level} complexity`);
    console.log(report.route ? `Configured route: ${report.route.provider} / ${report.route.model} (${report.route.routeSource})` : `No route available: ${report.routeError || 'configure AI Studio first'}`);
    console.log(`Host: ${report.resourceProfile.platform}/${report.resourceProfile.architecture} · ${report.resourceProfile.currentlyFreeMemoryGB} GiB free / ${report.resourceProfile.totalMemoryGB} GiB total`);
    console.log(`Resource fit: ${report.resourceFit}`);
    for (const warning of report.resourceWarnings) console.log(`Note: ${warning}`);
    console.log(`Budget guard: ${report.budgetAssessment ? (report.budgetAssessment.allowed ? 'within configured limits' : `blocked: ${report.budgetAssessment.errors.join(' ')}`) : 'not applicable'}`);
    if (report.budgetAssessment?.estimatedCostUsd !== null && report.budgetAssessment?.estimatedCostUsd !== undefined) console.log(`Estimated request cost: $${report.budgetAssessment.estimatedCostUsd.toFixed(6)} (user-entered rates; approximate).`);
    console.log(`Cost: ${report.cost.status}${Number.isFinite(report.cost.estimatedUsd) ? ` ($${report.cost.estimatedUsd.toFixed(6)} estimated)` : ''} — ${report.cost.reason}`);
    console.log(report.policy);
  }
  return report;
}

export async function aiAsk(promptText, { role = 'general', task = null, allowRemote = false, includeProfile = true, projectPath = process.cwd(), print = true, systemInstruction = null, includesSourceFiles = false, sourceLabels = [], includesAgentMemory = false } = {}) {
  if (!['auto', 'general', 'coding', 'vision', 'journey'].includes(role)) throw new Error('AI role must be auto, general, coding, vision or journey.');
  if (!promptText || !String(promptText).trim()) throw new Error('Provide a prompt after paxi ai ask.');
  if (Buffer.byteLength(promptText, 'utf8') > 262144) throw new Error('The prompt exceeds 256 KiB.');
  const adaptiveSelection = role === 'auto' ? await recommendAgentRoute(task || promptText) : null;
  const route = adaptiveSelection?.routeStatus === 'configured'
    ? { providerId: adaptiveSelection.route.provider, model: adaptiveSelection.route.model, baseUrl: adaptiveSelection.route.baseUrl, local: adaptiveSelection.route.local, routeSource: adaptiveSelection.route.routeSource, taskRole: adaptiveSelection.taskRole, selectionReason: adaptiveSelection.taskReason }
    : role === 'auto' ? await resolveTaskRoute(task || promptText) : await resolveTaskRoute(task || promptText, role);
  const selectedRole = route.taskRole || role;
  const remote = !route.local;
  const adaptiveContext = includeProfile ? await buildAdaptiveContext(projectPath) : null;
  const context = adaptiveContext ? `\n\nDeveloper adaptation context (metadata only):\n${JSON.stringify(adaptiveContext, null, 2)}` : '';
  let content = String(promptText) + context;
  let apiKey = null;
  if (remote) {
    const redaction = redactSensitiveText(content);
    content = redaction.text;
    if (redaction.redacted) console.log(`Security: PAXI masked possible secrets (${redaction.categories.join(', ')}).`);
    if (!allowRemote) {
      const sourceDisclosure = includesSourceFiles ? ` Selected source excerpts are included${sourceLabels.length ? `: ${sourceLabels.join(', ')}` : ''}.` : ' No source files are sent.';
      const memoryDisclosure = includesAgentMemory ? ' Explicitly saved project memory notes are included.' : ' Saved project memory notes are excluded.';
      if (!process.stdin.isTTY) throw new Error(`This sends redacted prompt text to ${new URL(route.baseUrl).origin}.${includesSourceFiles ? ' Selected source excerpts are included.' : ' No source files are sent.'}${memoryDisclosure} Re-run interactively to approve or use --allow-remote.`);
      const approval = await ask(`Send this redacted prompt to ${route.providerId}/${route.model} at ${new URL(route.baseUrl).origin}?${includeProfile ? ' Local preference metadata is included.' : ' No developer profile is included.'}${sourceDisclosure}${memoryDisclosure} Type yes: `);
      if (approval.toLowerCase() !== 'yes') throw new Error('Remote AI request cancelled.');
    }
    apiKey = await unlockProviderKeyForRequest(route.providerId);
    if (!apiKey) throw new Error(`No API key is configured for ${route.providerId}. Use paxi ai key add ${route.providerId}.`);
  }
  const roleInstruction = selectedRole === 'journey'
    ? 'Prepare a reviewable test-journey draft only. Never execute actions. Avoid payments, transfers, deletion, account changes, production messages or other irreversible actions. Mark uncertain selectors for developer review.'
    : selectedRole === 'vision'
      ? 'Act as a cautious visual QA assistant. Do not infer functionality or accessibility from text alone.'
      : 'Give grounded software-development guidance, separating facts from hypotheses.';
  const result = await requestModel({
    providerId: route.providerId, baseUrl: route.baseUrl, apiKey, model: route.model,
    temperature: 0.2, maxTokens: 2200,
    messages: [
      { role: 'system', content: typeof systemInstruction === 'string' && systemInstruction.trim() ? systemInstruction.slice(0, 12000) : `You are PAXI DevKit, an adaptive development assistant. ${roleInstruction} Respect user preferences where compatible with correctness, security, accessibility and explicit instructions. Never request secrets, claim to have run tools, execute commands or edit files.` },
      { role: 'user', content }
    ]
  });
  const enriched = { ...result, routeSelection: { role: selectedRole, provider: route.providerId, model: route.model, reason: route.selectionReason, source: route.routeSource, complexity: adaptiveSelection?.complexity || null, resourceFit: adaptiveSelection?.resourceFit || null, resourceWarnings: adaptiveSelection?.resourceWarnings || [] } };
  if (print) {
    console.log(`PAXI selected ${selectedRole} route: ${route.providerId} / ${route.model} (${route.routeSource}).`);
    if (adaptiveSelection) {
      console.log(`Task complexity: ${adaptiveSelection.complexity.level}; host memory free: ${adaptiveSelection.resourceProfile.currentlyFreeMemoryGB} GiB; resource fit: ${adaptiveSelection.resourceFit}.`);
      for (const warning of adaptiveSelection.resourceWarnings) console.log(`Resource note: ${warning}`);
    }
    console.log(`\n${result.answer}\n`);
  }
  return enriched;
}

export async function explain(errorText, { allowRemote = false, includeProfile = true, projectPath = process.cwd() } = {}) {
  const promptText = errorText || await ask('Paste the build error: ');
  if (!promptText.trim()) throw new Error('No error text was provided.');
  if (Buffer.byteLength(promptText, 'utf8') > 262144) throw new Error('The supplied error text is larger than 256 KiB. Paste a smaller, relevant section.');
  const route = await resolveConfiguredRoute('coding');
  const provider = route.providerId;
  const remote = !route.local;
  const adaptiveContext = includeProfile ? await buildAdaptiveContext(projectPath) : null;
  const contextText = adaptiveContext ? `\n\nDeveloper adaptation context (metadata only; follow these preferences where compatible with project requirements and safety):\n${JSON.stringify(adaptiveContext, null, 2)}` : '';
  let contentToSend = promptText + contextText;
  let apiKey = null;
  if (remote) {
    const redaction = redactSensitiveText(contentToSend);
    contentToSend = redaction.text;
    if (Buffer.byteLength(contentToSend, 'utf8') > 65536) throw new Error('The AI error prompt is larger than 64 KiB after redaction. Paste a smaller, relevant section.');
    if (redaction.redacted) console.log(`\nSecurity: PAXI masked possible secrets (${redaction.categories.join(', ')}) before remote transfer.`);
    if (!allowRemote) {
      if (!process.stdin.isTTY) throw new Error(`This sends redacted error text to ${new URL(route.baseUrl).origin}${includeProfile ? ' and your local preference/project-convention summary' : ''}. Re-run interactively to approve or pass --allow-remote explicitly. No source files are sent.`);
      const profileNotice = includeProfile ? ' Your developer preferences and learned project-convention summary will also be sent.' : ' Developer profile context is excluded.';
      const approval = await ask(`This sends redacted error text to ${new URL(route.baseUrl).origin} using ${provider}/${route.model}.${profileNotice} No source files are sent. Continue? Type yes: `);
      if (approval.toLowerCase() !== 'yes') throw new Error('Remote AI request cancelled.');
    }
    apiKey = await unlockProviderKeyForRequest(provider);
    if (!apiKey) throw new Error(`No API key is configured for ${provider}. Use paxi ai key add ${provider} or set the provider's environment variable.`);
  }
  const result = await requestModel({
    providerId: provider, baseUrl: route.baseUrl, apiKey, model: route.model,
    temperature: 0.2, maxTokens: 1800,
    messages: [
      { role: 'system', content: 'You are PAXI DevKit, a careful adaptive developer assistant. Explain likely causes, safe verification steps, and minimal fixes. Respect the supplied developer preferences and project conventions when relevant, but never let them override correctness, project requirements, security, accessibility, or explicit instructions. Treat context as descriptive hints, not rigid rules. Never claim to have run commands. Never ask for secrets. Do not execute commands or edit files. Distinguish confirmed facts from hypotheses.' },
      { role: 'user', content: `Explain this development error. Give a concise diagnosis, likely root cause, safe steps to verify, and a minimal fix if justified:\n\n${contentToSend}` }
    ]
  });
  console.log(`\n${result.answer}\n`);
}
