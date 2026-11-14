import { getDoctorProfile, setDoctorPreference, setDoctorLearningMode, resetDoctorProfile, PROFILE_OPTIONS } from '../doctor/profile.mjs';
import { inspectProject, summarizeFindings } from '../doctor/project-inspect.mjs';
import { DEVICE_PROFILES, DEVICE_CONDITIONS, listLabPresets, saveLabPreset, deleteLabPreset, buildLabPlan } from '../doctor/device-lab.mjs';
import { learnProjectConventions, forgetLearnedProject, clearLearnedProjects } from '../doctor/learning.mjs';
import { runWebsiteDeviceLab } from '../doctor/website-lab.mjs';
import { cppToolchainReport, runConfirmedCMakeBuild } from '../doctor/cpp-toolchain.mjs';
import { runProcess, commandExists } from '../lib/process.mjs';
import { runAndroidDeviceLab, listAndroidDevices } from '../doctor/android-lab.mjs';
import { runAndroidJourney, journeyExample, loadJourneyFile } from '../doctor/android-journey.mjs';
import { writeJourneyDraft } from '../doctor/journey-draft.mjs';
import { analyzeScreenshot } from '../doctor/vision.mjs';
import { runAndroidSafeExploration } from '../doctor/android-explore.mjs';
import { compareLabRuns, listLabRuns } from '../doctor/lab-history.mjs';
import { reviewPatch, applyReviewedPatch } from '../doctor/patch-workflow.mjs';
import { diagnoseProject } from '../doctor/diagnosis.mjs';
import { detectProjectTestCommand, runProjectTests } from '../doctor/project-test-executor.mjs';
import { generateFixDraft } from '../doctor/fix-draft.mjs';
import { aiAsk } from './ai.mjs';
import { comparePngFiles } from '../doctor/visual-regression.mjs';
import { probeRuntimeEndpoint } from '../doctor/runtime-probe.mjs';
import { scanProjectSecurity, runNpmDependencyAudit } from '../doctor/security-scan.mjs';
import { inspectOpenApiContract, runApiSmokeTests, generateApiSmokePlan, writeGeneratedApiPlan, writeApiSmokeReport } from '../doctor/api-contract.mjs';
import { draftRegressionSuite } from '../doctor/regression-draft.mjs';
import { createTraceId, validateTraceId, inspectTraceLog } from '../doctor/trace-context.mjs';
import { inspectOtelSpans } from '../doctor/otel-spans.mjs';
import { analyzeCrossLayerEvidence } from '../doctor/cross-layer-correlation.mjs';
import { scanDatabaseMigrations } from '../doctor/database-migrations.mjs';
import { runDisposableSqliteMigrationLab } from '../doctor/database-lab.mjs';
import { runDisposableServiceMigrationLab } from '../doctor/database-service-lab.mjs';
import { validateSbomFile, evaluateSbomLicensePolicy } from '../doctor/sbom-policy.mjs';
import { validateSbomAgainstSchema } from '../doctor/sbom-schema.mjs';
import { runWebsiteAccessibilityAudit } from '../doctor/website-accessibility.mjs';
import { doctorAdvancedSecurityCommand } from '../doctor/security-advanced.mjs';
import { validateOtlpHttpExporter } from '../doctor/otel-export-check.mjs';
import { listNativeSecurityScanners, runNativeVulnerabilityScan, generateProjectSbom } from '../doctor/security-adapters.mjs';
import { listObservabilityPacks, getObservabilityPack, writeObservabilityPack } from '../doctor/observability-packs.mjs';
import { validateWebsiteJourney, loadWebsiteJourney, runWebsiteJourney, runWebsiteJourneyMatrix, websiteJourneyExample } from '../doctor/website-journey.mjs';
import { proposeAndroidSelectors, writeAndroidJourneyFromSelector } from '../doctor/android-selector-proposals.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function printJson(value) { console.log(JSON.stringify(value, null, 2)); }

export async function doctorProfileCommand(args = []) {
  const [action, ...rest] = args;
  if (!action || action === 'show') {
    if (rest.length) throw new Error('Usage: paxi doctor profile [show|set <key> <value>|learn [--project <dir>]|forget [--project <dir>]|clear-learning --confirm|learning <explicit|off>|reset --confirm]');
    const profile = await getDoctorProfile();
    console.log('PAXI Doctor developer profile');
    console.log(`Learning mode: ${profile.learningMode} (preferences are stored locally)`);
    for (const [key, value] of Object.entries(profile.preferences)) console.log(`  ${key}: ${Array.isArray(value) ? value.join(', ') || '(not set)' : value}`);
    console.log(`Learned project profiles: ${profile.learnedProjects?.length || 0} (stored locally; source code is not stored).`);
    console.log('Learning occurs only when you explicitly run `paxi doctor profile learn --project <dir>`.');
    return profile;
  }
  if (action === 'set') {
    if (rest.length < 2) throw new Error(`Usage: paxi doctor profile set <${Object.keys(PROFILE_OPTIONS).join('|')}> <value>`);
    const [key, ...valueParts] = rest;
    const profile = await setDoctorPreference(key, valueParts.join(' '));
    console.log(`✓ Saved local Doctor preference: ${key}.`);
    return profile;
  }
  if (action === 'learn') {
    let projectPath = process.cwd();
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectPath = rest[++index];
      else throw new Error('Usage: paxi doctor profile learn [--project <directory>]');
    }
    const learned = await learnProjectConventions(projectPath);
    console.log(`✓ Learned project conventions for ${learned.projectName} from ${learned.conventions.sampleFiles} source files. No source code was saved.`);
    return learned;
  }
  if (action === 'forget') {
    let projectPath = process.cwd();
    if (rest.length === 2 && rest[0] === '--project' && rest[1]) projectPath = rest[1];
    else if (rest.length) throw new Error('Usage: paxi doctor profile forget [--project <directory>]');
    const removed = await forgetLearnedProject(projectPath);
    console.log(removed ? '✓ Learned project profile removed.' : 'No learned profile was found for this project.');
    return { removed };
  }
  if (action === 'clear-learning') {
    if (rest.length !== 1 || rest[0] !== '--confirm') throw new Error('Clear all learned project profiles with: paxi doctor profile clear-learning --confirm');
    await clearLearnedProjects();
    console.log('✓ All learned project profiles cleared.');
    return { cleared: true };
  }
  if (action === 'learning') {
    if (rest.length !== 1) throw new Error('Usage: paxi doctor profile learning <explicit|off>');
    const profile = await setDoctorLearningMode(rest[0]);
    console.log(`✓ Doctor profile learning mode set to ${rest[0]}.`);
    return profile;
  }
  if (action === 'reset') {
    if (rest.length !== 1 || rest[0] !== '--confirm') throw new Error('Resetting the Doctor profile requires: paxi doctor profile reset --confirm');
    const profile = await resetDoctorProfile();
    console.log('✓ Developer preferences reset to defaults.');
    return profile;
  }
  throw new Error('Usage: paxi doctor profile [show|set <key> <value>|learn [--project <dir>]|forget [--project <dir>]|clear-learning --confirm|learning <explicit|off>|reset --confirm]');
}

export async function doctorInspectCommand(args = []) {
  let projectPath = process.cwd();
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--project' && args[index + 1] && !args[index + 1].startsWith('--')) projectPath = args[++index];
    else throw new Error('Usage: paxi doctor inspect [--project <directory>] [--json]');
  }
  const report = await inspectProject(projectPath);
  if (json) return printJson(report);
  console.log(`PAXI Doctor project inspection: ${report.project.name}`);
  console.log(`Root: ${report.project.root}`);
  console.log(`Primary existing DevKit detector: ${report.project.primaryFramework} (${report.project.detectionConfidence} confidence)`);
  console.log(`Technologies: ${report.technologies.languages.join(', ') || 'not identified'}`);
  console.log(`Frameworks: ${report.technologies.frameworks.join(', ') || 'none identified'}`);
  console.log(`Project types: ${report.technologies.categories.join(', ') || 'not determined'}`);
  console.log(`Files inspected: ${report.inventory.filesInspected}${report.inventory.truncated ? ' (scan limit reached)' : ''}`);
  const counts = summarizeFindings(report.findings);
  console.log(`Findings: ${report.findings.length} (${counts.warning || 0} warning, ${counts.info || 0} recommendation)`);
  for (const finding of report.findings) {
    console.log(`\n[${finding.severity.toUpperCase()}] ${finding.message}`);
    console.log(`  Recommendation: ${finding.recommendation}`);
  }
  console.log('\nRead-only inspection: no project scripts were executed and no source files were changed.');
  return report;
}


export async function doctorDiagnoseCommand(args = []) {
  let projectPath = process.cwd();
  let logPath = null;
  let useAi = false;
  let allowRemote = false;
  let includeProfile = true;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--ai') useAi = true;
    else if (arg === '--allow-remote') allowRemote = true;
    else if (arg === '--no-profile') includeProfile = false;
    else if (arg === '--json') json = true;
    else if (arg === '--project' && args[index + 1] && !args[index + 1].startsWith('--')) projectPath = args[++index];
    else if (arg === '--log' && args[index + 1] && !args[index + 1].startsWith('--')) logPath = args[++index];
    else throw new Error('Usage: paxi doctor diagnose [--project <dir>] [--log <sanitized-build.log>] [--ai] [--allow-remote] [--no-profile] [--json]');
  }
  const report = await diagnoseProject({ projectPath, logPath });
  if (useAi) {
    const context = {
      project: report.project,
      summary: report.summary,
      evidence: report.evidence,
      findings: report.findings,
      testPlan: report.testPlan ? { id: report.testPlan.id, preview: report.testPlan.preview } : null,
      limitations: report.limitations
    };
    const result = await aiAsk(
      `Diagnose this PAXI Doctor evidence report. Give the most likely causes ranked by confidence, cite the evidence codes/snippets, separate confirmed observations from hypotheses, and list the smallest safe verification steps before suggesting any code change. Do not claim tests or builds were executed.\n\n${JSON.stringify(context, null, 2)}`,
      { role: 'auto', task: 'diagnose build, test and compiler failures from evidence', allowRemote, includeProfile, projectPath, print: false }
    );
    report.aiAnalysis = { ...result.routeSelection, answer: result.answer };
  }
  if (json) printJson(report);
  else {
    console.log(`PAXI Doctor diagnosis: ${report.project.name}`);
    console.log(`Project: ${report.project.languages.join(', ') || 'technology not identified'} · ${report.project.frameworks.join(', ') || 'no framework marker'}`);
    console.log(`Findings: ${report.summary.findings} · Errors: ${report.summary.errors} · Warnings: ${report.summary.warnings} · Confidence: ${report.summary.confidence}`);
    if (report.evidence.logProvided) console.log(`Evidence log: ${report.evidence.logFileName} (${report.evidence.logBytes} bytes)${report.evidence.secretsRedacted ? ' · possible secrets redacted' : ''}`);
    if (report.testPlan) console.log(`Suggested tests: ${report.testPlan.preview}`);
    for (const finding of report.findings) {
      console.log(`\n[${finding.severity.toUpperCase()} · ${finding.confidence}] ${finding.code}: ${finding.title}`);
      if (finding.evidence) console.log(`  Evidence: ${finding.evidence}`);
      console.log(`  Next: ${finding.recommendation}`);
    }
    if (report.aiAnalysis) {
      console.log(`\nAI route: ${report.aiAnalysis.provider} / ${report.aiAnalysis.model} (${report.aiAnalysis.role})`);
      console.log(report.aiAnalysis.answer);
    }
    console.log('\nNo build/test command or source modification was performed by diagnose. Use `paxi doctor test --confirm` to run the detected test command.');
  }
  return report;
}

