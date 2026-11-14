import fs from 'node:fs/promises';
import path from 'node:path';

const IGNORED = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'target', 'coverage', '.next', '.turbo', '.venv', 'venv', 'Pods']);
const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

function maskSql(source) {
  const chars = source.split('');
  let state = 'code';
  let dollarTag = null;
  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index]; const next = chars[index + 1];
    if (state === 'line-comment') {
      if (current === '\n') state = 'code'; else chars[index] = ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') { chars[index] = ' '; chars[index + 1] = ' '; index += 1; state = 'code'; }
      else if (current !== '\n') chars[index] = ' ';
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'backtick') {
      const closing = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (current === closing) {
        chars[index] = ' ';
        if (next === closing) { chars[index + 1] = ' '; index += 1; }
        else state = 'code';
      } else if (current !== '\n') chars[index] = ' ';
      continue;
    }
    if (state === 'dollar') {
      if (source.startsWith(dollarTag, index)) {
        for (let offset = 0; offset < dollarTag.length; offset += 1) if (chars[index + offset] !== '\n') chars[index + offset] = ' ';
        index += dollarTag.length - 1; state = 'code'; dollarTag = null;
      } else if (current !== '\n') chars[index] = ' ';
      continue;
    }
    if (current === '-' && next === '-') { chars[index] = ' '; chars[index + 1] = ' '; index += 1; state = 'line-comment'; continue; }
    if (current === '/' && next === '*') { chars[index] = ' '; chars[index + 1] = ' '; index += 1; state = 'block-comment'; continue; }
    if (current === "'") { chars[index] = ' '; state = 'single'; continue; }
    if (current === '"') { chars[index] = ' '; state = 'double'; continue; }
    if (current === '`') { chars[index] = ' '; state = 'backtick'; continue; }
    if (current === '$') {
      const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) { dollarTag = match[0]; for (let offset = 0; offset < dollarTag.length; offset += 1) chars[index + offset] = ' '; index += dollarTag.length - 1; state = 'dollar'; }
    }
  }
  return chars.join('');
}

function lineAt(text, index) { return text.slice(0, index).split('\n').length; }

