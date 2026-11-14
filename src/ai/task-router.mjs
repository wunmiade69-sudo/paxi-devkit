import { getConfig } from '../lib/config.mjs';
import { AI_ROLES } from './providers.mjs';
import { resolveConfiguredRoute } from './studio.mjs';

const RULES = [
  { role: 'vision', pattern: /\b(?:screenshot|image|visual|layout|spacing|contrast|overflow|clipping|typography|visual regression)\b/i, reason: 'The task asks for visual or image analysis.' },
  { role: 'journey', pattern: /\b(?:user journey|test journey|navigation flow|tap path|screen flow|explore screens|test steps)\b/i, reason: 'The task asks for a user journey or navigation plan.' },
  { role: 'coding', pattern: /\b(?:bug|debug|diagnos|error|exception|stack trace|compiler|build fail|test fail|patch|fix|refactor|code review|typescript|gradle|cmake|dependency conflict|security audit|threat model|architecture review|root[- ]cause|race condition|cross[- ]platform|production incident|reentrancy)\b/i, reason: 'The task asks for code, architecture, security, debugging, build or test assistance.' }
];

export function inferTaskRole(task, preferredRole = 'auto') {
  if (preferredRole !== 'auto') {
    if (!AI_ROLES.includes(preferredRole)) throw new Error(`AI role must be auto or one of: ${AI_ROLES.join(', ')}.`);
    return { role: preferredRole, reason: 'An explicit task role was selected.' };
  }
  const text = String(task || '').slice(0, 12000);
  for (const rule of RULES) if (rule.pattern.test(text)) return { role: rule.role, reason: rule.reason };
  return { role: 'general', reason: 'No specialized task intent was detected; using the general model route.' };
}

export async function resolveTaskRoute(task, preferredRole = 'auto') {
  const decision = inferTaskRole(task, preferredRole);
  const route = await resolveConfiguredRoute(decision.role);
  const config = await getConfig();
  const exactRoleRoute = Boolean(config.aiRoutes?.[decision.role]);
  const generalFallback = !exactRoleRoute && Boolean(config.aiRoutes?.general) && decision.role !== 'general';
  return {
    ...route,
    taskRole: decision.role,
    selectionReason: decision.reason,
    routeSource: exactRoleRoute ? `${decision.role}-route` : generalFallback ? 'general-fallback' : 'legacy-or-default-route'
  };
}