export async function doctorTestCommand(args = []) {
  let projectPath = process.cwd();
  let confirm = false;
  let timeoutMs = 15 * 60 * 1000;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--confirm') confirm = true;
    else if (arg === '--json') json = true;
    else if (arg === '--project' && args[index + 1] && !args[index + 1].startsWith('--')) projectPath = args[++index];
    else if (arg === '--timeout' && args[index + 1] && /^\d+$/.test(args[index + 1])) timeoutMs = Number(args[++index]) * 1000;
    else throw new Error('Usage: paxi doctor test [--project <dir>] [--confirm] [--timeout <seconds>] [--json]');
  }
  if (timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) throw new Error('--timeout must be 1–3600 seconds.');
  if (!confirm) {
    const plan = await detectProjectTestCommand(projectPath);
    const report = { executed: false, status: plan ? plan.available === false ? 'tool-missing' : 'planned-not-executed' : 'not-available', plan, note: 'No project code was executed. Running a detected test command requires --confirm because test scripts are project-controlled code.' };
    if (json) printJson(report);
    else console.log(`${report.status}: ${plan ? `${plan.command} ${plan.args.join(' ')} — ${plan.reason}` : 'No supported conventional test command detected.'}\nRun with --confirm only after reviewing the command.`);
    return report;
  }
  const report = await runProjectTests({ projectPath, confirm, timeoutMs });
  if (json) printJson(report);
  else {
    console.log(`PAXI Doctor test run: ${report.status.toUpperCase()}`);
    if (report.plan) console.log(`Command: ${report.plan.command} ${report.plan.args.join(' ')}`);
    if (report.durationMs !== undefined) console.log(`Duration: ${(report.durationMs / 1000).toFixed(1)} seconds`);
    if (report.output?.stdout) console.log(report.output.stdout.slice(-12000));
    if (report.output?.stderr) console.error(report.output.stderr.slice(-12000));
    if (report.note) console.log(report.note);
  }
  if (report.executed && !report.passed) process.exitCode = report.status === 'timed-out' ? 16 : 13;
  return report;
}

export async function doctorFixDraftCommand(args = []) {
  let projectPath = process.cwd();
  let description = null;
  let files = [];
  let allowRemote = false;
  let includeProfile = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--allow-remote') allowRemote = true;
    else if (arg === '--no-profile') includeProfile = false;
    else if (arg === '--with-profile') includeProfile = true;
    else if (arg === '--json') json = true;
    else if (arg === '--project' && args[index + 1] && !args[index + 1].startsWith('--')) projectPath = args[++index];
    else if (arg === '--description' && args[index + 1] && !args[index + 1].startsWith('--')) description = args[++index];
    else if (arg === '--files' && args[index + 1] && !args[index + 1].startsWith('--')) files = args[++index].split(',').map((item) => item.trim()).filter(Boolean);
    else throw new Error('Usage: paxi doctor patch draft --description "..." --files src/file.js,src/other.ts [--project <dir>] [--allow-remote] [--with-profile] [--json]');
  }
  if (!description || !files.length) throw new Error('Patch drafting requires --description and 1–8 exact paths in --files.');
  const report = await generateFixDraft({ projectPath, description, files, allowRemote, includeProfile });
  if (json) printJson(report);
  else {
    console.log('PAXI Doctor generated a patch draft.');
    console.log(`AI route: ${report.provider} / ${report.model} (${report.routeSelection.role})`);
    console.log(`Files: ${report.selectedFiles.map((item) => item.path).join(', ')}`);
    console.log(`Patch: ${report.patchFile}`);
    console.log(report.diffStat);
    console.log(report.note);
    for (const next of report.nextSteps) console.log(`  ${next}`);
  }
  return report;
}


export async function doctorCppCommand(args = []) {
  let projectPath = process.cwd();
  let json = false;
  let build = false;
  let confirm = false;
  let buildDir = null;
  let timeoutMs = 15 * 60 * 1000;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--build') build = true;
    else if (arg === '--confirm') confirm = true;
    else if (arg === '--project' && args[index + 1] && !args[index + 1].startsWith('--')) projectPath = args[++index];
    else if (arg === '--build-dir' && args[index + 1] && !args[index + 1].startsWith('--')) buildDir = args[++index];
    else if (arg === '--timeout' && args[index + 1] && /^\d+$/.test(args[index + 1])) timeoutMs = Number(args[++index]) * 1000;
    else throw new Error('Usage: paxi doctor cpp [--project <dir>] [--json] [--build --confirm] [--build-dir <dir>] [--timeout <seconds>]');
  }
  if (timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) throw new Error('--timeout must be 1–3600 seconds.');
  const preflight = await cppToolchainReport(projectPath);
  let report = preflight;
  if (build) {
    if (!confirm) throw new Error('CMake configuration runs project-controlled code. Review the CMake files, then pass --build --confirm.');
    report = { ...preflight, buildResult: await runConfirmedCMakeBuild({ projectPath, buildDir, confirm, timeoutMs }) };
  } else if (confirm || buildDir) {
    throw new Error('--confirm and --build-dir are only valid with --build.');
  }
  if (json) printJson(report);
  else {
    console.log('PAXI Doctor C/C++ toolchain report');
    console.log(`Project: ${report.projectRoot}`);
    console.log(`Compiler: ${report.compilerAvailable ? 'available' : 'not found'}`);
    console.log(`Build definition: ${report.buildDefinitionAvailable ? 'detected' : 'not detected'}`);
    for (const tool of report.tools) console.log(`  ${tool.id}: ${tool.available ? tool.version : tool.skipped ? 'not applicable' : 'not found'}`);
    for (const warning of report.warnings) console.log(`  ! ${warning}`);
    if (report.buildResult) console.log(`CMake build: ${report.buildResult.succeeded ? 'SUCCEEDED' : 'FAILED'} (${report.buildResult.buildDirectory})`);
    else console.log('Preflight only: no compilation or project build script was executed.');
  }
  return report;
}