function analyzeMigration(relative, source) {
  const masked = maskSql(source);
  const findings = [];
  const add = (code, severity, index, message, recommendation) => findings.push({ code, severity, confidence: 'high', file: relative, line: lineAt(masked, index), message, recommendation });
  const patterns = [
    { code: 'drop-table-or-schema', severity: 'critical', pattern: /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/gi, message: 'Migration contains a DROP TABLE, DROP SCHEMA or DROP DATABASE operation.', recommendation: 'Confirm the target and data-retention plan; use a staged/deprecation migration and verified backups where appropriate.' },
    { code: 'drop-column', severity: 'high', pattern: /\bALTER\s+TABLE\b[\s\S]{0,300}?\bDROP\s+COLUMN\b/gi, message: 'Migration removes a database column.', recommendation: 'Check all deployed application versions and use an expand/migrate/contract sequence.' },
    { code: 'truncate-table', severity: 'critical', pattern: /\bTRUNCATE\s+(?:TABLE\s+)?[A-Za-z_][\w.$]*/gi, message: 'Migration truncates a table and removes all rows.', recommendation: 'Confirm this is intentional, reversible where required, and safe for production data.' },
    { code: 'create-index-lock-risk', severity: 'review', pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)[A-Za-z_][\w$]*\s+ON\b/gi, message: 'Index creation is not marked CONCURRENTLY; it may block writes on PostgreSQL tables.', recommendation: 'For large live PostgreSQL tables, evaluate CREATE INDEX CONCURRENTLY and your migration framework transaction behavior.' },
    { code: 'alter-column-type', severity: 'warning', pattern: /\bALTER\s+TABLE\b[\s\S]{0,300}?\bALTER\s+(?:COLUMN\s+)?[A-Za-z_][\w$]*\s+TYPE\b/gi, message: 'Migration changes a column type and may rewrite data or hold locks.', recommendation: 'Estimate table size, conversion cost, lock duration and rollback strategy before production rollout.' },
    { code: 'broad-grant', severity: 'warning', pattern: /\bGRANT\s+ALL\s+(?:PRIVILEGES\s+)?ON\b/gi, message: 'Migration grants ALL privileges on a database object.', recommendation: 'Prefer least-privilege grants limited to the roles and operations the application needs.' },
    { code: 'create-extension', severity: 'review', pattern: /\bCREATE\s+EXTENSION\b/gi, message: 'Migration creates a database extension that may require elevated privileges or environment support.', recommendation: 'Verify extension availability and privileges in every target environment.' }
  ];
  for (const rule of patterns) {
    rule.pattern.lastIndex = 0;
    for (const match of masked.matchAll(rule.pattern)) add(rule.code, rule.severity, match.index, rule.message, rule.recommendation);
  }
  const statements = masked.split(';');
  let offset = 0;
  for (const statement of statements) {
    const trimmed = statement.trim();
    if (/^\s*DELETE\s+FROM\b/i.test(trimmed) && !/\bWHERE\b/i.test(trimmed)) {
      const index = offset + statement.search(/\bDELETE\s+FROM\b/i);
      add('delete-without-where', 'critical', index, 'DELETE statement has no WHERE clause before its statement terminator.', 'Review whether a full-table delete is intended; add a verified predicate or use a separately approved data-retention process.');
    }
    if (/^\s*UPDATE\b/i.test(trimmed) && /\bSET\b/i.test(trimmed) && !/\bWHERE\b/i.test(trimmed)) {
      const index = offset + statement.search(/\bUPDATE\b/i);
      add('update-without-where', 'high', index, 'UPDATE statement has no WHERE clause before its statement terminator.', 'Confirm that updating every row is intentional; otherwise add and test a bounded predicate.');
    }
    const notNullMatch = /\bALTER\s+TABLE\b[\s\S]{0,300}?\bADD\s+(?:COLUMN\s+)?[A-Za-z_][\w$]*\b[^,;]*\bNOT\s+NULL\b[^,;]*/i.exec(statement);
    if (notNullMatch && !/\bDEFAULT\b/i.test(notNullMatch[0])) add('add-not-null-without-default', 'warning', offset + notNullMatch.index, 'A NOT NULL column is added without an explicit default or backfill in the same statement.', 'For populated tables, consider adding nullable, backfilling in batches, then adding NOT NULL after validation.');
    offset += statement.length + 1;
  }
  return findings;
}

export async function scanDatabaseMigrations(projectPath = process.cwd()) {
  const root = path.resolve(projectPath);
  const rootInfo = await fs.lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Database migration scan requires a real, non-symlink project directory.');
  const files = []; let bytes = 0; let truncated = false;
  async function walk(directory, relative = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      if (entry.isSymbolicLink()) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!IGNORED.has(entry.name)) await walk(path.join(directory, entry.name), rel); continue; }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.sql') continue;
      const full = path.join(directory, entry.name); const info = await fs.lstat(full).catch(() => null);
      if (!info?.isFile() || info.isSymbolicLink()) continue;
      if (info.size > MAX_FILE_BYTES || bytes + info.size > MAX_TOTAL_BYTES) { truncated = true; continue; }
      files.push({ full, relative: rel, size: info.size }); bytes += info.size;
    }
  }
  await walk(root);
  const findings = [];
  for (const file of files) {
    const source = await fs.readFile(file.full, 'utf8').catch(() => null);
    if (source === null || source.includes('\0')) continue;
    findings.push(...analyzeMigration(file.relative, source));
  }
  const counts = findings.reduce((result, item) => { result[item.severity] = (result[item.severity] || 0) + 1; return result; }, {});
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: path.basename(root),
    executionKind: 'read-only-static-sql-migration-review',
    inventory: { migrationFiles: files.length, bytesScanned: bytes, truncated },
    summary: { findings: findings.length, critical: counts.critical || 0, high: counts.high || 0, warning: counts.warning || 0, review: counts.review || 0 },
    findings,
    limitations: ['SQL files are inspected as text; no database connection, SQL parser, migration runner or schema diff is used.', 'Static patterns can miss unsafe operations and can flag context-dependent operations for human review.', 'The scan cannot prove application compatibility, data backfill correctness, lock duration or rollback safety.', 'No migration is executed or modified.']
  };
}
