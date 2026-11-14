import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { diagnoseProject } from './diagnosis.mjs';
import { listProjectMemory } from './agent-memory.mjs';
import { buildAdaptiveContext } from './adaptive-context.mjs';
import { recommendAgentRoute } from '../ai/agent-selector.mjs';
import { analyzeProjectArchitecture } from './project-architecture.mjs';
import { summarizeAgentFeedback } from './agent-feedback.mjs';
import { listVerifiedFixes } from './verified-fixes.mjs';

function priorityOf(finding) {
  if (finding.severity === 'critical' || finding.severity === 'error') return 0;
  if (finding.severity === 'high' || finding.severity === 'warning') return 1;
  return 2;
}

function makeVerificationPlan(diagnosis, architecture, feedback) {
  const steps = [];
  const findings = [...diagnosis.findings].sort((a, b) => priorityOf(a) - priorityOf(b));
  for (const finding of findings.slice(0, 8)) {
    steps.push({
      id: `inspect-${finding.code}`,
      type: 'investigation',
      priority: priorityOf(finding) === 0 ? 'high' : priorityOf(finding) === 1 ? 'medium' : 'low',
      action: `Verify: ${finding.title}`,
      evidence: finding.evidence || 'Static inspection evidence',
      expected: 'Confirm whether the finding is reproducible before changing code.',
      requiresApproval: false
    });
  }
  if (diagnosis.testPlan) {
    steps.push({ id: 'run-detected-tests', type: 'test', priority: 'high', action: `Review and run: ${diagnosis.testPlan.command} ${(diagnosis.testPlan.args || []).join(' ')}`.trim(),
      evidence: diagnosis.testPlan.preview, expected: 'Obtain an actual test result and preserve the output.', requiresApproval: true });
  } else {
    steps.push({ id: 'define-test-command', type: 'test-design', priority: 'medium', action: 'Identify or add the project’s intended test runner.', evidence: 'No supported conventional test command was detected.', expected: 'Document a deterministic test command before automated verification.', requiresApproval: false });
  }
  const categories = diagnosis.project.categories || [];
  if ((architecture.architectureSignals.stateMarkers || []).length) steps.push({ id: 'verify-application-state-transitions', type: 'state-transition-testing', priority: 'medium', action: 'Map and test the application’s loading, success, error, retry, cancellation and offline state transitions.', evidence: architecture.architectureSignals.stateMarkers.map((item) => `${item.name}:${item.count}`).join(', '), expected: 'Confirm valid state transitions and capture reproducible failure states before patching.', requiresApproval: true });
  if ((architecture.architectureSignals.apiMarkers || []).length) steps.push({ id: 'verify-api-contract-to-ui-flow', type: 'cross-layer-testing', priority: 'medium', action: 'Trace at least one user action from UI event through API request to persisted/read-back state.', evidence: architecture.architectureSignals.apiMarkers.map((item) => `${item.name}:${item.count}`).join(', '), expected: 'Use a dedicated test environment, request correlation IDs and a read-only verification path; do not infer persistence from an HTTP success alone.', requiresApproval: true });
  if (architecture.graph.cycles.length) steps.push({ id: 'review-import-cycles', type: 'architecture', priority: 'medium', action: 'Review possible internal import cycles.', evidence: `${architecture.graph.cycles.length} possible cycle(s) detected by static import analysis.`, expected: 'Confirm whether cycles cause initialization or maintenance problems.', requiresApproval: false });
  if (architecture.architectureSignals.apiMarkers.length) steps.push({ id: 'api-contract-check', type: 'integration', priority: 'medium', action: 'Inspect the OpenAPI contract and generate a reviewed GET/HEAD regression smoke plan where a specification exists.', evidence: architecture.architectureSignals.apiMarkers.map((item) => `${item.name}:${item.count}`).join(', '), expected: 'Review generated routes, configure a test base URL, then execute only after explicit confirmation against a dedicated test environment.', requiresApproval: true });
  if (architecture.architectureSignals.stateMarkers.length) steps.push({ id: 'state-transition-check', type: 'state-analysis', priority: 'medium', action: 'Review state transitions, retries, cancellation and offline recovery.', evidence: architecture.architectureSignals.stateMarkers.map((item) => `${item.name}:${item.count}`).join(', '), expected: 'Document valid transitions and verify that loading/error/success states cannot become stuck.', requiresApproval: true });
  if (architecture.inventory.manifests.length) steps.push({ id: 'dependency-manifest-review', type: 'dependencies', priority: 'low', action: 'Review dependency manifests and lockfile consistency.', evidence: architecture.inventory.manifests.join(', '), expected: 'Confirm package manager consistency and review direct dependencies before upgrading.', requiresApproval: false });
  for (const [area, summary] of Object.entries(feedback.areas)) {
    if (summary.reviewBias === 'extra-human-review' && ['plan','diagnosis','testing','patch'].includes(area)) {
      for (const step of steps) { if ((area === 'plan' && ['investigation','test-design'].includes(step.type)) || (area === 'testing' && ['test','compatibility','mobile-qa'].includes(step.type)) || (area === 'diagnosis' && step.type === 'investigation') || (area === 'patch' && step.type === 'patch')) step.feedbackNote = `Prior feedback in ${area} requests additional human review.`; }
    }
  }
  if (categories.includes('website')) steps.push({ id: 'browser-device-lab', type: 'compatibility', priority: 'medium', action: 'Run the website Device Lab at compact, standard and tablet viewports.', evidence: 'Website category detected.', expected: 'Collect browser screenshots, console output and responsive-layout findings.', requiresApproval: true });
  if (categories.includes('mobile') || diagnosis.project.frameworks?.some((name) => /Flutter|React Native|Expo/i.test(name))) steps.push({ id: 'android-user-journey', type: 'mobile-qa', priority: 'medium', action: 'Run a reviewed Android journey on a dedicated test app/device.', evidence: 'Mobile project markers detected.', expected: 'Capture step evidence and crash/ANR signals.', requiresApproval: true });
  if (categories.includes('smart-contract')) steps.push({ id: 'contract-review', type: 'security', priority: 'high', action: 'Run static contract checks and arrange independent security review.', evidence: 'Smart-contract markers detected.', expected: 'Record compiler/test findings and independent review scope; do not treat automated checks as an audit.', requiresApproval: true });
  return steps;
}