export async function doctorCodexCommand(args = []) {
  const action = args[0] || 'help';
  if (args.length > 1 || !['help', 'setup', 'status'].includes(action)) throw new Error('Usage: paxi doctor codex [setup|status]');
  if (!(await commandExists('codex'))) {
    const message = 'Codex CLI was not found on PATH. Install/sign in to Codex first, then run `paxi doctor codex setup`.';
    console.log(message);
    return { available: false, message };
  }
  if (action === 'help') {
    const instructions = ['PAXI exposes a small read-only MCP toolset to Codex.', 'Setup: paxi doctor codex setup', 'Manual: codex mcp add paxi-doctor -- paxi mcp', 'Verify: codex mcp list'];
    console.log(instructions.join('\n'));
    return { available: true, instructions };
  }
  if (action === 'status') {
    const result = await runProcess('codex', ['mcp', 'list'], { capture: true, tee: false, timeoutMs: 15000, maxOutputBytes: 64 * 1024 });
    console.log(result.stdout || result.stderr || `codex mcp list exited ${result.code}`);
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }
  let launcher = 'paxi';
  let launcherArgs = ['mcp'];
  if (!(await commandExists('paxi'))) {
    launcher = process.execPath;
    launcherArgs = [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/paxi.mjs'), 'mcp'];
  }
  const result = await runProcess('codex', ['mcp', 'add', 'paxi-doctor', '--', launcher, ...launcherArgs], { capture: true, tee: false, timeoutMs: 30000, maxOutputBytes: 64 * 1024 });
  if (result.code !== 0) throw new Error(`${result.stderr || result.stdout || 'Codex MCP registration failed.'}\nIf paxi-doctor is already configured, inspect it with: codex mcp get paxi-doctor`);
  console.log(result.stdout || '✓ PAXI Doctor MCP server registered with Codex. Run `codex mcp list` to verify.');
  return { configured: true, code: result.code, stdout: result.stdout };
}


export async function doctorPatchCommand(args = []) {
  if (args[0] === 'draft') return doctorFixDraftCommand(args.slice(1));
  const [action, patchFile, ...rest] = args;
  if (!['review', 'apply'].includes(action) || !patchFile) throw new Error('Usage: paxi doctor patch <draft|review|apply> <file.patch> [options]');
  let projectPath = process.cwd(); let confirm = false; let runTests = false; let json = false; let timeoutMs = 15 * 60 * 1000;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--confirm') confirm = true;
    else if (arg === '--run-tests') runTests = true;
    else if (arg === '--json') json = true;
    else if (arg === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectPath = rest[++index];
    else if (arg === '--timeout' && rest[index + 1] && /^\d+$/.test(rest[index + 1])) timeoutMs = Number(rest[++index]) * 1000;
    else throw new Error('Usage: paxi doctor patch <review|apply> <file.patch> [--project <dir>] [--confirm] [--run-tests] [--json]');
  }
  if (timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) throw new Error('--timeout must be 1–3600 seconds.');
  if (action === 'review' && (confirm || runTests)) throw new Error('--confirm and --run-tests are only valid with patch apply.');
  const report = action === 'review'
    ? await reviewPatch({ projectPath, patchFile })
    : await applyReviewedPatch({ projectPath, patchFile, confirm, runTests, timeoutMs });
  if (json) printJson(report);
  else {
    console.log(`Patch ${action}: ${report.patchFile}`);
    console.log(`Project: ${report.projectRoot}`);
    console.log(action === 'review' ? '✓ Patch passes git apply --check. No files changed.' : '✓ Patch applied as an uncommitted Git change.');
    if (report.diffStat) console.log(report.diffStat);
    if (report.tests) console.log(`Tests: ${report.tests.executed ? report.tests.passed ? 'PASSED' : 'FAILED' : 'NOT RUN'}${report.tests.note ? ` — ${report.tests.note}` : ''}`);
    console.log(report.nextStep || report.note);
  }
  return report;
}


export async function doctorJourneyCommand(args = []) {
  const [action, ...rest] = args;
  if (action === 'selectors') {
    let hierarchyPath = null; let json = false;
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === '--json') json = true;
      else if (rest[index] === '--hierarchy' && rest[index + 1] && !rest[index + 1].startsWith('--')) hierarchyPath = rest[++index];
      else throw new Error('Usage: paxi doctor journey selectors --hierarchy <uiautomator.xml> [--json]');
    }
    if (!hierarchyPath) throw new Error('Selector proposals require --hierarchy <uiautomator.xml>.');
    const report = await proposeAndroidSelectors({ hierarchyPath });
    if (json) printJson(report);
    else {
      console.log(`Android selector proposals: ${report.proposals.length} resource-ID candidate(s)`);
      for (const item of report.proposals) console.log(`  #${item.index} [${item.confidence}] ${item.selector.resourceId} · ${item.rationale}`);
      console.log(`Nodes without stable resource IDs: ${report.hierarchy.nodesWithoutResourceId}. No visible labels or content descriptions were retained.`);
      console.log('Review the target screen and selector before generating a journey.');
    }
    return report;
  }
  if (action === 'from-hierarchy') {
    let hierarchyPath = null; let packageId = null; let candidateIndex = null; let outputPath = null; let confirm = false; let json = false;
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--confirm') confirm = true;
      else if (arg === '--json') json = true;
      else if (arg === '--hierarchy' && rest[index + 1] && !rest[index + 1].startsWith('--')) hierarchyPath = rest[++index];
      else if (arg === '--package' && rest[index + 1] && !rest[index + 1].startsWith('--')) packageId = rest[++index];
      else if (arg === '--candidate' && /^\d+$/.test(rest[index + 1] || '')) candidateIndex = Number(rest[++index]);
      else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputPath = rest[++index];
      else throw new Error('Usage: paxi doctor journey from-hierarchy --hierarchy <uiautomator.xml> --package <application.id> --candidate <number> --output <journey.json> --confirm [--json]');
    }
    const report = await writeAndroidJourneyFromSelector({ hierarchyPath, packageId, candidateIndex, outputPath, confirm });
    if (json) printJson(report);
    else console.log(`✓ Selector-based Android journey draft written to ${report.output}. Review the target state and add defect-specific setup/actions before running.`);
    return report;
  }
  if (action === 'draft') {
    let goal = null; let output = 'paxi-journey-draft.json'; let name = null; let json = false;
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--json') json = true;
      else if (arg === '--goal' && rest[index + 1] && !rest[index + 1].startsWith('--')) goal = rest[++index];
      else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) output = rest[++index];
      else if (arg === '--name' && rest[index + 1] && !rest[index + 1].startsWith('--')) name = rest[++index];
      else throw new Error('Usage: paxi doctor journey draft --goal "tap Settings, then verify About is visible" [--name <name>] [--output <journey.json>] [--json]');
    }
    if (!goal) throw new Error('Journey draft requires a plain-language --goal.');
    const report = await writeJourneyDraft(goal, output, { name });
    if (json) printJson(report);
    else {
      console.log(`✓ Journey draft created: ${report.outputPath}`);
      console.log(`Steps: ${report.journey.steps.length} · unresolved instructions: ${report.unresolvedInstructions.length}`);
      console.log('Review every exact text selector and action before running. This draft does not execute anything.');
      for (const assumption of report.assumptions) console.log(`  ! ${assumption}`);
    }
    return report;
  }
  if (action === 'example') {
    if (rest.length) throw new Error('Usage: paxi doctor journey example');
    printJson(journeyExample());
    return journeyExample();
  }
  if (action === 'validate') {
    const file = rest.find((item) => !item.startsWith('--'));
    const json = rest.includes('--json');
    if (!file || rest.some((item) => item.startsWith('--') && item !== '--json')) throw new Error('Usage: paxi doctor journey validate <journey.json> [--json]');
    const journey = await loadJourneyFile(file);
    const report = { valid: true, name: journey.name, steps: journey.steps.length, actions: journey.steps.reduce((acc, step) => { acc[step.type] = (acc[step.type] || 0) + 1; return acc; }, {}) };
    if (json) printJson(report);
    else console.log(`✓ Journey '${report.name}' is valid (${report.steps} steps).`);
    return report;
  }
  if (action === 'run') {
    let filePath = null; let packageId = null; let deviceId = null; let launch = false; let outputDir = null; let json = false; let timeoutMs = 10 * 60 * 1000;
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--json') json = true;
      else if (arg === '--launch') launch = true;
      else if (arg === '--file' && rest[index + 1] && !rest[index + 1].startsWith('--')) filePath = rest[++index];
      else if (arg === '--package' && rest[index + 1] && !rest[index + 1].startsWith('--')) packageId = rest[++index];
      else if (arg === '--device' && rest[index + 1] && !rest[index + 1].startsWith('--')) deviceId = rest[++index];
      else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputDir = rest[++index];
      else if (arg === '--baseline-dir' && rest[index + 1] && !rest[index + 1].startsWith('--')) baselineDir = rest[++index];
      else if (arg === '--pixel-threshold' && /^\d+(?:\.\d+)?$/.test(rest[index + 1] || '')) visualPixelThreshold = Number(rest[++index]);
      else if (arg === '--max-changed-percent' && /^\d+(?:\.\d+)?$/.test(rest[index + 1] || '')) visualMaxChangedPercent = Number(rest[++index]);
      else if (arg === '--timeout' && rest[index + 1] && /^\d+$/.test(rest[index + 1])) timeoutMs = Number(rest[++index]) * 1000;
      else throw new Error('Usage: paxi doctor journey run --file <journey.json> --package <application.id> [--device <serial>] [--launch] [--output <dir>] [--timeout <seconds>] [--json]');
    }
    if (!filePath || !packageId) throw new Error('Journey run requires both --file <journey.json> and --package <application.id>.');
    const report = await runAndroidJourney({ filePath, packageId, deviceId, launch, outputDir, timeoutMs });
    if (json) printJson(report);
    else {
      console.log(`PAXI Android journey: ${report.journey.name}`);
      console.log(`Run: ${report.runId} · ${report.executionKind}`);
      console.log(`Steps: ${report.summary.executed}/${report.summary.steps} · Passed: ${report.summary.passed} · Failed: ${report.summary.failed}`);
      console.log(`Assertions: ${report.summary.assertions} · Issues: ${report.summary.issues}`);
      console.log(`Journey result: ${report.journeyPassClaim ? 'PASSED (scripted assertions only)' : report.status.toUpperCase()}`);
      console.log(`Evidence: ${report.reportDirectory}`);
      console.log(`Report: ${report.reportPath}`);
      console.log('No device-wide pass or certification is implied. Review screenshots before sharing.');
    }
    return report;
  }
  throw new Error('Usage: paxi doctor journey <example|draft|validate|run|selectors --hierarchy <xml>|from-hierarchy --hierarchy <xml> ...>');
}

export async function doctorVisionCommand(args = []) {
  const [action, imagePath, ...rest] = args;
  if (action !== 'analyze' || !imagePath) throw new Error('Usage: paxi doctor vision analyze <screenshot.png|jpg|webp> [--allow-remote] [--with-profile] [--project <dir>] [--json]');
  let allowRemote = false; let includeProfile = false; let projectPath = process.cwd(); let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--allow-remote') allowRemote = true;
    else if (arg === '--with-profile') includeProfile = true;
    else if (arg === '--json') json = true;
    else if (arg === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectPath = rest[++index];
    else throw new Error('Usage: paxi doctor vision analyze <screenshot> [--allow-remote] [--with-profile] [--project <dir>] [--json]');
  }
  const report = await analyzeScreenshot(imagePath, { allowRemote, includeProfile, projectPath });
  if (json) printJson(report);
  else {
    console.log(`PAXI Doctor Vision (${report.providerMode}) · ${report.image.format.toUpperCase()} ${report.image.width || '?'}x${report.image.height || '?'}`);
    console.log(report.analysis);
    for (const limitation of report.limitations) console.log(`
! ${limitation}`);
  }
  return report;
}

export async function doctorExploreCommand(args = []) {
  let packageId = null; let deviceId = null; let launch = false; let confirm = false; let outputDir = null; let maxActions = 5; let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--launch') launch = true;
    else if (arg === '--confirm') confirm = true;
    else if (arg === '--json') json = true;
    else if (arg === '--package' && args[index + 1] && !args[index + 1].startsWith('--')) packageId = args[++index];
    else if (arg === '--device' && args[index + 1] && !args[index + 1].startsWith('--')) deviceId = args[++index];
    else if (arg === '--output' && args[index + 1] && !args[index + 1].startsWith('--')) outputDir = args[++index];
    else if (arg === '--max-actions' && args[index + 1] && /^\d+$/.test(args[index + 1])) maxActions = Number(args[++index]);
    else throw new Error('Usage: paxi doctor explore --package <application.id> --confirm [--launch] [--device <serial>] [--max-actions 1-8] [--output <dir>] [--json]');
  }
  if (!packageId) throw new Error('Android exploration requires --package <application.id>.');
  const report = await runAndroidSafeExploration({ packageId, deviceId, launch, confirm, maxActions, outputDir });
  if (json) printJson(report);
  else {
    console.log(`PAXI safe Android exploration: ${report.runId} · ${report.executionKind}`);
    console.log(`Navigation candidates: ${report.summary.navigationCandidates} · Screenshots: ${report.summary.screensCaptured} · New navigation states: ${report.summary.changedScreens}`);
    console.log(`Evidence: ${report.reportDirectory}`);
    console.log('Only allowlisted navigation controls were tapped. No app-wide pass or coverage claim is made.');
  }
  return report;
}

export async function doctorVisualCommand(args = []) {
  const [action, ...rest] = args;
  if (action !== 'compare' || rest.length < 2) throw new Error('Usage: paxi doctor visual compare <baseline.png> <current.png> [--pixel-threshold 16] [--max-changed-percent 0.5] [--json]');
  let pixelThreshold = 16; let maxChangedPercent = 0.5; let json = false;
  for (let index = 2; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') json = true;
    else if (arg === '--pixel-threshold' && rest[index + 1] && /^\d+(?:\.\d+)?$/.test(rest[index + 1])) pixelThreshold = Number(rest[++index]);
    else if (arg === '--max-changed-percent' && rest[index + 1] && /^\d+(?:\.\d+)?$/.test(rest[index + 1])) maxChangedPercent = Number(rest[++index]);
    else throw new Error('Usage: paxi doctor visual compare <baseline.png> <current.png> [--pixel-threshold 16] [--max-changed-percent 0.5] [--json]');
  }
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index].startsWith('--')) { if (['--pixel-threshold','--max-changed-percent'].includes(rest[index])) index += 1; continue; }
    positional.push(rest[index]);
  }
  if (positional.length !== 2) throw new Error('Exactly two PNG paths are required: baseline and current screenshot.');
  const report = await comparePngFiles(positional[0], positional[1], { pixelThreshold, maxChangedPercent });
  if (json) printJson(report);
  else if (!report.comparable) console.log(`Visual comparison unavailable: ${report.reason}`);
  else {
    console.log(`Visual comparison ${report.passed ? 'PASSED' : 'REGRESSION'}: ${report.changedPercent}% changed pixels · ${report.changedPixels}/${report.totalPixels} · MAE ${report.meanAbsoluteError}`);
    if (!report.passed) process.exitCode = 1;
  }
  return report;
}

