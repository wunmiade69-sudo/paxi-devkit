import os from 'node:os';
import { getConfig } from '../lib/config.mjs';
import { inferTaskRole, resolveTaskRoute } from './task-router.mjs';
import { previewAiBudget } from './budget.mjs';

function round(value) { return Math.round(value * 10) / 10; }

export function classifyTaskComplexity(taskText = '') {
  const text = String(taskText).slice(0, 20000);
  const bytes = Buffer.byteLength(text, 'utf8');
  const highSignals = /\b(?:architecture|security audit|threat model|cross[- ]platform|root[- ]cause|migration|re-?entrancy|race condition|distributed|multi[- ]module|major refactor|production incident)\b/i.test(text);
  const mediumSignals = /\b(?:debug|diagnos|compiler|build|test|dependency|integration|review|refactor|workflow|journey|screen)\b/i.test(text);
  if (highSignals || bytes > 8000) return { level: 'high', reason: highSignals ? 'The task contains architecture, security, cross-platform or multi-system signals.' : 'The task contains a large context payload.' };
  if (mediumSignals || bytes > 1200) return { level: 'medium', reason: mediumSignals ? 'The task requires technical investigation or multiple verification steps.' : 'The task contains more than a short request.' };
  return { level: 'low', reason: 'The task appears bounded and explanatory.' };
}

export function getHostResourceProfile() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    platform: process.platform,
    architecture: process.arch,
    cpuCores: Array.isArray(os.cpus()) ? os.cpus().length : null,
    totalMemoryGB: round(total / (1024 ** 3)),
    currentlyFreeMemoryGB: round(free / (1024 ** 3)),
    freeMemoryRatio: total > 0 ? round(free / total) : null,
    note: 'This is a host-level snapshot. It does not include all Android app limits, GPU/accelerator availability or model-specific context memory.'
  };
}

export async function recommendAgentRoute(taskText, preferredRole = 'auto', { resources = getHostResourceProfile() } = {}) {
  const intent = inferTaskRole(taskText, preferredRole);
  const complexity = classifyTaskComplexity(taskText);
  const config = await getConfig();
  let route = null;
  let routeError = null;
  try { route = await resolveTaskRoute(taskText, preferredRole); } catch (error) { routeError = error.message; }
  const local = Boolean(route?.local);
  const memoryGB = resources.currentlyFreeMemoryGB;
  const resourceWarnings = [];
  let resourceFit = 'not-assessed';
  if (!route) resourceFit = 'route-not-configured';
  else if (local) {
    resourceFit = 'unknown-model-requirements';
    if (Number.isFinite(memoryGB) && memoryGB < 1.5) {
      resourceFit = 'low-headroom';
      resourceWarnings.push('The host currently reports less than 1.5 GiB free memory. A local model may fail to load or have limited context headroom.');
    } else if (Number.isFinite(memoryGB) && memoryGB < 3.5) {
      resourceFit = 'watch-memory';
      resourceWarnings.push('The host reports limited free memory. Close other apps and check the model card before loading a larger model.');
    } else {
      resourceWarnings.push('Host memory looks less constrained, but PAXI cannot infer exact RAM/VRAM requirements from an arbitrary model ID.');
    }
  } else {
    resourceFit = 'device-memory-not-limiting-inference';
    resourceWarnings.push('Cloud inference needs a network connection and may incur provider charges. PAXI has no verified account-specific price data, so it does not invent a cost estimate.');
  }
  const budgetAssessment = route ? await previewAiBudget({ provider: route.providerId, model: route.model, messages: [{ role: 'user', content: String(taskText).slice(0, 12000) }], maxTokens: 2200, local }) : null;
  const configuredAlternatives = Object.entries(config.aiRoutes || {}).filter(([role, item]) => item && typeof item.provider === 'string' && typeof item.model === 'string' && !(role === intent.role && route?.providerId === item.provider && route?.model === item.model)).map(([role, item]) => ({ role, provider: item.provider, model: item.model }));
  return {
    schemaVersion: 1,
    taskRole: intent.role,
    taskReason: intent.reason,
    complexity,
    route: route ? { provider: route.providerId, model: route.model, baseUrl: route.baseUrl, local, routeSource: route.routeSource } : null,
    routeStatus: route ? 'configured' : 'unavailable',
    routeError,
    resourceProfile: resources,
    resourceFit,
    resourceWarnings,
    configuredAlternatives,
    budgetAssessment,
    cost: budgetAssessment?.estimatedCostUsd !== null && budgetAssessment?.estimatedCostUsd !== undefined
      ? { status: 'estimated', estimatedUsd: budgetAssessment.estimatedCostUsd, reason: 'Estimate uses approximate token counts and your manually configured provider rates; it is not a provider quote or invoice.' }
      : { status: 'not-estimated', reason: 'No matching user-configured model price is available. Configure one with `paxi ai budget price` to estimate costs.' },
    policy: 'PAXI uses the configured role route and reports resource/cost considerations. It does not silently switch providers, upload data or alter saved routes.'
  };
}
