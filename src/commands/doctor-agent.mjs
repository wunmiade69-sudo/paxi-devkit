import path from 'node:path';
import { getHostResourceProfile, recommendAgentRoute } from '../ai/agent-selector.mjs';
import { buildAgentPlan } from '../doctor/agent-engine.mjs';
import { clearProjectMemory, forgetProjectNote, listProjectMemory, rememberProjectNote } from '../doctor/agent-memory.mjs';
import { analyzeScreenshot } from '../doctor/vision.mjs';
import { aiAsk } from './ai.mjs';
import { analyzeProjectArchitecture } from '../doctor/project-architecture.mjs';
import { clearAgentFeedback, listAgentFeedback, recordAgentFeedback, summarizeAgentFeedback } from '../doctor/agent-feedback.mjs';
import { analyzeCrossLayerEvidence } from '../doctor/cross-layer-correlation.mjs';
import { clearVerifiedFixes, listVerifiedFixes, recordVerifiedFix } from '../doctor/verified-fixes.mjs';

function printJson(value) { console.log(JSON.stringify(value, null, 2)); }

async function memoryCommand(args = []) {
  const [action, ...rest] = args;
  let projectPath = process.cwd();
  const filtered = [];
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectPath = rest[++index];
    else filtered.push(rest[index]);
  }
  if (!action || action === 'show') {
    if (filtered.length) throw new Error('Usage: paxi doctor agent memory show [--project <dir>]');
    const result = await listProjectMemory(projectPath);
    console.log(`Project memory: ${result.projectName} · ${result.notes.length} saved notes · ${result.storage}`);
    for (const note of result.notes) console.log(`\n${note.id}\n${note.text}\n${note.createdAt || ''}`);
    if (!result.notes.length) console.log('No notes saved. Add one with `paxi doctor agent memory remember --note "..."`.');
    console.log('Only notes entered explicitly by you are stored. Source files are not stored.');
    return result;
  }
  if (action === 'remember') {
    let note = '';
    for (let index = 0; index < filtered.length; index += 1) {
      if (filtered[index] === '--note' && filtered[index + 1] && !filtered[index + 1].startsWith('--')) note = filtered[++index];
      else throw new Error('Usage: paxi doctor agent memory remember --note "project-specific decision or preference" [--project <dir>]');
    }
    if (!note) throw new Error('Supply a note using --note. Do not include passwords, API keys or private customer data.');
    const result = await rememberProjectNote(projectPath, note);
    console.log(`✓ Saved a local project note (${result.note.id}).${result.redacted ? ` Sensitive patterns redacted: ${result.redactionCategories.join(', ')}.` : ''}`);
    return result;
  }
  if (action === 'forget') {
    if (filtered.length !== 1) throw new Error('Usage: paxi doctor agent memory forget <note-id> [--project <dir>]');
    const result = await forgetProjectNote(projectPath, filtered[0]);
    console.log(result.removed ? '✓ Project memory note removed.' : 'No matching note was found.');
    return result;
  }
  if (action === 'clear') {
    if (filtered.length !== 1 || filtered[0] !== '--confirm') throw new Error('Clearing project memory requires `paxi doctor agent memory clear --confirm`.');
    const result = await clearProjectMemory(projectPath);
    console.log(`✓ Removed ${result.removed} saved project note(s).`);
    return result;
  }
  if (action === 'verified') {
    if (filtered.length) throw new Error('Usage: paxi doctor agent memory verified [--project <dir>]');
    const result = await listVerifiedFixes(projectPath);
    console.log(`Verified regression knowledge: ${result.count} record(s) · local-only`);
    for (const item of result.records) console.log(`\n${item.id} · ${item.freshness}\n${item.summary}\nEvidence: ${(item.evidence?.reports || []).map((e) => `${e.type}:${e.passed}/${e.total}`).join(', ') || `${item.evidence?.passed ?? 0}/${item.evidence?.total ?? 0} checks`}`);
    if (!result.count) console.log('No verified regression knowledge yet. Save fully passing API, browser-viewport and/or physical Android journey evidence with `memory learn-verified`.');
    return result;
  }
  if (action === 'learn-verified') {
    const evidencePaths = []; let summary = ''; let confirm = false; const files = [];
    for (let index = 0; index < filtered.length; index += 1) {
      const arg = filtered[index];
      if (arg === '--evidence' && filtered[index + 1] && !filtered[index + 1].startsWith('--')) evidencePaths.push(filtered[++index]);
      else if (arg === '--summary' && filtered[index + 1] && !filtered[index + 1].startsWith('--')) summary = filtered[++index];
      else if (arg === '--file' && filtered[index + 1] && !filtered[index + 1].startsWith('--')) files.push(filtered[++index]);
      else if (arg === '--confirm') confirm = true;
      else throw new Error('Usage: paxi doctor agent memory learn-verified --evidence <passing-api|website|physical-android-report.json> [--evidence <additional-report.json> ...] --summary "verified correction" --file <project-relative-file> [--file <file> ...] --confirm [--project <dir>]');
    }
    const result = await recordVerifiedFix({ projectPath, evidencePaths, summary, files, confirm });
    console.log(`✓ Saved verified regression knowledge locally (${result.record.id}). ${result.verification}.`);
    if (result.redacted) console.log(`Sensitive patterns redacted: ${result.redactionCategories.join(', ')}.`);
    return result;
  }
  if (action === 'clear-verified') {
    if (filtered.length !== 1 || filtered[0] !== '--confirm') throw new Error('Clearing verified regression knowledge requires `paxi doctor agent memory clear-verified --confirm`.');
    const result = await clearVerifiedFixes(projectPath);
    console.log(`✓ Removed ${result.removed} verified regression record(s).`);
    return result;
  }
  throw new Error('Usage: paxi doctor agent memory <show|remember|forget|clear|verified|learn-verified|clear-verified> [options]');
}