export async function doctorRuntimeCommand(args = []) {
  const [action, ...rest] = args;
  if (action !== 'probe') throw new Error('Usage: paxi doctor runtime probe --url <http://127.0.0.1:port/health> [--allow-remote] [--method GET|HEAD] [--timeout 8] [--json]');
  let url = null; let allowRemote = false; let method = 'GET'; let timeoutMs = 8000; let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--allow-remote') allowRemote = true;
    else if (arg === '--json') json = true;
    else if (arg === '--url' && rest[index + 1] && !rest[index + 1].startsWith('--')) url = rest[++index];
    else if (arg === '--method' && ['GET','HEAD'].includes(rest[index + 1])) method = rest[++index];
    else if (arg === '--timeout' && /^\d+$/.test(rest[index + 1] || '')) timeoutMs = Number(rest[++index]) * 1000;
    else throw new Error('Usage: paxi doctor runtime probe --url <http://127.0.0.1:port/health> [--allow-remote] [--method GET|HEAD] [--timeout 8] [--json]');
  }
  if (!url) throw new Error('Runtime probe requires --url.');
  const report = await probeRuntimeEndpoint({ url, allowRemote, method, timeoutMs });
  if (json) printJson(report);
  else {
    console.log(`Runtime probe: ${report.healthy ? 'HEALTHY' : 'UNHEALTHY'} · HTTP ${report.statusCode ?? 'no response'} · ${report.durationMs} ms`);
    console.log(`Target: ${report.target} (${report.scope})`);
    if (report.applicationHealth) console.log(`Application: ${report.applicationHealth}`);
    for (const dependency of report.dependencies || []) console.log(`  ${dependency.name}: ${dependency.status}`);
    if (report.failure) console.log(`Failure: ${report.failure}`);
    console.log('This is a bounded GET/HEAD health probe, not distributed tracing or a complete backend audit.');
  }
  if (!report.healthy) process.exitCode = 1;
  return report;
}

export async function doctorSecurityCommand(args = []) {
  const [action] = args;
  if (['advanced-tools', 'secrets', 'sast', 'trivy', 'contracts', 'apk', 'web', 'api-authz'].includes(action)) return doctorAdvancedSecurityCommand(args);
  const [, ...rest] = args;
  if (!['scan','npm-audit','tools','audit','sbom','sbom-validate','sbom-schema','licenses'].includes(action)) throw new Error('Usage: paxi doctor security scan|npm-audit|tools|audit|sbom|sbom-validate|sbom-schema|licenses [options]');
  let projectPath = process.cwd(); let json = false; let online = false; let confirm = false; let scanner = 'osv-scanner'; let outputPath = null; let format = 'cyclonedx-json'; let overwrite = false; let filePath = null; let sbomPath = null; let policyPath = null; let schemaPath = null; let schemaSha256 = null; let pythonCommand = null; let licenseListPath = null; let exceptionListPath = null; let licenseListSha256 = null; let exceptionListSha256 = null;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') json = true;
    else if (arg === '--online') online = true;
    else if (arg === '--confirm') confirm = true;
    else if (arg === '--overwrite') overwrite = true;
    else if (arg === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectPath = rest[++index];
    else if (arg === '--scanner' && rest[index + 1] && !rest[index + 1].startsWith('--')) scanner = rest[++index];
    else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputPath = rest[++index];
    else if (arg === '--format' && rest[index + 1] && !rest[index + 1].startsWith('--')) format = rest[++index];
    else if (arg === '--file' && rest[index + 1] && !rest[index + 1].startsWith('--')) filePath = rest[++index];
    else if (arg === '--sbom' && rest[index + 1] && !rest[index + 1].startsWith('--')) sbomPath = rest[++index];
    else if (arg === '--policy' && rest[index + 1] && !rest[index + 1].startsWith('--')) policyPath = rest[++index];
    else if (arg === '--schema' && rest[index + 1] && !rest[index + 1].startsWith('--')) schemaPath = rest[++index];
    else if (arg === '--schema-sha256' && rest[index + 1] && !rest[index + 1].startsWith('--')) schemaSha256 = rest[++index];
    else if (arg === '--python' && ['python','python3'].includes(rest[index + 1])) pythonCommand = rest[++index];
    else if (arg === '--license-list' && rest[index + 1] && !rest[index + 1].startsWith('--')) licenseListPath = rest[++index];
    else if (arg === '--exception-list' && rest[index + 1] && !rest[index + 1].startsWith('--')) exceptionListPath = rest[++index];
    else if (arg === '--license-list-sha256' && rest[index + 1] && !rest[index + 1].startsWith('--')) licenseListSha256 = rest[++index];
    else if (arg === '--exception-list-sha256' && rest[index + 1] && !rest[index + 1].startsWith('--')) exceptionListSha256 = rest[++index];
    else throw new Error('Usage: paxi doctor security scan|npm-audit|tools|audit|sbom|sbom-validate|sbom-schema|licenses [options]');
  }
  if (action === 'tools') {
    if (online || confirm || overwrite || outputPath || filePath || sbomPath || policyPath || schemaPath || schemaSha256 || pythonCommand || licenseListPath || exceptionListPath || licenseListSha256 || exceptionListSha256 || format !== 'cyclonedx-json' || scanner !== 'osv-scanner') throw new Error('security tools only accepts --json.')
    const scanners = await listNativeSecurityScanners();
    const report = { scanners, sbom: { id: 'syft', available: await commandExists('syft'), formats: ['cyclonedx-json', 'spdx-json'] }, note: 'Tool presence only; a missing scanner is not a clean security result.' };
    if (json) printJson(report); else { for (const item of scanners) console.log(`${item.available ? '[AVAILABLE]' : '[MISSING]'} ${item.id} — ${item.description}`); console.log(`${await commandExists('syft') ? '[AVAILABLE]' : '[MISSING]'} syft — SBOM generation`); }
    return report;
  }
  if (action === 'npm-audit') {
    if (scanner !== 'osv-scanner' || outputPath || overwrite || format !== 'cyclonedx-json' || filePath || sbomPath || policyPath || schemaPath || schemaSha256 || pythonCommand || licenseListPath || exceptionListPath || licenseListSha256 || exceptionListSha256) throw new Error('Only --project, --online, --confirm and --json apply to npm-audit.');
    const report = await runNpmDependencyAudit({ projectPath, online, confirm });
    if (json) printJson(report);
    else console.log(`npm audit: ${report.summary.total} vulnerabilities (${report.summary.critical} critical, ${report.summary.high} high, ${report.summary.moderate} moderate, ${report.summary.low} low).`);
    return report;
  }
  if (action === 'audit') {
    if (outputPath || overwrite || format !== 'cyclonedx-json' || filePath || sbomPath || policyPath || schemaPath || schemaSha256 || pythonCommand || licenseListPath || exceptionListPath || licenseListSha256 || exceptionListSha256) throw new Error('--output/--format are only valid with sbom.');
    const report = await runNativeVulnerabilityScan({ scanner, projectPath, online, confirm });
    if (json) printJson(report);
    else {
      console.log(`Native security scan: ${report.scanner} · ${report.status}`);
      console.log(`Advisory records: ${report.summary?.advisoryRecords ?? 'not parsed'} · packages: ${report.summary?.packagesScanned ?? 'unknown'} · exit: ${report.exitCode ?? 'not run'}`);
      for (const item of (report.advisories || []).slice(0, 30)) console.log(`  ${item.id} · ${item.package || 'package unknown'} · ${item.severity} — ${item.summary || ''}`);
      if (!report.complete) console.log(report.note || 'Scanner output was incomplete or not machine-readable; this is not a clean scan result.');
    }
    if (report.advisories?.length || (report.exitCode !== undefined && report.exitCode !== 0)) process.exitCode = 1;
    else if (!report.complete) process.exitCode = 2;
    return report;
  }
  if (action === 'sbom') {
    if (online || filePath || sbomPath || policyPath || schemaPath || schemaSha256 || pythonCommand || licenseListPath || exceptionListPath || licenseListSha256 || exceptionListSha256 || scanner !== 'osv-scanner') throw new Error('Syft SBOM generation accepts --project, --format, --output, --confirm, --overwrite and --json only.');
    if (!outputPath) throw new Error('SBOM generation requires --output <file>.');
    const report = await generateProjectSbom({ projectPath, outputPath, format, confirm, overwrite });
    if (json) printJson(report); else console.log(`SBOM: ${report.status}${report.outputPath ? ` · ${report.outputPath}` : ''} · components ${report.summary?.components ?? 'unknown'}`);
    if (!report.complete && report.status === 'tool-missing') process.exitCode = 2;
    return report;
  }
  if (action === 'sbom-validate') {
    if (!filePath || online || confirm || outputPath || overwrite || sbomPath || policyPath || schemaPath || schemaSha256 || pythonCommand || licenseListPath || exceptionListPath || licenseListSha256 || exceptionListSha256 || scanner !== 'osv-scanner' || format !== 'cyclonedx-json') throw new Error('Usage: paxi doctor security sbom-validate --file <sbom.json> [--json]');
    const report = await validateSbomFile({ filePath });
    if (json) printJson(report); else console.log(`SBOM validation: ${report.status} · ${report.format} · ${report.summary.components} component(s) · ${report.summary.errors} error(s) · ${report.summary.warnings} warning(s)`);
    if (report.summary.errors) process.exitCode = 1;
    return report;
  }
  if (action === 'sbom-schema') {
    if (!filePath || !schemaPath || online || confirm || outputPath || overwrite || sbomPath || policyPath || licenseListPath || exceptionListPath || licenseListSha256 || exceptionListSha256 || scanner !== 'osv-scanner' || format !== 'cyclonedx-json') throw new Error('Usage: paxi doctor security sbom-schema --file <sbom.json> --schema <official-local-schema.json> [--schema-sha256 <64-hex>] [--python python3] [--json]');
    const report = await validateSbomAgainstSchema({ filePath, schemaPath, schemaSha256, python: pythonCommand });
    if (json) printJson(report); else console.log(`SBOM JSON Schema validation: ${String(report.status).toUpperCase()}${report.valid === false ? ` · ${report.message || report.errors?.length || 'validation failed'}` : ''}`);
    if (report.status === 'invalid' || report.status === 'error') process.exitCode = 1;
    else if (report.status === 'tool-missing') process.exitCode = 2;
    return report;
  }
  if (action === 'licenses') {
    if (!sbomPath || !policyPath || online || confirm || outputPath || overwrite || filePath || schemaPath || schemaSha256 || pythonCommand || scanner !== 'osv-scanner' || format !== 'cyclonedx-json') throw new Error('Usage: paxi doctor security licenses --sbom <sbom.json> --policy <license-policy.json> [--license-list <licenses.json> --exception-list <exceptions.json>] [--license-list-sha256 <sha256> --exception-list-sha256 <sha256>] [--json]');
    const report = await evaluateSbomLicensePolicy({ sbomPath, policyPath, licenseListPath, exceptionListPath, licenseListSha256, exceptionListSha256 });
    if (json) printJson(report); else console.log(`SBOM license policy: ${report.status} · ${report.summary.allowed} allowed · ${report.summary.denied} denied · ${report.summary.warnings} review/unknown · ${report.summary.excepted} component exception(s)`);
    if (!report.passed) process.exitCode = 1;
    return report;
  }
  if (online || confirm || overwrite || outputPath || filePath || sbomPath || policyPath || schemaPath || schemaSha256 || pythonCommand || licenseListPath || exceptionListPath || licenseListSha256 || exceptionListSha256 || format !== 'cyclonedx-json' || scanner !== 'osv-scanner') throw new Error('--online and --confirm are only valid with security audit; SBOM options are only valid with sbom/sbom-validate/sbom-schema/licenses.');
  const report = await scanProjectSecurity(projectPath);
  if (json) printJson(report);
  else {
    console.log(`PAXI Doctor security scan: ${report.project.name}`);
    console.log(`Files: ${report.inventory.filesScanned} · Findings: ${report.summary.findings} · Critical: ${report.summary.critical} · High: ${report.summary.high} · Medium: ${report.summary.medium}`);
    console.log(`Dependency manifests: ${report.dependencies.ecosystems.map((item) => `${item.ecosystem} (${item.estimatedDirectDependencies} estimated direct, ${item.lockfilePresent ? 'lockfile present' : 'no lockfile detected'})`).join('; ') || 'none detected'}`);
    for (const item of report.findings) console.log(`  [${item.severity.toUpperCase()}] ${item.code} · ${item.file}${item.line ? `:${item.line}` : ''} — ${item.message}`);
    console.log('Read-only heuristic scan; no advisory database was queried and this is not a formal security audit.');
  }
  return report;
}

