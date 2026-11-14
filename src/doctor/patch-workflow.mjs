import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../lib/process.mjs';
import { runProjectTests } from './project-test-executor.mjs';

async function loadPatch(patchFile) {
  const absolute = path.resolve(patchFile);
  const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error('Patch file must be a regular non-symlink file.');
  if (info.size < 1 || info.size > 2 * 1024 * 1024) throw new Error('Patch file must be between 1 byte and 2 MiB.');
  const content = await fs.readFile(absolute, 'utf8');
  if (!content.startsWith('diff --git ') && !content.startsWith('--- ')) throw new Error('Patch does not look like a unified Git diff.');
  if (/^(?:(?:new|old) file )?mode 120000\s*$/m.test(content) || /^(?:(?:new|old) file )?mode 160000\s*$/m.test(content)) throw new Error('PAXI refuses patches that create symlinks or Git submodules.');
  if (/^GIT binary patch\s*$/m.test(content) || /^Binary files .+ differ\s*$/m.test(content)) throw new Error('Binary patches are not supported by the reviewed-patch workflow.');
  return { absolute, content };
}

async function resolveGitRoot(projectPath) {
  const root = path.resolve(projectPath);
  const result = await runProcess('git', ['rev-parse', '--show-toplevel'], { cwd: root, capture: true, tee: false, timeoutMs: 8000, maxOutputBytes: 8192 });
  if (result.code !== 0) throw new Error('Patch workflow requires a Git repository. Initialize Git or clone the project first.');
  const gitRoot = path.resolve(result.stdout.trim());
  if (gitRoot !== root) throw new Error(`Select the Git repository root for patch review: ${gitRoot}`);
  return root;
}

async function requireCleanTree(root) {
  const status = await runProcess('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, capture: true, tee: false, timeoutMs: 8000, maxOutputBytes: 64 * 1024 });
  if (status.code !== 0) throw new Error(status.stderr || 'Could not inspect Git working-tree state.');
  if (status.stdout.trim()) throw new Error('Patch application requires a clean Git working tree. Commit or stash current changes and remove untracked files before retrying.');
}

export async function reviewPatch({ projectPath = process.cwd(), patchFile } = {}) {
  if (!patchFile) throw new Error('A patch file is required.');
  const root = await resolveGitRoot(projectPath);
  const patch = await loadPatch(patchFile);
  await requireCleanTree(root);
  const check = await runProcess('git', ['apply', '--check', '--whitespace=error', '--', patch.absolute], { cwd: root, capture: true, tee: false, timeoutMs: 15000, maxOutputBytes: 64 * 1024 });
  if (check.code !== 0) throw new Error(`Patch does not apply cleanly:\n${check.stderr || check.stdout}`);
  const stat = await runProcess('git', ['apply', '--stat', '--', patch.absolute], { cwd: root, capture: true, tee: false, timeoutMs: 10000, maxOutputBytes: 64 * 1024 });
  return { patchChecksPassed: true, approvalRequired: true, approvalGranted: false, applied: false, projectRoot: root, patchFile: patch.absolute, patchBytes: Buffer.byteLength(patch.content), diffStat: stat.stdout.trim(), note: 'The diff passed git apply --check. This is not developer approval; inspect the diff and use --confirm to apply it.' };
}

export async function applyReviewedPatch({ projectPath = process.cwd(), patchFile, confirm = false, runTests = false, timeoutMs = 15 * 60 * 1000 } = {}) {
  if (!confirm) throw new Error('Applying a patch modifies project source. Review it, then rerun with --confirm.');
  const review = await reviewPatch({ projectPath, patchFile });
  const applied = await runProcess('git', ['apply', '--whitespace=error', '--', review.patchFile], { cwd: review.projectRoot, capture: true, tee: false, timeoutMs: 15000, maxOutputBytes: 64 * 1024 });
  if (applied.code !== 0) throw new Error(`Patch application failed:\n${applied.stderr || applied.stdout}`);
  const report = { ...review, approvalGranted: true, applied: true, appliedAt: new Date().toISOString(), testRequested: runTests, tests: null };
  if (runTests) {
    report.tests = await runProjectTests({ projectPath: review.projectRoot, confirm: true, timeoutMs });
  }
  report.nextStep = report.tests?.executed && !report.tests.passed
    ? 'Tests did not pass. Review the test output and the Git diff; PAXI did not automatically revert the patch.'
    : 'Review `git diff` and the generated test report. The patch remains a normal uncommitted Git change.';
  return report;
}