async function architectureCommand(args = []) {
  let projectPath = process.cwd();
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--project' && args[index + 1] && !args[index + 1].startsWith('--')) projectPath = args[++index];
    else if (args[index] === '--json') json = true;
    else throw new Error('Usage: paxi doctor agent architecture [--project <dir>] [--json]');
  }
  const report = await analyzeProjectArchitecture(projectPath);
  if (json) printJson(report);
  else {
    console.log(`Project architecture: ${report.project.name}`);
    console.log(`Files: ${report.inventory.filesAnalyzed} · internal import edges: ${report.graph.edgeCount} · entrypoints: ${report.entrypoints.length}`);
    console.log(`API signals: ${report.architectureSignals.apiMarkers.map((item) => `${item.name} (${item.count})`).join(', ') || 'none detected'}`);
    console.log(`State signals: ${report.architectureSignals.stateMarkers.map((item) => `${item.name} (${item.count})`).join(', ') || 'none detected'}`);
    console.log(`Cycles: ${report.graph.cycles.length} · unresolved relative imports: ${report.graph.unresolvedRelative.length}`);
    for (const finding of report.findings) console.log(`\n[${finding.severity}] ${finding.code}: ${finding.recommendation}`);
    console.log('\nStatic analysis only: no project scripts were executed and no source files were changed.');
  }
  return report;
}

async function feedbackCommand(args = []) {
  const [action, ...rest] = args;
  let projectPath = process.cwd();
  const options = [];
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectPath = rest[++index];
    else options.push(rest[index]);
  }
  if (!action || action === 'show') {
    if (options.length) throw new Error('Usage: paxi doctor agent feedback show [--project <dir>]');
    const result = await listAgentFeedback(projectPath);
    const summary = await summarizeAgentFeedback(projectPath);
    console.log(JSON.stringify({ project: result.projectName, events: result.events, summary }, null, 2));
    return { ...result, summary };
  }
  if (action === 'record') {
    let decision = ''; let area = 'general'; let note = '';
    for (let index = 0; index < options.length; index += 1) {
      if (options[index] === '--decision' && options[index + 1]) decision = options[++index];
      else if (options[index] === '--area' && options[index + 1]) area = options[++index];
      else if (options[index] === '--note' && options[index + 1]) note = options[++index];
      else throw new Error('Usage: paxi doctor agent feedback record --decision accepted|rejected|modified [--area plan|diagnosis|model|patch|visual|testing|general] [--note "brief correction"] [--project <dir>]');
    }
    const result = await recordAgentFeedback(projectPath, { decision, area, note });
    console.log(`✓ Recorded ${decision} feedback for ${area} locally.${result.redacted ? ` Sensitive patterns redacted: ${result.redactionCategories.join(', ')}.` : ''}`);
    return result;
  }
  if (action === 'clear') {
    if (options.length !== 1 || options[0] !== '--confirm') throw new Error('Clearing feedback requires `paxi doctor agent feedback clear --confirm`.');
    const result = await clearAgentFeedback(projectPath);
    console.log(`✓ Removed ${result.removed} feedback record(s).`);
    return result;
  }
  throw new Error('Usage: paxi doctor agent feedback <show|record|clear>');
}