export async function doctorApiCommand(args = []) {
  const [action, ...rest] = args;
  if (!['spec', 'test', 'generate-tests'].includes(action)) throw new Error('Usage: paxi doctor api spec --file <openapi.json> [--json] | generate-tests --file <openapi.json> [--base-url <url>] [--output <plan.json>] [--max-cases 25] | test --file <api-tests.json> --confirm [--allow-remote] [--trace-id <32-hex>] [--save-report <file>] [--timeout 8] [--json]');
  let filePath = null; let json = false; let confirm = false; let allowRemote = false; let timeoutMs = 8000;
  let baseUrl = null; let outputPath = null; let maxCases = 25; let planName = null; let traceId = null; let saveReportPath = null;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') json = true;
    else if (arg === '--confirm') confirm = true;
    else if (arg === '--allow-remote') allowRemote = true;
    else if (arg === '--trace-id' && rest[index + 1] && !rest[index + 1].startsWith('--')) traceId = validateTraceId(rest[++index]);
    else if (arg === '--save-report' && rest[index + 1] && !rest[index + 1].startsWith('--')) saveReportPath = rest[++index];
    else if (arg === '--file' && rest[index + 1] && !rest[index + 1].startsWith('--')) filePath = rest[++index];
    else if (arg === '--base-url' && rest[index + 1] && !rest[index + 1].startsWith('--')) baseUrl = rest[++index];
    else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputPath = rest[++index];
    else if (arg === '--max-cases' && /^\d+$/.test(rest[index + 1] || '')) maxCases = Number(rest[++index]);
    else if (arg === '--name' && rest[index + 1] && !rest[index + 1].startsWith('--')) planName = rest[++index];
    else if (arg === '--timeout' && /^\d+$/.test(rest[index + 1] || '')) timeoutMs = Number(rest[++index]) * 1000;
    else throw new Error('Usage: paxi doctor api spec --file <openapi.json> [--json] | test --file <api-tests.json> --confirm [--allow-remote] [--timeout 8] [--json]');
  }
  if (!filePath) throw new Error('API Doctor requires --file.');
  let report;
  if (action === 'generate-tests') {
    if (confirm || allowRemote || timeoutMs !== 8000 || json || traceId || saveReportPath) throw new Error('--confirm, --allow-remote, --timeout, --trace-id and --save-report are only valid with `doctor api test`.');
    const plan = await generateApiSmokePlan({ filePath, baseUrl, maxCases, name: planName });
    const written = await writeGeneratedApiPlan({ outputPath: outputPath || 'paxi-api-smoke.generated.json', plan });
    console.log(`Generated ${plan.cases.length} read-only API smoke case(s): ${written.path}`);
    console.log(`Skipped dynamic routes: ${plan.generationSummary.skipped.templatedPaths} · mutating/unsupported methods: ${plan.generationSummary.skipped.unsupportedMethods} · deprecated operations: ${plan.generationSummary.skipped.deprecatedOperations}`);
    console.log('Review the generated plan and target before running `doctor api test --file <plan> --confirm`. The generator never sends requests.');
    return { ...plan, output: written };
  }
  if (action === 'spec') {
    if (confirm || allowRemote || timeoutMs !== 8000 || baseUrl || outputPath || maxCases !== 25 || planName || traceId || saveReportPath) throw new Error('--confirm, --allow-remote, --trace-id and --save-report are only valid with `doctor api test`; generation options are only valid with `doctor api generate-tests`.');
    report = await inspectOpenApiContract({ filePath });
    if (json) printJson(report);
    else {
      console.log(`OpenAPI contract: ${report.valid ? 'STRUCTURE VALID' : 'ISSUES FOUND'} · ${report.api.title || 'untitled API'}`);
      console.log(`Paths: ${report.summary.paths} · Operations: ${report.summary.operations} · Errors: ${report.summary.errors} · Warnings: ${report.summary.warnings} · Review: ${report.summary.review}`);
      for (const item of report.findings) console.log(`  [${item.severity.toUpperCase()}] ${item.code} · ${item.path} — ${item.message}`);
      console.log('Read-only JSON specification inspection; this does not call the live API or prove runtime conformance.');
    }
    if (!report.valid) process.exitCode = 1;
    return report;
  }
  if (baseUrl || outputPath || maxCases !== 25 || planName) throw new Error('--base-url, --output, --max-cases and --name are only valid with `doctor api generate-tests`.');
  if (timeoutMs < 500 || timeoutMs > 30000) throw new Error('--timeout must be 1–30 seconds for API smoke tests.' );
  report = await runApiSmokeTests({ filePath, allowRemote, confirm, timeoutMs, traceId });
  if (saveReportPath) report.savedReport = await writeApiSmokeReport({ outputPath: saveReportPath, report });
  if (json) printJson(report);
  else {
    console.log(`API smoke tests: ${report.summary.passed}/${report.summary.total} passed · ${report.summary.failed} failed · ${report.scope}`);
    console.log(`Target: ${report.target}`);
    for (const item of report.results) {
      console.log(`  [${item.status.toUpperCase()}] ${item.id} · ${item.method} ${item.path} · HTTP ${item.statusCode ?? 'no response'} · ${item.durationMs} ms`);
      for (const issue of item.issues) console.log(`    ${issue.code}: ${issue.message}`);
    }
    console.log('Only GET/HEAD requests are supported. Response bodies are not retained; JSON assertions are bounded and evaluated in memory.');
    if (report.traceContext?.enabled) console.log(`W3C trace ID: ${report.traceContext.traceId} (pass the same --trace-id to the website lab).`);
    if (report.savedReport) console.log(`Saved API evidence report: ${report.savedReport.path}`);
  }
  if (report.summary.failed) process.exitCode = 1;
  return report;
}

export async function doctorTraceCommand(args = []) {
  const [action, ...rest] = args;
  if (action === 'spans') {
    let spansPath = null; let traceId = null; let outputPath = null; let slowDatabaseMs = 500; let json = false;
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--json') json = true;
      else if (arg === '--spans' && rest[index + 1] && !rest[index + 1].startsWith('--')) spansPath = rest[++index];
      else if (arg === '--trace-id' && rest[index + 1] && !rest[index + 1].startsWith('--')) traceId = validateTraceId(rest[++index]);
      else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputPath = rest[++index];
      else if (arg === '--slow-database-ms' && /^\d+$/.test(rest[index + 1] || '')) slowDatabaseMs = Number(rest[++index]);
      else throw new Error('Usage: paxi doctor trace spans --spans <otel-export.json> [--trace-id <32-hex>] [--slow-database-ms 500] [--output <span-report.json>] [--json]');
    }
    const report = await inspectOtelSpans({ filePath: spansPath, traceId, slowDatabaseMs });
    if (outputPath) {
      const fs = await import('node:fs/promises'); const path = await import('node:path');
      const absolute = path.resolve(outputPath); const parent = await fs.lstat(path.dirname(absolute)).catch(() => null);
      if (!parent?.isDirectory() || parent.isSymbolicLink()) throw new Error('Span report output directory must already exist and must not be a symlink.');
      const existing = await fs.lstat(absolute).catch(() => null); if (existing) throw new Error('Span report output already exists. Choose a new path; reports are never overwritten.');
      await fs.writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); report.output = absolute;
    }
    if (json) printJson(report);
    else { console.log(`OpenTelemetry import: ${report.summary.spans} span(s) · ${report.summary.errors} error(s) · ${report.summary.databaseSpans} database span(s) · ${report.summary.slowDatabaseSpans} slow database span(s).`); if (report.output) console.log(`Saved: ${report.output}`); console.log('Read-only local OTLP JSON import. Span ancestry creates investigation leads, not a proven root cause.'); }
    return report;
  }
  if (action === 'create') {
    if (rest.some((item) => item !== '--json')) throw new Error('Usage: paxi doctor trace create [--json]');
    const traceId = createTraceId();
    const report = { traceId, standard: 'W3C Trace Context 1.0', usage: 'Pass this same value to `doctor api test --trace-id`, `doctor lab run --trace-id`, and `doctor trace inspect --trace-id` for a shared trace context.' };
    if (rest.includes('--json')) printJson(report);
    else { console.log(`PAXI trace ID: ${traceId}`); console.log(report.usage); }
    return report;
  }
  if (action === 'inspect') {
    let logPath = null; let traceId = null; let outputPath = null; let json = false;
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--json') json = true;
      else if (arg === '--log' && rest[index + 1] && !rest[index + 1].startsWith('--')) logPath = rest[++index];
      else if (arg === '--trace-id' && rest[index + 1] && !rest[index + 1].startsWith('--')) traceId = validateTraceId(rest[++index]);
      else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputPath = rest[++index];
      else throw new Error('Usage: paxi doctor trace inspect --log <backend.log> --trace-id <32-hex> [--output <trace-report.json>] [--json]');
    }
    const report = await inspectTraceLog({ filePath: logPath, traceId });
    if (outputPath) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const absolute = path.resolve(outputPath);
      const parent = await fs.lstat(path.dirname(absolute)).catch(() => null);
      if (!parent?.isDirectory() || parent.isSymbolicLink()) throw new Error('Trace report output directory must already exist and must not be a symlink.');
      const existing = await fs.lstat(absolute).catch(() => null);
      if (existing) throw new Error('Trace report output already exists. Choose a new path; reports are never overwritten.');
      await fs.writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      report.output = absolute;
    }
    if (json) printJson(report);
    else {
      console.log(`Trace log inspection: ${report.summary.matches} matching line(s), ${report.summary.matchesReturned} returned.`);
      console.log(`Trace ID: ${report.traceId} · File: ${report.file}`);
      for (const item of report.matches) console.log(`  L${item.lineNumber} [${item.level}]${item.service ? ` ${item.service}` : ''} ${item.message}`);
      console.log('Read-only local log scan. Excerpts are redacted best-effort; inspect before sharing.');
      if (report.output) console.log(`Saved: ${report.output}`);
    }
    return report;
  }
  throw new Error('Usage: paxi doctor trace <create|inspect|spans> [options]');
}

