import { buildCertificationReport } from '../doctor/certification.mjs';
import { runDiagnosisBenchmark } from '../doctor/diagnosis-benchmark.mjs';
import { runProjectTests } from '../doctor/project-test-executor.mjs';

function printJson(value) { console.log(JSON.stringify(value, null, 2)); }

export async function doctorCertifyCommand(args = []) {
  let projectPath = process.cwd();
  let json = false;
  let runTests = false;
  let confirm = false;
  let timeoutMs = 15 * 60 * 1000;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json') json = true;
    else if (args[index] === '--run-tests') runTests = true;
    else if (args[index] === '--confirm') confirm = true;
    else if (args[index] === '--project' && args[index + 1] && !args[index + 1].startsWith('--')) projectPath = args[++index];
    else if (args[index] === '--timeout' && /^\d+$/.test(args[index + 1] || '')) timeoutMs = Number(args[++index]) * 1000;
    else throw new Error('Usage: paxi doctor certify [--project <directory>] [--run-tests --confirm] [--timeout <seconds>] [--json]');
  }
  if (confirm && !runTests) throw new Error('--confirm is only valid with --run-tests. Certification is read-only by default.');
  if (runTests && !confirm) throw new Error('Running project-controlled test commands requires both --run-tests and explicit --confirm. Inspect the project test command first with: paxi doctor certify --project .');
  if (timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) throw new Error('--timeout must be between 1 and 3600 seconds.');

  const report = await buildCertificationReport({ projectPath });
  if (runTests) {
    report.executionKind = 'local-capability-inventory-plus-user-approved-test-execution';
    report.testExecution = await runProjectTests({ projectPath, confirm, timeoutMs });
    report.testExecution.summary = {
      passed: report.testExecution.passed,
      evidenceComplete: report.testExecution.evidenceComplete,
      outputTruncated: report.testExecution.outputTruncated,
      durationMs: report.testExecution.durationMs
    };
    report.safeguards = [
      'The detected project test command was executed only because the user supplied both --run-tests and --confirm.',
      'Project test scripts are project-controlled code and may perform arbitrary actions allowed to the current user.',
      'Captured output is bounded and secret-pattern redacted; truncated output is explicitly marked incomplete.',
      'A passing test command is not a production-readiness, security or device certification.'
    ];
    if (!report.testExecution.passed || !report.testExecution.evidenceComplete) process.exitCode = 1;
  }
  if (json) printJson(report);
  else {
    console.log(`PAXI environment certification: ${report.project.name}`);
    console.log(`Host: ${report.host.platform}/${report.host.architecture} · Node ${report.host.nodeVersion}${report.host.termux ? ' · Termux' : ''}`);
    console.log(`Project test command: ${report.project.testPlan ? `${report.project.testPlan.command} ${(report.project.testPlan.args || []).join(' ')} (${report.project.testPlan.available ? 'detected, not run' : 'tool missing'})` : 'not detected'}`);
    console.log(`Capability status: ${report.status}`);
    for (const group of report.groups) {
      const available = group.tools.filter((tool) => tool.status === 'available').map((tool) => tool.name);
      const missing = group.tools.filter((tool) => tool.status === 'missing').map((tool) => tool.name);
      console.log(`\n${group.label}: ${available.length ? available.join(', ') : 'none detected'}`);
      if (missing.length) console.log(`  Missing: ${missing.join(', ')}`);
    }
    console.log(`\nBrowser packages: ${report.nodePackages.map((item) => `${item.name}=${item.status}`).join(', ')}`);
    console.log(`CI workflow files: ${report.ci.workflows.length ? report.ci.workflows.join(', ') : 'none detected (hosted checks not established)'}`);
    if (report.testExecution) {
      console.log(`\nProject test execution: ${report.testExecution.status.toUpperCase()}`);
      console.log(`Command: ${report.testExecution.plan ? `${report.testExecution.plan.command} ${(report.testExecution.plan.args || []).join(' ')}` : 'not detected'}`);
      console.log(`Evidence: ${report.testExecution.evidenceComplete ? 'complete within capture limits' : 'incomplete or unavailable'} · ${report.testExecution.outputBytes ?? 0} output bytes`);
      if (report.testExecution.note) console.log(report.testExecution.note);
      if (report.testExecution.output?.stdout) console.log(`\nstdout:\n${report.testExecution.output.stdout}`);
      if (report.testExecution.output?.stderr) console.error(`\nstderr:\n${report.testExecution.output.stderr}`);
    } else {
      console.log('\nRead-only inventory only. No project scripts, scanners, builds, browsers, databases or devices were executed.');
    }
    console.log('\nThis report is not a production-readiness or security certification.');
  }
  return report;
}

export async function doctorBenchmarkCommand(args = []) {
  const [benchmark, ...rest] = args;
  if (benchmark !== 'diagnosis') throw new Error('Usage: paxi doctor benchmark diagnosis [--json]');
  let json = false;
  for (const arg of rest) {
    if (arg === '--json') json = true;
    else throw new Error('Usage: paxi doctor benchmark diagnosis [--json]');
  }
  const report = runDiagnosisBenchmark();
  if (json) printJson(report);
  else {
    console.log(`PAXI diagnosis benchmark: ${report.status}`);
    console.log(`Dataset: ${report.datasetVersion} · ${report.summary.cases} synthetic cases · ${report.executionKind}`);
    console.log(`Accuracy: ${(report.summary.accuracy * 100).toFixed(1)}% · Precision: ${(report.summary.precision * 100).toFixed(1)}% · Recall: ${(report.summary.recall * 100).toFixed(1)}% · F1: ${(report.summary.f1 * 100).toFixed(1)}%`);
    console.log(`Exact case matches: ${report.summary.exactCases}/${report.summary.cases} · FP: ${report.summary.falsePositive} · FN: ${report.summary.falseNegative}`);
    for (const sample of report.cases.filter((item) => !item.exactMatch)) console.log(`  [REVIEW] ${sample.id}: FP=${sample.falsePositives.join(',') || 'none'} FN=${sample.falseNegatives.join(',') || 'none'}`);
    console.log('\nThis measures deterministic log-signature classification, not LLM diagnosis or patch quality.');
  }
  if (report.status !== 'passed') process.exitCode = 1;
  return report;
}