export async function doctorAgentCommand(args = []) {
  const [action, ...rest] = args;
  if (action === 'memory') return memoryCommand(rest);
  if (action === 'architecture') return architectureCommand(rest);
  if (action === 'feedback') return feedbackCommand(rest);
  if (action === 'status') {
    if (rest.length) throw new Error('Usage: paxi doctor agent status');
    const resources = getHostResourceProfile();
    const memory = await listProjectMemory(process.cwd());
    const report = { engine: 'PAXI Agent Engine', status: 'ready-for-planning', resources, projectMemory: { notes: memory.notes.length, storage: memory.storage }, autonomy: 'plan-and-recommend only; tests, device actions, provider transfers and code changes require separate confirmations' };
    printJson(report);
    return report;
  }
  if (action !== 'plan') throw new Error('Usage: paxi doctor agent <status|plan|memory|architecture|feedback>');

  let projectPath = process.cwd();
  let logPath = null;
  let screenshotPath = null;
  let useAi = false;
  let allowRemote = false;
  let includeProfile = true;
  let includeMemory = true;
  let json = false;
  const evidencePaths = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectPath = rest[++index];
    else if (arg === '--log' && rest[index + 1] && !rest[index + 1].startsWith('--')) logPath = rest[++index];
    else if (arg === '--screenshot' && rest[index + 1] && !rest[index + 1].startsWith('--')) screenshotPath = rest[++index];
    else if (arg === '--ai') useAi = true;
    else if (arg === '--allow-remote') allowRemote = true;
    else if (arg === '--no-profile') includeProfile = false;
    else if (arg === '--no-memory') includeMemory = false;
    else if (arg === '--evidence' && rest[index + 1] && !rest[index + 1].startsWith('--')) evidencePaths.push(rest[++index]);
    else if (arg === '--json') json = true;
    else throw new Error('Usage: paxi doctor agent plan [--project <dir>] [--log <file>] [--screenshot <image>] [--evidence <report.json> ...] [--ai] [--allow-remote] [--no-profile] [--no-memory] [--json]');
  }
  const plan = await buildAgentPlan({ projectPath, logPath });
  if (evidencePaths.length) {
    plan.crossLayerEvidence = await analyzeCrossLayerEvidence({ reportPaths: evidencePaths });
    if (plan.crossLayerEvidence.evidenceCoverage?.status === 'partial') {
      const recommendations = (plan.crossLayerEvidence.evidenceCoverage.recommendations || []).slice(0, 5);
      if (recommendations.length) plan.steps.unshift({
        id: 'collect-missing-cross-layer-evidence', type: 'evidence-completion', priority: 'high',
        action: 'Collect missing evidence before assigning a root cause.',
        evidence: recommendations.join(' '),
        expected: 'Add the missing observability/browser/device evidence and rerun correlation. Do not interpret missing telemetry as proof that a layer is healthy.',
        requiresApproval: true
      });
    }
    for (const candidate of (plan.crossLayerEvidence.rootCauseCandidates || []).slice(0, 5)) {
      plan.steps.unshift({ id: `investigate-${candidate.id}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80), type: 'root-cause-investigation', priority: candidate.confidence === 'high' ? 'high' : 'medium', action: `Investigate candidate: ${candidate.candidate}`, evidence: JSON.stringify(candidate.evidence || {}).slice(0, 700), expected: 'Verify trace ancestry, timing, relevant source code and a repeatable failing test before assigning root cause.', requiresApproval: false });
    }
    const failedLayers = [...new Set(plan.crossLayerEvidence.events.filter((item) => item.status === 'failed').map((item) => item.sourceType))];
    const caseRecommendations = (plan.crossLayerEvidence.investigationCases || []).flatMap((item) => (item.missingEvidence || []).map((missing) => ({ ...missing, caseId: item.id, layers: item.layers }))).slice(0, 8);
    for (const recommendation of caseRecommendations) {
      const id = `evidence-${recommendation.id}-${recommendation.caseId}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
      if (plan.steps.some((item) => item.id === id)) continue;
      plan.steps.push({ id, type: 'evidence-collection', priority: recommendation.priority || 'medium', action: recommendation.recommendation, evidence: `Investigation case ${recommendation.caseId} spans ${(recommendation.layers || []).join(', ')}.`, expected: 'Collect only the missing evidence needed to narrow the hypothesis; preserve the source run type and do not claim causation from correlation.', requiresApproval: true });
    }
    if (failedLayers.includes('website')) plan.steps.push({ id: 'draft-website-regression', type: 'regression-design', priority: 'medium', action: 'Draft same-origin browser route regressions for the failed website evidence.', evidence: 'Website-layer failures were present in the supplied correlation reports.', expected: 'Review routes, add feature-specific assertions and execute only against a test site; viewport runs are simulations.', requiresApproval: true });
    if (failedLayers.includes('android-journey')) plan.steps.push({ id: 'draft-android-regression', type: 'regression-design', priority: 'medium', action: 'Create an Android journey regression with a selector-specific assertion for the failed flow.', evidence: 'Android journey failure evidence was present in the supplied reports.', expected: 'Inspect the original UI hierarchy/screenshots, add an explicit selector assertion, then run on an authorized test device.', requiresApproval: true });
  }
  if (screenshotPath) {
    const visual = await analyzeScreenshot(screenshotPath, {
      projectPath,
      includeProfile,
      allowRemote,
      contextSummary: JSON.stringify({ project: { name: plan.project.name, languages: plan.project.languages, frameworks: plan.project.frameworks, categories: plan.project.categories }, diagnosis: plan.diagnosis.summary, findings: plan.diagnosis.findings.slice(0, 8).map(({ code, severity, title, evidence }) => ({ code, severity, title, evidence })) })
    });
    plan.visualReview = visual;
  }
  if (useAi) {
    const context = {
      project: { name: plan.project.name, languages: plan.project.languages, frameworks: plan.project.frameworks, categories: plan.project.categories },
      diagnosis: plan.diagnosis,
      architecture: plan.architecture,
      feedbackAdaptation: plan.feedbackAdaptation,
      modelRecommendation: plan.modelRecommendation,
      proposedSteps: plan.steps,
      projectMemory: includeMemory ? plan.projectMemory.notes : [],
      verifiedKnowledge: includeMemory ? plan.verifiedKnowledge : { count: 0, excluded: true },
      visualReview: plan.visualReview ? { provider: plan.visualReview.provider, model: plan.visualReview.model, analysis: plan.visualReview.analysis } : null,
      crossLayerEvidence: plan.crossLayerEvidence || null
    };
    const result = await aiAsk(
      `Act as the PAXI Agent Engine. Review this project diagnosis and proposed verification plan. Improve ordering and recommend only bounded, reversible next steps. Do not claim to run tests, builds, browser sessions or device actions. Do not generate a patch in this response. Separate confirmed evidence from hypotheses and identify missing evidence. Treat exact trace IDs as context links, route-only grouping as weak evidence, browser runs as simulations, and physical-device results as a separate assurance class.\n\n${JSON.stringify(context, null, 2)}`,
      { role: 'auto', task: 'Plan engineering QA and root-cause investigation for this project', allowRemote, includeProfile, projectPath, print: false, includesAgentMemory: includeMemory && plan.projectMemory.notes.length > 0 }
    );
    plan.aiReview = { routeSelection: result.routeSelection, answer: result.answer };
  }
  if (json) printJson(plan);
  else {
    console.log(`PAXI Agent plan: ${plan.project.name}`);
    console.log(`Technologies: ${plan.project.languages.join(', ') || 'not identified'} · ${plan.project.frameworks.join(', ') || 'no framework marker'}`);
    console.log(`Diagnosis: ${plan.diagnosis.summary.findings} findings (${plan.diagnosis.summary.errors} errors, ${plan.diagnosis.summary.warnings} warnings) · ${plan.diagnosis.summary.confidence}`);
    console.log(`Architecture: ${plan.architecture.inventory.filesAnalyzed} files · ${plan.architecture.graph.edgeCount} internal links · ${plan.architecture.graph.cycles.length} possible cycles`);
    console.log(`Feedback history: ${plan.feedbackAdaptation.total} explicit feedback event(s) · stored locally`);
    console.log(`Project memory: ${plan.projectMemory.count} saved note(s) · ${includeMemory ? 'available to plan' : 'excluded from AI review'}`);
    console.log(`Verified regression knowledge: ${plan.verifiedKnowledge.current} current · ${plan.verifiedKnowledge.stale} stale · ${includeMemory ? 'available to plan' : 'excluded from AI review'}`);
    console.log(`Model route: ${plan.modelRecommendation.route ? `${plan.modelRecommendation.route.provider}/${plan.modelRecommendation.route.model}` : 'not configured'}`);
    console.log('\nRecommended verification steps:');
    for (const [index, step] of plan.steps.entries()) console.log(`${index + 1}. [${step.priority}] ${step.action}${step.requiresApproval ? ' (confirmation required)' : ''}`);
    if (plan.crossLayerEvidence) console.log(`\nCross-layer evidence: ${plan.crossLayerEvidence.summary.events} event(s) across ${plan.crossLayerEvidence.summary.layers.join(', ')} · ${plan.crossLayerEvidence.summary.correlations} correlations · ${(plan.crossLayerEvidence.rootCauseCandidates || []).length} ranked investigation hypotheses.`);
    if (plan.visualReview) console.log(`\nVisual review: ${plan.visualReview.provider}/${plan.visualReview.model}\n${plan.visualReview.analysis}`);
    if (plan.aiReview) console.log(`\nAgent review (${plan.aiReview.routeSelection.provider}/${plan.aiReview.routeSelection.model}):\n${plan.aiReview.answer}`);
    console.log('\nPlan only: no project scripts or tests were run and no source files were changed.');
  }
  return plan;
}