export async function doctorRegressionCommand(args = []) {
  const [action, ...rest] = args;
  if (action !== 'draft') throw new Error('Usage: paxi doctor regression draft --evidence <correlation.json> [--targets api,website,android|all] [--plan <reviewed-api-plan.json>] [--android-output <journey.json>] [--output <regression-draft.json>] [--json]');
  let planPath = null; let evidencePath = null; let outputPath = 'paxi-regression.generated.json'; let androidOutputPath = null; let targets = ['api']; let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') json = true;
    else if (arg === '--plan' && rest[index + 1] && !rest[index + 1].startsWith('--')) planPath = rest[++index];
    else if (arg === '--evidence' && rest[index + 1] && !rest[index + 1].startsWith('--')) evidencePath = rest[++index];
    else if (arg === '--targets' && rest[index + 1] && !rest[index + 1].startsWith('--')) targets = parseCsv(rest[++index], '--targets');
    else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputPath = rest[++index];
    else if (arg === '--android-output' && rest[index + 1] && !rest[index + 1].startsWith('--')) androidOutputPath = rest[++index];
    else throw new Error('Usage: paxi doctor regression draft --evidence <correlation.json> [--targets api,website,android|all] [--plan <reviewed-api-plan.json>] [--android-output <journey.json>] [--output <regression-draft.json>] [--json]');
  }
  const report = await draftRegressionSuite({ planPath, evidencePath, outputPath, androidOutputPath, targets });
  if (json) printJson(report);
  else {
    console.log(`Regression draft targets: ${report.targets.join(', ')}`);
    console.log(`API cases: ${report.api?.count || 0} · Website routes: ${report.website?.count || 0} · Android starter: ${report.android?.readyToRun ? 'created (manual assertion required)' : 'not matched'}`);
    for (const route of (report.website?.routes || []).slice(0, 10)) console.log(`  ${route.origin}${route.path} · suggested checks: ${route.suggestedChecks.join(', ') || 'manual review'} · feature assertion required`);
    if (report.output) console.log(`Saved: ${report.output.path}`);
    if (report.androidOutput) console.log(`Android journey starter: ${report.androidOutput.path}`);
    console.log('Draft only. Review expected behavior and selectors before running. Website runs are viewport simulations; Android journeys need feature-specific assertions.');
  }
  return report;
}

export async function doctorCorrelateCommand(args = []) {
  const reportPaths = [];
  let json = false;
  let outputPath = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--report' && args[index + 1] && !args[index + 1].startsWith('--')) reportPaths.push(args[++index]);
    else if (arg === '--output' && args[index + 1] && !args[index + 1].startsWith('--')) outputPath = args[++index];
    else throw new Error('Usage: paxi doctor correlate --report <evidence.json> [--report <evidence.json> ...] [--output <correlation.json>] [--json]');
  }
  const report = await analyzeCrossLayerEvidence({ reportPaths });
  if (outputPath) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const absolute = path.resolve(outputPath);
    const parent = await fs.lstat(path.dirname(absolute)).catch(() => null);
    if (!parent?.isDirectory() || parent.isSymbolicLink()) throw new Error('Correlation output directory must already exist and must not be a symlink.');
    await fs.writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    report.output = absolute;
  }
  if (json) printJson(report);
  else {
    console.log(`PAXI cross-layer evidence: ${report.summary.reports} report(s) · ${report.summary.layers.join(', ')}`);
    console.log(`Events: ${report.summary.events} · high: ${report.summary.high} · medium: ${report.summary.medium} · low: ${report.summary.low}`);
    console.log(`Candidate correlations: ${report.summary.correlations} · ranked root-cause hypotheses: ${(report.rootCauseCandidates || []).length}`);
    for (const hypothesis of (report.rootCauseCandidates || []).slice(0, 8)) console.log(`  [${hypothesis.confidence.toUpperCase()} #${hypothesis.rank}] ${hypothesis.candidate} — ${hypothesis.interpretation}`);
    for (const item of report.correlations) console.log(`  [${item.confidence.toUpperCase()}] ${item.code}${item.route ? ` · ${item.route}` : ''} — ${item.interpretation}`);
    for (const item of (report.investigationCases || []).slice(0, 8)) console.log(`  [${item.confidence}] ${item.id} · ${item.layers.join(' / ')} · ${item.failedEventCount} failed event(s) · ${item.missingEvidence.length} evidence gap(s)`);
    if (!report.correlations.length) console.log('No direct cross-layer matches were established by the supplied metadata. Review the extracted events and collect matching service/request identifiers where available.');
    console.log('Correlation is an investigation aid, not proof of causation. Route-only cases are weak groupings. Browser viewport runs remain simulated; Android evidence retains its actual device type.');
    if (report.output) console.log(`Saved: ${report.output}`);
  }
  return report;
}

export async function doctorDatabaseCommand(args = []) {
  const [action, ...rest] = args;
  if (!['scan','lab'].includes(action)) throw new Error('Usage: paxi doctor database scan|lab [--engine sqlite|postgres|mysql|mariadb|sqlserver] [--project <dir>] [--migrations <relative-dir>] [--seed-sql <relative-file>] [--confirm] [--json]');
  let projectPath = process.cwd(); let migrationsPath = null; let seedSqlPath = null; let confirm = false; let json = false; let engine = 'sqlite';
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') json = true;
    else if (arg === '--confirm') confirm = true;
    else if (arg === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectPath = rest[++index];
    else if (arg === '--migrations' && rest[index + 1] && !rest[index + 1].startsWith('--')) migrationsPath = rest[++index];
    else if (arg === '--seed-sql' && rest[index + 1] && !rest[index + 1].startsWith('--')) seedSqlPath = rest[++index];
    else if (arg === '--engine' && ['sqlite','postgres','mysql','mariadb','sqlserver'].includes(rest[index + 1])) engine = rest[++index];
    else throw new Error('Usage: paxi doctor database scan|lab [--engine sqlite|postgres|mysql|mariadb|sqlserver] [--project <dir>] [--migrations <relative-dir>] [--seed-sql <relative-file>] [--confirm] [--json]');
  }
  if (action === 'scan') {
    if (confirm || migrationsPath || seedSqlPath || engine !== 'sqlite') throw new Error('--engine, --confirm, --migrations and --seed-sql are only valid with database lab.');
    const report = await scanDatabaseMigrations(projectPath);
    if (json) printJson(report);
    else {
      console.log(`Database migration review: ${report.project}`);
      console.log(`SQL files: ${report.inventory.migrationFiles} · Findings: ${report.summary.findings} · Critical: ${report.summary.critical} · High: ${report.summary.high} · Warnings: ${report.summary.warning} · Review: ${report.summary.review}`);
      for (const item of report.findings) console.log(`  [${item.severity.toUpperCase()}] ${item.code} · ${item.file}:${item.line} — ${item.message}\n    ${item.recommendation}`);
      console.log('Read-only static SQL review; no database connection or migration execution occurs.');
    }
    if (report.summary.critical || report.summary.high) process.exitCode = 1;
    return report;
  }
  if (!confirm) throw new Error('Database Lab executes project migrations in a disposable database. Review the target and pass --confirm.');
  const report = engine === 'sqlite'
    ? await runDisposableSqliteMigrationLab({ projectPath, migrationsPath, seedSqlPath, confirm })
    : await runDisposableServiceMigrationLab({ engine, projectPath, migrationsPath, seedSqlPath, confirm });
  if (json) printJson(report);
  else if (engine === 'sqlite') {
    console.log(`Disposable SQLite migration lab: ${report.status?.toUpperCase() || 'UNKNOWN'} · ${report.summary?.passed ?? 0}/${report.summary?.total ?? 0} migration(s) passed`);
    if (report.before && report.after) console.log(`Schema objects: ${report.before.objects.length} → ${report.after.objects.length} · changed: ${report.schemaChanged}`);
    for (const item of report.results || []) console.log(`  [${item.status.toUpperCase()}] ${item.name}${item.message ? ` — ${item.message}` : ''}`);
  } else {
    console.log(`Disposable ${engine} migration lab: ${report.status?.toUpperCase() || 'UNKNOWN'} · ${report.summary?.passed ?? 0}/${report.summary?.total ?? 0} step(s) passed · cleanup ${report.cleanupComplete ? 'complete' : 'requires attention'}`);
    if (report.migrationReplayPassed !== undefined) console.log(`Migration replay: ${report.migrationReplayPassed ? 'passed' : 'failed'} · schema comparison: ${report.schemaComparison?.status || 'unavailable'} (${report.schemaComparison?.method || 'no comparison'})`);
    if (report.database?.generatedName) console.log(`Generated disposable database: ${report.database.generatedName}`);
    for (const item of report.results || []) console.log(`  [${item.status.toUpperCase()}] ${item.name}${item.message ? ` — ${item.message}` : ''}`);
  }
  console.log(engine === 'sqlite' ? 'Only SQLite-compatible SQL was executed in an in-memory database.' : 'A random database and restricted test user/login were created on the explicitly configured loopback server and cleanup was attempted.');
  if (!report.passed) process.exitCode = 1;
  return report;
}

