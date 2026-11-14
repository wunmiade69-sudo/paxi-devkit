import fs from 'node:fs/promises';
import path from 'node:path';

const reportPath = process.argv[2];
if (!reportPath) throw new Error('Usage: node scripts/assert-database-lab-report.mjs <report.json>');
const absolute = path.resolve(reportPath);
const info = await fs.lstat(absolute);
if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) throw new Error('Database CI report must be a regular JSON file no larger than 2 MiB.');
const report = JSON.parse(await fs.readFile(absolute, 'utf8'));
const checks = {
  reportType: report.reportType === 'paxi-disposable-service-database-lab',
  status: report.status === 'passed',
  passed: report.passed === true,
  cleanupComplete: report.cleanupComplete === true,
  migrationReplayPassed: report.migrationReplayPassed === true,
  schemaComparisonAvailable: ['changed', 'unchanged'].includes(report.schemaComparison?.status)
};
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
console.log(JSON.stringify({ reportType: 'paxi-database-ci-acceptance', engine: report.engine || null, checks, passed: failed.length === 0 }, null, 2));
if (failed.length) throw new Error(`Database integration acceptance failed: ${failed.join(', ')}`);
