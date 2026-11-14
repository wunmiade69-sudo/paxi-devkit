import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { commandExists, runProcess, sanitizedEnvironment } from '../lib/process.mjs';

const MAX_FILES = 100;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY_HELPER = path.resolve(HERE, '../../scripts/sqlite-lab.py');

async function realDirectory(target, label) {
  const info = await fs.lstat(target).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real, non-symlink directory.`);
  return path.resolve(target);
}


async function assertSafeProjectPath(root, target, label) {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} must remain inside the selected project.`);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await fs.lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error(`${label} path cannot traverse symbolic links.`);
  }
}

async function listSqlFiles(directory) {
  const found = [];
  async function walk(current, depth = 0) {
    if (depth > 6) throw new Error('Migration directory nesting exceeds six levels.');
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(current, entry.name);
      const info = await fs.lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`Migration input contains a symbolic link: ${entry.name}`);
      if (info.isDirectory()) await walk(absolute, depth + 1);
      else if (info.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
        if (found.length >= MAX_FILES) throw new Error(`Migration set exceeds ${MAX_FILES} SQL files.`);
        if (info.size > MAX_FILE_BYTES) throw new Error(`Migration file exceeds ${MAX_FILE_BYTES} bytes: ${entry.name}`);
        found.push(absolute);
      }
    }
  }
  await walk(directory);
  return found.sort((a, b) => a.localeCompare(b));
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export async function runDisposableSqliteMigrationLab({ projectPath = process.cwd(), migrationsPath = null, seedSqlPath = null, confirm = false, runner = runProcess, pythonCommand = null } = {}) {
  if (!confirm) throw new Error('Database Lab executes SQL only inside a disposable in-memory SQLite database. Review the migrations and pass --confirm.');
  const root = await realDirectory(path.resolve(projectPath), 'Project root');
  const migrationsRoot = await realDirectory(path.resolve(root, migrationsPath || 'migrations'), 'Migration directory');
  if (!inside(root, migrationsRoot)) throw new Error('Migration directory must be inside the selected project.');
  await assertSafeProjectPath(root, migrationsRoot, 'Migration directory');
  const files = await listSqlFiles(migrationsRoot);
  if (!files.length) throw new Error('No SQL migration files were found in the selected migration directory.');
  const seedPath = seedSqlPath ? path.resolve(root, seedSqlPath) : null;
  if (seedPath && !inside(root, seedPath)) throw new Error('Seed SQL must be a file inside the selected project.');
  if (seedPath) await assertSafeProjectPath(root, seedPath, 'Seed SQL');
  let totalBytes = 0;
  const migrations = [];
  for (const file of files) {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Migration is not a regular file: ${path.basename(file)}`);
    totalBytes += info.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Migration set exceeds ${MAX_TOTAL_BYTES} bytes.`);
    const sql = await fs.readFile(file, 'utf8');
    if (sql.includes('\0')) throw new Error(`Migration contains a NUL byte: ${path.basename(file)}`);
    migrations.push({ name: path.relative(root, file).split(path.sep).join('/'), sha256: createHash('sha256').update(sql).digest('hex'), sql });
  }
  let seed = null;
  if (seedPath) {
    const info = await fs.lstat(seedPath).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) throw new Error('Seed SQL must be a regular, non-symlink file no larger than 512 KiB.');
    seed = await fs.readFile(seedPath, 'utf8');
    if (seed.includes('\0')) throw new Error('Seed SQL contains a NUL byte.');
  }
  const python = pythonCommand || (await commandExists('python3') ? 'python3' : await commandExists('python') ? 'python' : null);
  if (!python) return { schemaVersion: 1, reportType: 'paxi-disposable-database-lab', executionKind: 'in-memory-sqlite-migration-replay', status: 'tool-missing', passed: false, note: 'Python 3 with the standard-library sqlite3 module is required. No SQL was executed.' };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-sqlite-lab-'));
  try {
    const manifestPath = path.join(tempRoot, 'manifest.json');
    const manifest = { schemaVersion: 1, seed, migrations };
    await fs.writeFile(manifestPath, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
    const result = await runner(python, [PY_HELPER, manifestPath], {
      cwd: tempRoot, capture: true, tee: false, timeoutMs: 30000, maxOutputBytes: 1024 * 1024,
      env: { ...sanitizedEnvironment(), PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' }
    });
    let output;
    try { output = JSON.parse(result.stdout || '{}'); } catch { throw new Error(`SQLite Lab helper returned invalid JSON (exit ${result.code}). ${String(result.stderr || result.error || '').slice(0, 400)}`); }
    return {
      ...output,
      executionKind: 'in-memory-sqlite-migration-replay',
      project: path.basename(root),
      migrationDirectory: path.relative(root, migrationsRoot).split(path.sep).join('/'),
      seedUsed: Boolean(seedPath),
      migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })),
      executionExitCode: result.code,
      passed: result.code === 0 && output.passed === true,
      limitations: [
        'SQL was executed only in a disposable in-memory SQLite database; no network or external database connection is created.',
        'This validates SQLite-compatible SQL only. PostgreSQL, MySQL, SQL Server and vendor-specific features require their own disposable database adapter.',
        'A seed SQL file may be used to create the pre-migration schema, but seed and migration statements run under the same SQLite authorizer restrictions.',
        'Passing here does not prove production data safety, query performance, lock behavior, migration rollback compatibility or application-version compatibility.'
      ]
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