export async function doctorObserveCommand(args = []) {
  const [action, ...rest] = args;
  if (action === 'validate') {
    let endpoint = null; let confirm = false; let allowRemote = false; let json = false; let timeoutMs = 5000; let serviceName = 'paxi-doctor-probe'; let authorizationEnv = null;
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--confirm') confirm = true;
      else if (arg === '--allow-remote') allowRemote = true;
      else if (arg === '--json') json = true;
      else if (arg === '--endpoint' && rest[index + 1] && !rest[index + 1].startsWith('--')) endpoint = rest[++index];
      else if (arg === '--service' && rest[index + 1] && !rest[index + 1].startsWith('--')) serviceName = rest[++index];
      else if (arg === '--auth-env' && rest[index + 1] && !rest[index + 1].startsWith('--')) authorizationEnv = rest[++index];
      else if (arg === '--timeout' && /^\d+$/.test(rest[index + 1] || '')) timeoutMs = Number(rest[++index]) * 1000;
      else throw new Error('Usage: paxi doctor observe validate --endpoint http://127.0.0.1:4318/v1/traces --confirm [--allow-remote] [--service <name>] [--auth-env PAXI_OTEL_AUTHORIZATION] [--timeout 5] [--json]');
    }
    if (!endpoint) throw new Error('OTLP validation requires --endpoint.');
    const report = await validateOtlpHttpExporter({ endpoint, confirm, allowRemote, serviceName, timeoutMs, authorizationEnv });
    if (json) printJson(report);
    else {
      console.log(`OTLP exporter validation: ${report.status.toUpperCase()} · HTTP ${report.httpStatus ?? 'no response'} · ${report.durationMs} ms`);
      console.log(`Target: ${report.target} (${report.scope}) · synthetic trace ${report.traceId} · auth configured: ${Boolean(report.authConfigured)}`);
      console.log('A 2xx response proves endpoint acceptance only, not persistence or queryability in the trace backend.');
    }
    if (!report.acceptedByCollector) process.exitCode = 1;
    return report;
  }
  if (action === 'packs' || (action === 'pack' && rest[0] === 'list')) {
    const packs = listObservabilityPacks();
    printJson({ packs, note: 'Templates only; selecting or listing packs does not alter the project.' });
    return packs;
  }
  if (action === 'pack') {
    const [subAction, id, ...options] = rest;
    if (subAction === 'show') {
      const pack = getObservabilityPack(id);
      printJson(pack);
      return pack;
    }
    if (subAction !== 'install' || !id) throw new Error('Usage: paxi doctor observe packs | pack show <id> | pack install <id> --project <dir> --confirm [--output <relative-dir>] [--json]');
    let projectPath = process.cwd(); let outputPath = null; let confirm = false; let json = false;
    for (let index = 0; index < options.length; index += 1) {
      const arg = options[index];
      if (arg === '--confirm') confirm = true;
      else if (arg === '--json') json = true;
      else if (arg === '--project' && options[index + 1] && !options[index + 1].startsWith('--')) projectPath = options[++index];
      else if (arg === '--output' && options[index + 1] && !options[index + 1].startsWith('--')) outputPath = options[++index];
      else throw new Error('Usage: paxi doctor observe pack install <id> --project <dir> --confirm [--output <relative-dir>] [--json]');
    }
    const report = await writeObservabilityPack({ id, projectPath, outputPath, confirm });
    if (json) printJson(report);
    else {
      console.log(`✓ Wrote ${report.pack.title} observability templates to ${report.directory}`);
      for (const file of report.files) console.log(`  ${path.basename(file)}`);
      console.log('No source code, dependency manifest or lockfile was modified. Review and integrate the pack manually.');
    }
    return report;
  }
  throw new Error('Usage: paxi doctor observe packs | pack show <id> | pack install <id> --project <dir> --confirm');
}

