import fs from 'node:fs/promises';
import path from 'node:path';
import { validateJourneyDefinition } from './android-journey.mjs';

const BLOCKED_INTENT = /\b(?:pay(?:ment)?|purchase|buy|sell|trade|swap|send|transfer|withdraw|deposit|delete|erase|remove|reset|restore|approve|authorize|sign transaction|checkout|place order|submit|log ?in|sign ?in|sign ?up|register|connect wallet|cancel subscription)\b/i;
const ACTIONS = /^(?:please\s+)?(?:tap|click|open|select|choose|navigate\s+to|go\s+to)\s+(?:the\s+)?(.+)$/i;
const ASSERTIONS = /^(?:please\s+)?(?:assert|verify|check|ensure|confirm)\s+(?:that\s+)?(?:the\s+)?(.+)$/i;

function cleanTarget(value) {
  let target = String(value || '').trim().replace(/^['"`]|['"`]$/g, '').trim();
  target = target.replace(/\s+(?:screen|page|tab|button|menu|section)(?:\s+(?:is|appears|becomes)?\s*(?:visible|shown|displayed|open))?$/i, '');
  target = target.replace(/\s+(?:is|appears|becomes)\s+(?:visible|shown|displayed|open)$/i, '');
  target = target.replace(/[.?!]+$/g, '').trim();
  target = target.replace(/^(?:the|a|an)\s+/i, '').trim();
  if (!target || target.length > 80 || /[\r\n\0]/.test(target)) return null;
  if (/\b(?:and then|then|after that|next|finally)\b/i.test(target)) return null;
  return target.charAt(0).toLocaleUpperCase() + target.slice(1);
}

function splitGoal(goal) {
  return goal.replace(/\s+/g, ' ').trim().split(/\s*(?:;|,|\band\s+then\b|\bafter that\b|\bfinally\b|\bthen\b|\band\s+(?=(?:tap|click|open|select|choose|navigate|go to|verify|assert|check|ensure|confirm|wait|capture|take)\b))\s*/i).map((part) => part.trim()).filter(Boolean);
}

export function draftJourneyFromGoal(goal, { name = null } = {}) {
  if (typeof goal !== 'string' || goal.trim().length < 8 || goal.length > 2000 || /[\0]/.test(goal)) throw new Error('Describe a test goal in 8–2000 characters.');
  if (BLOCKED_INTENT.test(goal)) throw new Error('This goal includes an action that may change data, move funds, authenticate, submit or authorize something. PAXI will not auto-generate those actions; write and review a dedicated test journey manually in a non-production test environment.');
  const parts = splitGoal(goal);
  const steps = [{ type: 'assertForeground' }];
  const unresolved = [];
  for (const part of parts) {
    const waitMatch = part.match(/^wait\s+(\d{1,2})\s*(ms|milliseconds?|seconds?|secs?)?$/i);
    if (waitMatch) {
      const amount = Number(waitMatch[1]);
      const unit = (waitMatch[2] || 'seconds').toLowerCase();
      const ms = unit.startsWith('ms') || unit.startsWith('millisecond') ? amount : amount * 1000;
      if (ms > 30000) throw new Error('A generated wait cannot exceed 30 seconds. Split longer pauses into separate reviewed steps.');
      steps.push({ type: 'wait', ms });
      continue;
    }
    if (/^(?:take|capture)\s+(?:a\s+)?screenshot$/i.test(part)) {
      steps.push({ type: 'screenshot', name: `goal-${steps.length + 1}` });
      continue;
    }
    const action = part.match(ACTIONS);
    if (action) {
      const target = cleanTarget(action[1]);
      if (!target) { unresolved.push(part); continue; }
      steps.push({ type: 'tap', selector: { text: target } }, { type: 'wait', ms: 800 });
      continue;
    }
    const assertion = part.match(ASSERTIONS);
    if (assertion) {
      const target = cleanTarget(assertion[1]);
      if (!target) { unresolved.push(part); continue; }
      steps.push({ type: 'assertVisible', selector: { text: target } });
      continue;
    }
    if (/^(?:launch|start|open)\s+(?:the\s+)?app$/i.test(part)) {
      steps.push({ type: 'assertForeground' });
      continue;
    }
    unresolved.push(part);
  }
  if (steps.length === 1) throw new Error(`I could not safely convert this goal into UI selectors. Try phrases such as "tap Settings, then verify About is visible". Unresolved instruction: ${unresolved.join(' | ').slice(0, 240)}`);
  if (!steps.some((step) => ['assertForeground', 'assertVisible', 'assertNotVisible'].includes(step.type))) steps.push({ type: 'assertForeground' });
  const inferredName = name || goal.slice(0, 68).replace(/\s+/g, ' ').trim();
  const journey = validateJourneyDefinition({
    schemaVersion: 1,
    name: inferredName,
    description: 'Draft generated from a plain-language goal. Review every selector and step before running.',
    steps
  });
  return {
    journey,
    reviewRequired: true,
    unresolvedInstructions: unresolved,
    assumptions: [
      'Navigation labels are interpreted as exact accessible UI text selectors; verify each label on the target app.',
      'No text entry, authentication, data submission, purchases, payments, wallet actions, destructive actions or permission grants are generated.',
      'This deterministic draft is not proof that the described flow is complete or correct.'
    ]
  };
}

export async function writeJourneyDraft(goal, outputPath, options = {}) {
  if (!outputPath || typeof outputPath !== 'string') throw new Error('A destination path is required with --output.');
  const draft = draftJourneyFromGoal(goal, options);
  const resolved = path.resolve(outputPath);
  const parent = path.dirname(resolved);
  const parentStat = await fs.lstat(parent).catch(() => null);
  if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) throw new Error('Journey draft destination directory must already exist and must not be a symbolic link.');
  const contents = `${JSON.stringify(draft.journey, null, 2)}\n`;
  const handle = await fs.open(resolved, 'wx', 0o600).catch((error) => {
    if (error.code === 'EEXIST') throw new Error('Journey draft output already exists. Choose a new filename; PAXI will not overwrite it.');
    throw error;
  });
  try { await handle.writeFile(contents); } finally { await handle.close(); }
  return { ...draft, outputPath: resolved, bytes: Buffer.byteLength(contents) };
}
