import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { commandExists } from '../lib/process.mjs';
import { detectProjectTestCommand } from './project-test-executor.mjs';

const TOOL_GROUPS = Object.freeze([
  { id: 'core', label: 'Core development', tools: ['node', 'npm', 'pnpm', 'yarn', 'bun', 'git', 'python', 'python3', 'bash'] },
  { id: 'android', label: 'Android', tools: ['adb', 'java', 'gradle', 'flutter', 'dart'] },
  { id: 'web', label: 'Website and browser QA', tools: ['playwright', 'chromium', 'google-chrome', 'firefox'] },
  { id: 'cpp', label: 'C/C++', tools: ['cmake', 'ctest', 'clang++', 'g++'] },
  { id: 'rust-go', label: 'Rust and Go', tools: ['cargo', 'rustc', 'go', 'govulncheck'] },
  { id: 'python-php', label: 'Python and PHP', tools: ['pytest', 'pip-audit', 'php', 'composer', 'phpunit', 'ruby', 'bundle'] },
  { id: 'jvm-dotnet', label: 'Java and .NET', tools: ['mvn', 'dotnet', 'sqlcmd'] },
  { id: 'security', label: 'Supply-chain security', tools: ['syft', 'osv-scanner'] },
  { id: 'databases', label: 'Database clients', tools: ['psql', 'mysql', 'mariadb', 'sqlcmd'] },
  { id: 'ios', label: 'Apple platforms', tools: ['swift', 'xcodebuild', 'xcrun'] }
]);

async function safePackageResolve(root, packageName) {
  try {
      return require.resolve(packageName);
  } catch { return null; }
}

function classifyOverall(testPlan) {
  if (testPlan?.available === false) return 'blocked';
  if (!testPlan) return 'partial';
  return 'ready-for-test';
}

/** Read-only inventory: it does not invoke project test scripts or run external tool versions. */
export async function buildCertificationReport({ projectPath = process.cwd(), exists = commandExists } = {}) {
  const root = path.resolve(projectPath);
  const rootInfo = await fs.lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Certification requires a real, non-symlink project directory.');

  const [testPlan, toolRows] = await Promise.all([
    detectProjectTestCommand(root, { exists }),
    Promise.all([...new Set(TOOL_GROUPS.flatMap((group) => group.tools))].map(async (name) => ({ name, status: await exists(name) ? 'available' : 'missing' })))
  ]);
  const nodePackages = ['playwright', '@playwright/test', 'axe-core'];
  const packageChecks = await Promise.all(nodePackages.map(async (name) => ({ name, status: await safePackageResolve(root, name) ? 'available' : 'missing' })));
  const workflowsPath = path.join(root, '.github', 'workflows');
  const workflowsInfo = await fs.lstat(workflowsPath).catch(() => null);
  const workflows = workflowsInfo?.isDirectory() && !workflowsInfo.isSymbolicLink()
    ? (await fs.readdir(workflowsPath)).filter((name) => /\.(?:yml|yaml)$/i.test(name)).sort()
    : [];
  const groupReports = TOOL_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    tools: toolRows.filter((tool) => group.tools.includes(tool.name))
  }));
  const framework = testPlan?.framework || null;
  const status = classifyOverall(testPlan);
  return {
    schemaVersion: 1,
    reportType: 'paxi-environment-certification',
    createdAt: new Date().toISOString(),
    executionKind: 'read-only-local-capability-inventory',
    project: { name: path.basename(root), framework, testPlan: testPlan ? { id: testPlan.id, command: testPlan.command, args: testPlan.args, available: testPlan.available !== false, reason: testPlan.reason } : null },
    host: { platform: process.platform, architecture: process.arch, nodeVersion: process.version, termux: Boolean(process.env.PREFIX?.includes('com.termux') || process.env.TERMUX_VERSION) },
    status,
    groups: groupReports,
    nodePackages: packageChecks,
    ci: { configured: workflows.length > 0, workflows },
    summary: {
      toolsAvailable: toolRows.filter((item) => item.status === 'available').length,
      toolsMissing: toolRows.filter((item) => item.status === 'missing').length,
      nodePackagesAvailable: packageChecks.filter((item) => item.status === 'available').length,
      testCommand: testPlan ? (testPlan.available === false ? 'tool-missing' : 'detected-not-run') : 'not-detected'
    },
    safeguards: [
      'Read-only inventory only: no project test, build, scanner, browser, database or device command was executed.',
      'Available means an executable or package was found, not that it works or passed a test.',
      'CI workflow files being present does not mean hosted CI has run or passed.',
      'This report is not a production-readiness or security certification.'
    ]
  };
}