export async function buildAgentPlan({ projectPath = process.cwd(), logPath = null } = {}) {
  const root = path.resolve(projectPath);
  const diagnosis = await diagnoseProject({ projectPath: root, logPath });
  const [memory, adaptive, architecture, feedback, verifiedFixes] = await Promise.all([listProjectMemory(root), buildAdaptiveContext(root), analyzeProjectArchitecture(root), summarizeAgentFeedback(root), listVerifiedFixes(root)]);
  const taskDescription = `Create an engineering verification plan for ${diagnosis.project.name}. Technologies: ${(diagnosis.project.languages || []).join(', ')}. Findings: ${diagnosis.findings.map((item) => item.title).join('; ')}`;
  const routeRecommendation = await recommendAgentRoute(taskDescription, 'auto').catch((error) => ({ routeStatus: 'unavailable', routeError: error.message, taskRole: 'general', complexity: { level: 'medium', reason: 'Agent plan default because AI route selection was unavailable.' }, resourceWarnings: [], cost: { status: 'not-estimated', reason: 'AI route unavailable.' } }));
  const steps = makeVerificationPlan(diagnosis, architecture, feedback);
  const currentVerified = verifiedFixes.records.filter((item) => item.freshness === 'source-snapshot-unchanged');
  const staleVerified = verifiedFixes.records.filter((item) => item.freshness !== 'source-snapshot-unchanged');
  if (currentVerified.length) steps.unshift({ id: 'reuse-verified-regression-knowledge', type: 'regression-learning', priority: 'medium', action: 'Review previously verified regression knowledge before changing related code.', evidence: `${currentVerified.length} saved API regression record(s) still match their selected source-file fingerprints.`, expected: 'Reuse the documented correction carefully and rerun the linked regression checks; source fingerprints do not prove the whole project is unchanged.', requiresApproval: false });
  if (staleVerified.length) steps.push({ id: 'refresh-stale-regression-knowledge', type: 'regression-learning', priority: 'low', action: 'Revalidate saved regression knowledge whose source files have changed.', evidence: `${staleVerified.length} saved record(s) reference files that changed or are no longer present.`, expected: 'Rerun the relevant regression cases before relying on these historical corrections.', requiresApproval: true });
  const notes = memory.notes.map(({ id, text, createdAt }) => ({ id, text, createdAt }));
  return {
    schemaVersion: 1,
    planId: `agent-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    project: { name: diagnosis.project.name, root, languages: diagnosis.project.languages, frameworks: diagnosis.project.frameworks, categories: diagnosis.project.categories },
    diagnosis: { summary: diagnosis.summary, findings: diagnosis.findings, evidence: diagnosis.evidence, limitations: diagnosis.limitations },
    architecture: { inventory: architecture.inventory, entrypoints: architecture.entrypoints, graph: { nodeCount: architecture.graph.nodeCount, edgeCount: architecture.graph.edgeCount, highFanIn: architecture.graph.highFanIn, highFanOut: architecture.graph.highFanOut, cycles: architecture.graph.cycles, unresolvedRelative: architecture.graph.unresolvedRelative }, architectureSignals: architecture.architectureSignals, findings: architecture.findings, limitations: architecture.limitations },
    feedbackAdaptation: feedback,
    adaptiveContext: { developerPreferences: adaptive.developerPreferences, projectConventions: adaptive.projectConventions, privacy: adaptive.privacy },
    projectMemory: { count: notes.length, notes, storage: 'local-only; notes were entered explicitly by the developer' },
    verifiedKnowledge: { count: verifiedFixes.count, current: currentVerified.length, stale: staleVerified.length, records: verifiedFixes.records.map(({ id, summary, createdAt, freshness, evidence, files }) => ({ id, summary, createdAt, freshness, evidence, files: files.map((item) => ({ path: item.path, sha256: item.sha256.slice(0, 16) })) })), storage: 'local-only; linked to passing PAXI API regression reports and file fingerprints' },
    modelRecommendation: routeRecommendation,
    steps,
    execution: { status: 'plan-only', executedSteps: 0, testsRun: false, filesChanged: false },
    safeguards: [
      'The Agent Engine only prepared this plan; no project script, build, test, browser session or Android action was executed.',
      'Test commands and device/browser runs require a separate explicit confirmation.',
      'AI output is advisory. Any source patch must go through the separate review and --confirm application workflow.',
      'Saved project notes are local metadata; inspect and remove them with `paxi doctor agent memory` commands.'
    ]
  };
}