export async function doctorWebsiteCommand(args = []) {
  const [area, action, ...rest] = args;
  if (area === 'accessibility') {
    let url = null; let projectRoot = process.cwd(); let profiles = ['standard']; let browserEngine = 'chromium'; let allowRemote = false; let confirm = false; let outputPath = null; let json = false; let timeoutMs = 15000;
    for (let index = 0; index < rest.length; index += 1) {
      const values = rest; const arg = values[index];
      if (arg === '--confirm') confirm = true;
      else if (arg === '--allow-remote') allowRemote = true;
      else if (arg === '--json') json = true;
      else if (arg === '--url' && values[index + 1] && !values[index + 1].startsWith('--')) url = values[++index];
      else if (arg === '--project' && values[index + 1] && !values[index + 1].startsWith('--')) projectRoot = values[++index];
      else if (arg === '--profiles' && values[index + 1] && !values[index + 1].startsWith('--')) profiles = parseCsv(values[++index], '--profiles');
      else if (arg === '--browser' && ['chromium','firefox','webkit'].includes(values[index + 1])) browserEngine = values[++index];
      else if (arg === '--output' && values[index + 1] && !values[index + 1].startsWith('--')) outputPath = values[++index];
      else if (arg === '--timeout' && /^\d+$/.test(values[index + 1] || '')) timeoutMs = Number(values[++index]) * 1000;
      else throw new Error('Usage: paxi doctor website accessibility --url <http://localhost:port> --confirm [--profiles compact,standard,tablet] [--browser chromium|firefox|webkit] [--allow-remote] [--output report.json] [--json]');
    }
    if (!url) throw new Error('Website accessibility audit requires --url.');
    const report = await runWebsiteAccessibilityAudit({ url, projectRoot, profiles, browserEngine, allowRemote, confirm, timeoutMs, outputPath });
    if (json) printJson(report); else {
      console.log(`Website accessibility: ${report.status.toUpperCase()} · ${report.summary.violations} violation(s) · ${report.summary.incomplete} incomplete check(s) · ${report.summary.needsReview} case(s) need review · ${report.summary.total} viewport case(s)`);
      if (report.summary.blockedRequests || report.summary.runtimeErrors || report.summary.httpErrors) console.log(`Evidence: ${report.summary.blockedRequests} blocked request(s) · ${report.summary.runtimeErrors} runtime error(s) · ${report.summary.httpErrors} HTTP error(s)`);
    }
    if (['failed','review'].includes(report.status)) process.exitCode = 1;
    return report;
  }
  if (area !== 'journey') throw new Error('Usage: paxi doctor website journey <example|validate|run|matrix> ... | accessibility --url <url> --confirm ...');
  if (action === 'example') {
    let outputPath = null; let json = false;
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === '--json') json = true;
      else if (rest[index] === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputPath = rest[++index];
      else throw new Error('Usage: paxi doctor website journey example [--output <journey.json>] [--json]');
    }
    const example = websiteJourneyExample();
    if (outputPath) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(path.resolve(outputPath), `${JSON.stringify(example, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    if (json) printJson({ journey: example, output: outputPath ? path.resolve(outputPath) : null });
    else if (outputPath) console.log(`✓ Example website journey written to ${path.resolve(outputPath)}. Review selectors, mocks and use a dedicated test account.`);
    else printJson(example);
    return example;
  }
  if (action === 'validate') {
    let filePath = null; let json = false;
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === '--json') json = true;
      else if (rest[index] === '--file' && rest[index + 1] && !rest[index + 1].startsWith('--')) filePath = rest[++index];
      else if (!rest[index].startsWith('--') && !filePath) filePath = rest[index];
      else throw new Error('Usage: paxi doctor website journey validate --file <journey.json> [--json]');
    }
    if (!filePath) throw new Error('Website journey validation requires --file <journey.json>.');
    const journey = await loadWebsiteJourney(filePath);
    const report = { valid: true, name: journey.name, steps: journey.steps.length, mocks: journey.mocks.length, actions: journey.steps.reduce((acc, step) => { acc[step.type] = (acc[step.type] || 0) + 1; return acc; }, {}) };
    if (json) printJson(report); else console.log(`✓ Website journey '${journey.name}' is valid (${journey.steps.length} steps, ${journey.mocks.length} static response mock(s)).`);
    return report;
  }
  if (action === 'run' || action === 'matrix') {
    let filePath = null; let url = null; let projectRoot = process.cwd(); let browserEngine = 'chromium'; let browsers = ['chromium','firefox','webkit']; let outputDir = null; let traceId = null; let storageStatePath = null; let saveStorageStatePath = null; let allowedApiOrigins = []; let confirm = false; let allowRemote = false; let json = false; let timeoutMs = 10000;
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--confirm') confirm = true;
      else if (arg === '--allow-remote') allowRemote = true;
      else if (arg === '--json') json = true;
      else if (arg === '--file' && rest[index + 1] && !rest[index + 1].startsWith('--')) filePath = rest[++index];
      else if (arg === '--url' && rest[index + 1] && !rest[index + 1].startsWith('--')) url = rest[++index];
      else if (arg === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectRoot = rest[++index];
      else if (arg === '--browser' && ['chromium', 'firefox', 'webkit'].includes(rest[index + 1])) browserEngine = rest[++index];
      else if (arg === '--browsers' && rest[index + 1] && !rest[index + 1].startsWith('--')) browsers = parseCsv(rest[++index], '--browsers');
      else if (arg === '--storage-state' && rest[index + 1] && !rest[index + 1].startsWith('--')) storageStatePath = rest[++index];
      else if (arg === '--save-storage-state' && rest[index + 1] && !rest[index + 1].startsWith('--')) saveStorageStatePath = rest[++index];
      else if (arg === '--allow-api-origin' && rest[index + 1] && !rest[index + 1].startsWith('--')) allowedApiOrigins.push(rest[++index]);
      else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputDir = rest[++index];
      else if (arg === '--trace-id' && rest[index + 1] && !rest[index + 1].startsWith('--')) traceId = validateTraceId(rest[++index]);
      else if (arg === '--timeout' && /^\d+$/.test(rest[index + 1] || '')) timeoutMs = Number(rest[++index]) * 1000;
      else throw new Error('Usage: paxi doctor website journey run|matrix --file <journey.json> --url <http://localhost:port> --confirm [--browser chromium|firefox|webkit] [--browsers chromium,firefox,webkit] [--storage-state <private-file>] [--save-storage-state <new-private-file>] [--allow-api-origin <https-origin>] [--allow-remote] [--json]');
    }
    if (!filePath || !url) throw new Error(`Website journey ${action} requires both --file and --url.`);
    if (action === 'matrix' && saveStorageStatePath) throw new Error('--save-storage-state is only supported for a single browser journey run.');
    const report = action === 'matrix'
      ? await runWebsiteJourneyMatrix({ filePath, url, browsers, projectRoot, outputDir, traceId, storageStatePath, allowedApiOrigins, confirm, allowRemote })
      : await runWebsiteJourney({ filePath, url, projectRoot, browserEngine, outputDir, timeoutMs, traceId, storageStatePath, saveStorageStatePath, allowedApiOrigins, confirm, allowRemote });
    if (json) printJson(report);
    else if (action === 'matrix') {
      console.log(`PAXI website browser matrix: ${report.status} · ${report.summary.passed}/${report.summary.requested} passed · ${report.summary.unavailable} unavailable`);
      for (const item of report.results) console.log(`  [${item.status.toUpperCase()}] ${item.engine}${item.error ? ` — ${item.error}` : ''}`);
      console.log('Browser engine results are separate simulations, not physical Android/iOS certification.');
    } else {
      console.log(`PAXI website journey: ${report.name}`);
      console.log(`Runner: ${report.runner} · ${report.executionKind}`);
      console.log(`Steps: ${report.summary.executed}/${report.summary.total} · Passed: ${report.summary.passed} · Failed: ${report.summary.failed} · Assertions: ${report.summary.assertions}`);
      console.log(`Result: ${report.journeyPassClaim ? 'PASSED (scripted assertions only)' : report.status.toUpperCase()}`);
      console.log(`Evidence: ${report.reportDirectory}`);
      if (report.traceContext.enabled) console.log(`W3C trace ID: ${report.traceContext.traceId}`);
      console.log(`Session state used: ${report.sessionStateUsed ? 'yes (external private file)' : 'no'} · saved: ${report.sessionStateExportStatus}`);
      console.log('Browser simulation only; this is not physical Android/iOS browser certification.');
    }
    const failed = action === 'matrix' ? report.status !== 'passed' : !report.journeyPassClaim;
    if (failed) process.exitCode = 1;
    return report;
  }
  throw new Error('Usage: paxi doctor website journey <example|validate|run|matrix> ...');
}

function parseCsv(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} requires a comma-separated list.`);
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export async function doctorLabCommand(args = []) {
  const [action, ...rest] = args;
  if (action === 'android-devices') {
    const devices = await listAndroidDevices();
    printJson(devices);
    return devices;
  }
  if (action === 'android') {
    let packageId = null; let deviceId = null; let launch = false; let conditions = []; let outputDir = null; let json = false;
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--launch') launch = true;
      else if (arg === '--json') json = true;
      else if (arg === '--package' && rest[index + 1] && !rest[index + 1].startsWith('--')) packageId = rest[++index];
      else if (arg === '--device' && rest[index + 1] && !rest[index + 1].startsWith('--')) deviceId = rest[++index];
      else if (arg === '--conditions' && rest[index + 1] && !rest[index + 1].startsWith('--')) conditions = parseCsv(rest[++index], '--conditions');
      else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputDir = rest[++index];
      else throw new Error('Usage: paxi doctor lab android [--package <application.id>] [--device <serial>] [--launch] [--conditions font,landscape,dark,keyboard,zoom,offline] [--output <dir>] [--json]');
    }
    const report = await runAndroidDeviceLab({ packageId, deviceId, launch, conditions, outputDir });
    if (json) printJson(report);
    else {
      console.log(`Android Device Lab: ${report.device.model} (${report.device.type})`);
      console.log(`Android ${report.device.androidRelease} · API ${report.device.sdk} · ${report.device.resolution ? `${report.device.resolution.width}x${report.device.resolution.height}` : 'unknown resolution'}`);
      console.log(`Detected viewport profile: ${report.device.detectedProfile.id} (${report.device.detectedProfile.confidence})`);
      console.log(`Screenshot: ${report.evidence.screenshot.path}`);
      console.log(`Sanitized UI hierarchy: ${report.evidence.hierarchy.captured ? report.evidence.hierarchy.path : report.evidence.hierarchy.reason}`);
      console.log(`Report: ${report.reportPath}`);
      console.log('Real device/emulator snapshot captured. Selected conditions are observed, not changed automatically.');
    }
    return report;
  }
  if (action === 'history') {
    const history = await listLabRuns();
    printJson(history);
    return history;
  }
  if (action === 'compare') {
    const ids = rest.filter((value) => !value.startsWith('--'));
    const json = rest.includes('--json');
    if (ids.length !== 2 || rest.some((value) => value.startsWith('--') && value !== '--json')) throw new Error('Usage: paxi doctor lab compare <before-run-id> <after-run-id> [--json]');
    const comparison = await compareLabRuns(ids[0], ids[1]);
    if (json) printJson(comparison);
    else {
      if (!comparison.comparable) console.log(`Runs cannot be compared: ${comparison.reason}`);
      else if (['browser-viewport-results', 'browser-semantic-journey-results'].includes(comparison.comparisonKind)) {
        console.log(`${comparison.comparisonKind === 'browser-semantic-journey-results' ? 'Website journey' : 'Device Lab'} comparison: ${ids[0]} → ${ids[1]}`);
        console.log(`Improved: ${comparison.summary.improvedCases} · Regressed: ${comparison.summary.regressedCases} · Changed cases: ${comparison.summary.changedCases}`);
        if (comparison.summary.visualComparisons !== undefined) console.log(`Pixel comparisons: ${comparison.summary.visualComparisons} · Visual regressions: ${comparison.summary.visualRegressions}`);
        for (const item of comparison.cases) console.log(`  ${item.id}: ${item.beforeStatus || '—'} → ${item.afterStatus || '—'} (+${item.introducedIssues?.join(',') || 'none'} / -${item.resolvedIssues?.join(',') || 'none'})${item.visualComparison?.comparable ? ` · ${item.visualComparison.changedPercent}% pixels changed` : ''}`);
      } else {
        console.log(`Android snapshot comparison: ${ids[0]} → ${ids[1]}`);
        console.log(`Changed fields: ${comparison.changes.length}`);
        for (const item of comparison.changes) console.log(`  ${item.field}: ${JSON.stringify(item.before)} → ${JSON.stringify(item.after)}`);
      }
      console.log(comparison.limitation || '');
    }
    return comparison;
  }
  if (action === 'run') {
    let url = null; let projectRoot = process.cwd(); let profiles = ['standard']; let conditions = []; let outputDir = null; let baselineDir = null; let updateBaseline = false; let confirm = false; let json = false; let timeoutMs = 15000; let visualPixelThreshold = 16; let visualMaxChangedPercent = 0.5; let traceId = null; let routes = [];
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--json') json = true;
      else if (arg === '--update-baseline') updateBaseline = true;
      else if (arg === '--confirm') confirm = true;
      else if (arg === '--trace-id' && rest[index + 1] && !rest[index + 1].startsWith('--')) traceId = validateTraceId(rest[++index]);
      else if (arg === '--route' && rest[index + 1] && !rest[index + 1].startsWith('--')) routes.push(rest[++index]);
      else if (arg === '--url' && rest[index + 1] && !rest[index + 1].startsWith('--')) url = rest[++index];
      else if (arg === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectRoot = rest[++index];
      else if (arg === '--profiles' && rest[index + 1] && !rest[index + 1].startsWith('--')) profiles = parseCsv(rest[++index], '--profiles');
      else if (arg === '--conditions' && rest[index + 1] && !rest[index + 1].startsWith('--')) conditions = parseCsv(rest[++index], '--conditions');
      else if (arg === '--output' && rest[index + 1] && !rest[index + 1].startsWith('--')) outputDir = rest[++index];
      else if (arg === '--baseline-dir' && rest[index + 1] && !rest[index + 1].startsWith('--')) baselineDir = rest[++index];
      else if (arg === '--pixel-threshold' && /^\d+(?:\.\d+)?$/.test(rest[index + 1] || '')) visualPixelThreshold = Number(rest[++index]);
      else if (arg === '--max-changed-percent' && /^\d+(?:\.\d+)?$/.test(rest[index + 1] || '')) visualMaxChangedPercent = Number(rest[++index]);
      else if (arg === '--timeout' && rest[index + 1] && /^\d+$/.test(rest[index + 1])) timeoutMs = Number(rest[++index]) * 1000;
      else throw new Error('Usage: paxi doctor lab run --url <http://localhost:port> [--project <dir>] [--profiles compact,standard] [--conditions font,landscape,dark,keyboard,zoom,offline] [--baseline-dir <dir>] [--update-baseline --confirm] [--pixel-threshold 16] [--max-changed-percent 0.5] [--trace-id <32-hex>] [--route <same-origin-path> ...] [--output <dir>] [--timeout <seconds>] [--json]');
    }
    if (!url) throw new Error('Device Lab browser run requires --url. Start your site yourself, then pass its local or public URL.');
    if (confirm && !updateBaseline) throw new Error('--confirm is only valid together with --update-baseline.');
    const report = await runWebsiteDeviceLab({ url, projectRoot, profiles, conditions, outputDir, baselineDir, updateBaseline, confirmBaselineUpdate: confirm, visualPixelThreshold, visualMaxChangedPercent, timeoutMs, traceId, routes });
    if (json) printJson(report);
    else {
      console.log(`Device Lab browser run: ${report.runId}`);
      console.log(`Target: ${report.targetUrl}`);
      console.log(`Simulated cases: ${report.summary.total} | Passed: ${report.summary.passed} | Review: ${report.summary.review} | Failed: ${report.summary.failed}`);
      console.log(`Evidence: ${report.reportDirectory}`);
      if (report.traceContext?.enabled) console.log(`W3C trace ID: ${report.traceContext.traceId} · ${report.traceContext.scope}`);
      if (report.visualBaseline) console.log(`Visual baseline: ${report.visualBaseline.updated ? 'updated' : `compared (max ${report.visualBaseline.maxChangedPercent}% changed pixels)`} · ${report.visualBaseline.directory}`);
      console.log('This is browser viewport simulation, not a physical-device test.');
    }
    return report;
  }
  if (action === 'profiles') {
    printJson(DEVICE_PROFILES);
    return DEVICE_PROFILES;
  }
  if (action === 'conditions') {
    printJson(DEVICE_CONDITIONS);
    return DEVICE_CONDITIONS;
  }
  if (action === 'presets') {
    const presets = await listLabPresets();
    printJson(presets);
    return presets;
  }
  if (action === 'show') {
    if (rest.length !== 1) throw new Error('Usage: paxi doctor lab show <preset-name>');
    const presets = await listLabPresets();
    const preset = presets.find((item) => item.name.toLowerCase() === rest[0].toLowerCase());
    if (!preset) throw new Error(`Device Lab preset not found: ${rest[0]}`);
    printJson(preset);
    return preset;
  }
  if (action === 'delete') {
    if (rest.length !== 2 || rest[1] !== '--confirm') throw new Error('Usage: paxi doctor lab delete <preset-name> --confirm');
    const deleted = await deleteLabPreset(rest[0]);
    if (!deleted) throw new Error(`Device Lab preset not found: ${rest[0]}`);
    console.log(`✓ Deleted Device Lab preset '${rest[0]}'.`);
    return { deleted: true, name: rest[0] };
  }
  if (action === 'plan') {
    let profiles = ['standard'];
    let conditions = [];
    let saveName = null;
    let presetName = null;
    let json = false;
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === '--profiles' && rest[index + 1] && !rest[index + 1].startsWith('--')) profiles = parseCsv(rest[++index], '--profiles');
      else if (arg === '--conditions' && rest[index + 1] && !rest[index + 1].startsWith('--')) conditions = parseCsv(rest[++index], '--conditions');
      else if (arg === '--save' && rest[index + 1] && !rest[index + 1].startsWith('--')) saveName = rest[++index];
      else if (arg === '--preset' && rest[index + 1] && !rest[index + 1].startsWith('--')) presetName = rest[++index];
      else if (arg === '--json') json = true;
      else throw new Error('Usage: paxi doctor lab plan [--profiles compact,standard] [--conditions font,landscape] [--preset <name>] [--save <name>] [--json]');
    }
    if (presetName) {
      const presets = await listLabPresets();
      const preset = presets.find((item) => item.name.toLowerCase() === presetName.toLowerCase());
      if (!preset) throw new Error(`Device Lab preset not found: ${presetName}`);
      profiles = preset.profiles;
      conditions = preset.conditions;
    }
    const plan = buildLabPlan({ profiles, conditions, presetName });
    if (saveName) {
      await saveLabPreset({ name: saveName, profiles, conditions });
      plan.savedAs = saveName;
    }
    if (json) printJson(plan);
    else {
      console.log(`Device Lab plan${plan.savedAs ? ` saved as '${plan.savedAs}'` : ''}`);
      console.log(`Profiles: ${plan.profiles.map((item) => `${item.id} (${item.label})`).join(', ')}`);
      console.log(`Conditions: ${plan.conditions.map((item) => `${item.id} (${item.description})`).join(', ') || 'default conditions only'}`);
      console.log(`Planned cases: ${plan.plannedCases}`);
      console.log('Status: PLANNED — not executed; no pass/fail result or device evidence has been created.');
      console.log(plan.note);
    }
    return plan;
  }
  throw new Error('Usage: paxi doctor lab <profiles|conditions|plan|presets|show|delete|run|android|android-devices|history|compare>');
}
