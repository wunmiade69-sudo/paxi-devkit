import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { commandExists, runProcess, sanitizedEnvironment } from '../lib/process.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';

const ENGINE_CONFIG = Object.freeze({
  postgres: { env: 'PAXI_TEST_POSTGRES_ADMIN_URL', protocol: 'postgres:', command: 'psql', adminDatabase: 'postgres' },
  mysql: { env: 'PAXI_TEST_MYSQL_ADMIN_URL', protocol: 'mysql:', command: 'mysql', adminDatabase: 'mysql' },
  mariadb: { env: 'PAXI_TEST_MARIADB_ADMIN_URL', protocol: 'mariadb:', command: 'mariadb', adminDatabase: 'mysql' },
  sqlserver: { env: 'PAXI_TEST_SQLSERVER_ADMIN_URL', protocol: 'mssql:', command: 'sqlcmd', adminDatabase: 'master' }
});
const MAX_FILES = 100;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function safeIdentifier(prefix) { return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 24)}`; }
function quotePgIdentifier(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function quotePgLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function quoteMyIdentifier(value) { return `\`${String(value).replaceAll('`', '``')}\``; }
function escapePgPass(value) { return String(value).replaceAll('\\', '\\\\').replaceAll(':', '\\:').replace(/[\r\n]/g, ''); }

function parseAdminUrl(raw, engine) {
  const config = ENGINE_CONFIG[engine];
  if (!config) throw new Error('Database engine must be postgres, mysql, mariadb or sqlserver.');
  if (!raw || typeof raw !== 'string' || raw.length > 4096) throw new Error(`Set ${config.env} to a dedicated local database administrator URL. The URL is read from the environment and never printed.`);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${config.env} must be a valid database URL.`); }
  const acceptedProtocols = engine === 'postgres' ? new Set(['postgres:', 'postgresql:']) : engine === 'mariadb' ? new Set(['mariadb:', 'mysql:']) : engine === 'sqlserver' ? new Set(['mssql:', 'sqlserver:']) : new Set(['mysql:']);
  if (!acceptedProtocols.has(url.protocol)) throw new Error(`${config.env} must use ${[...acceptedProtocols].join(' or ')}`);
  if (!LOOPBACK.has(url.hostname.toLowerCase())) throw new Error('External database hosts are blocked. Database Lab only connects to localhost/loopback test services.');
  if (url.username.length === 0 || !url.password || /[\r\n\0]/.test(decodeURIComponent(url.password))) throw new Error('Database administrator URL must contain a username and password without control characters.');
  if (url.search || url.hash) throw new Error('Database administrator URL query options and fragments are not supported.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database || database.includes('/')) throw new Error(`Database URL must select the ${config.adminDatabase} administration database.`);
  return {
    host: (url.hostname.replace(/^\[|\]$/g, '').toLowerCase() === 'localhost' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g, '')),
    port: Number(url.port || (engine === 'postgres' ? 5432 : engine === 'sqlserver' ? 1433 : 3306)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database
  };
}

async function realDirectory(target, label) {
  const info = await fs.lstat(target).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real, non-symlink directory.`);
  return path.resolve(target);
}

async function assertInside(root, target, label) {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} must remain inside the selected project.`);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await fs.lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error(`${label} cannot traverse symbolic links.`);
  }
}

async function readMigrationSet(root, migrationsPath, seedSqlPath) {
  const migrationsRoot = await realDirectory(path.resolve(root, migrationsPath || 'migrations'), 'Migration directory');
  await assertInside(root, migrationsRoot, 'Migration directory');
  const files = [];
  async function walk(current, depth = 0) {
    if (depth > 6) throw new Error('Migration directory nesting exceeds six levels.');
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(current, entry.name);
      const stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Migration input contains a symbolic link: ${entry.name}`);
      if (stat.isDirectory()) await walk(absolute, depth + 1);
      else if (stat.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
        if (stat.size > MAX_FILE_BYTES) throw new Error(`Migration file exceeds ${MAX_FILE_BYTES} bytes: ${entry.name}`);
        if (files.length >= MAX_FILES) throw new Error(`Migration set exceeds ${MAX_FILES} SQL files.`);
        files.push(absolute);
      }
    }
  }
  await walk(migrationsRoot);
  files.sort((a, b) => a.localeCompare(b));
  if (!files.length) throw new Error('No SQL migrations were found.');
  let total = 0;
  const migrations = [];
  for (const file of files) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Migration must be a regular file: ${path.basename(file)}`);
    total += stat.size;
    if (total > MAX_TOTAL_BYTES) throw new Error('Migration set exceeds 10 MiB.');
    const sql = await fs.readFile(file, 'utf8');
    if (sql.includes('\0')) throw new Error(`Migration contains a NUL byte: ${path.basename(file)}`);
    migrations.push({ name: path.relative(root, file).split(path.sep).join('/'), sql, sha256: createHash('sha256').update(sql).digest('hex') });
  }
  let seed = null;
  if (seedSqlPath) {
    const file = path.resolve(root, seedSqlPath);
    await assertInside(root, file, 'Seed SQL');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw new Error('Seed SQL must be a regular file no larger than 512 KiB.');
    seed = await fs.readFile(file, 'utf8');
    if (seed.includes('\0')) throw new Error('Seed SQL contains a NUL byte.');
  }
  return { migrationsRoot, migrations, seed };
}

function rejectClientDirectives(sql, engine, label) {
  const lines = sql.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (engine === 'postgres' && /^\s*\\/.test(line)) throw new Error(`${label} contains a psql meta-command on line ${index + 1}; client commands are blocked.`);
    if (engine !== 'postgres' && (/^\s*\\/.test(line) || /^\s*(?:SOURCE|\.\s+\S+)/i.test(line))) throw new Error(`${label} contains a MySQL client command on line ${index + 1}; client commands are blocked.`);
  }
  if (engine !== 'postgres' && /\bLOAD\s+DATA\s+LOCAL\s+INFILE\b|\bINTO\s+(?:OUTFILE|DUMPFILE)\b|\bLOAD_FILE\s*\(|\bCREATE\s+SERVER\b|\bINSTALL\s+(?:PLUGIN|COMPONENT)\b|\bSONAME\b/i.test(sql)) throw new Error(`${label} contains a MySQL file, external-server or plugin operation; these operations are blocked.`);
  if (engine === 'postgres' && (/\bCOPY\b[\s\S]{0,500}?\bPROGRAM\b/i.test(sql) || /\b(?:CREATE|ALTER|DROP)\s+(?:EXTENSION|SERVER|FOREIGN\s+DATA\s+WRAPPER|USER\s+MAPPING|SUBSCRIPTION)\b|\bIMPORT\s+FOREIGN\s+SCHEMA\b|\bALTER\s+SYSTEM\b/i.test(sql))) throw new Error(`${label} contains a PostgreSQL external-access or server-configuration operation; these operations are blocked.`);
}

function mysqlDefaults(config, database = '') {
  const safe = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '');
  return `[client]\nhost="${safe(config.host)}"\nport=${config.port}\nuser="${safe(config.user)}"\npassword="${safe(config.password)}"\nprotocol=tcp\nconnect-timeout=5\nlocal-infile=0\n${database ? `database="${safe(database)}"\n` : ''}`;
}

async function writePrivateFile(dir, name, content) {
  const file = path.join(dir, name);
  await fs.writeFile(file, content, { flag: 'wx', mode: 0o600 });
  if (process.platform !== 'win32') await fs.chmod(file, 0o600);
  return file;
}

function baseEnvironment() {
  const env = sanitizedEnvironment();
  delete env.PAXI_TEST_POSTGRES_ADMIN_URL;
  delete env.PAXI_TEST_MYSQL_ADMIN_URL;
  delete env.PAXI_TEST_MARIADB_ADMIN_URL;
  delete env.PAXI_TEST_SQLSERVER_ADMIN_URL;
  delete env.PAXI_TEST_SQLSERVER_TRUST_SERVER_CERTIFICATE;
  delete env.SQLCMDPASSWORD;
  delete env.PGPASSWORD;
  delete env.PGPASSFILE;
  delete env.MYSQL_PWD;
  delete env.MYSQL_TEST_LOGIN_FILE;
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  delete env.PGOPTIONS;
  return env;
}

function sqlServerBatch(sql) {
  return `${String(sql ?? '').replace(/\s*$/, '')}\nGO\n`;
}

function schemaCatalogQuery(engine) {
  if (engine === 'postgres') return `/* PAXI_SCHEMA_CATALOG */
SELECT signature FROM (
  SELECT concat_ws('|', 'column', table_schema, table_name, column_name, data_type, udt_name, is_nullable, COALESCE(column_default, '')) AS signature
  FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT concat_ws('|', 'index', schemaname, tablename, indexname, indexdef) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT concat_ws('|', 'constraint', tc.constraint_schema, tc.table_name, tc.constraint_name, tc.constraint_type, COALESCE(kcu.column_name, ''))
  FROM information_schema.table_constraints tc LEFT JOIN information_schema.key_column_usage kcu
    ON tc.constraint_catalog = kcu.constraint_catalog AND tc.constraint_schema = kcu.constraint_schema
    AND tc.constraint_name = kcu.constraint_name AND tc.table_name = kcu.table_name
  WHERE tc.constraint_schema NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT concat_ws('|', 'view', table_schema, table_name, COALESCE(view_definition, '')) FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT concat_ws('|', 'trigger', trigger_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement) FROM information_schema.triggers WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT concat_ws('|', 'routine', routine_schema, routine_name, routine_type, COALESCE(routine_definition, '')) FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
) catalog ORDER BY signature;`;
  if (engine === 'mysql' || engine === 'mariadb') return `/* PAXI_SCHEMA_CATALOG */
SELECT signature FROM (
  SELECT CONCAT_WS('|', 'column', table_schema, table_name, column_name, column_type, is_nullable, COALESCE(column_default, ''), extra, COALESCE(generation_expression, '')) AS signature
  FROM information_schema.columns WHERE table_schema = DATABASE()
  UNION ALL
  SELECT CONCAT_WS('|', 'index', table_schema, table_name, index_name, seq_in_index, COALESCE(column_name, ''), non_unique, index_type)
  FROM information_schema.statistics WHERE table_schema = DATABASE()
  UNION ALL
  SELECT CONCAT_WS('|', 'constraint', tc.constraint_schema, tc.table_name, tc.constraint_name, tc.constraint_type, COALESCE(kcu.column_name, ''))
  FROM information_schema.table_constraints tc LEFT JOIN information_schema.key_column_usage kcu
    ON tc.constraint_schema = kcu.constraint_schema AND tc.table_name = kcu.table_name AND tc.constraint_name = kcu.constraint_name
  WHERE tc.constraint_schema = DATABASE()
  UNION ALL
  SELECT CONCAT_WS('|', 'view', table_schema, table_name, COALESCE(view_definition, '')) FROM information_schema.views WHERE table_schema = DATABASE()
  UNION ALL
  SELECT CONCAT_WS('|', 'trigger', trigger_schema, event_object_table, trigger_name, action_timing, event_manipulation, action_statement) FROM information_schema.triggers WHERE trigger_schema = DATABASE()
  UNION ALL
  SELECT CONCAT_WS('|', 'routine', routine_schema, routine_name, routine_type, COALESCE(routine_definition, '')) FROM information_schema.routines WHERE routine_schema = DATABASE()
) catalog ORDER BY signature;`;
  if (engine === 'sqlserver') return `/* PAXI_SCHEMA_CATALOG */
SELECT signature FROM (
  SELECT CONCAT('column|', SCHEMA_NAME(t.schema_id), '|', t.name, '|', c.name, '|', ty.name, '|', c.max_length, '|', c.precision, '|', c.scale, '|', c.is_nullable, '|', COALESCE(dc.definition, ''), '|', COALESCE(cc.definition, '')) AS signature
  FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id
  LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
  LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
  UNION ALL
  SELECT CONCAT('index|', SCHEMA_NAME(t.schema_id), '|', t.name, '|', i.name, '|', i.type_desc, '|', i.is_unique, '|', i.is_primary_key, '|', ic.key_ordinal, '|', ic.is_included_column, '|', COALESCE(c.name, ''))
  FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  LEFT JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id WHERE i.index_id > 0
  UNION ALL
  SELECT CONCAT('constraint|', SCHEMA_NAME(t.schema_id), '|', t.name, '|', o.name, '|', o.type_desc, '|', COALESCE(ch.definition, ''))
  FROM sys.objects o JOIN sys.tables t ON t.object_id = o.parent_object_id LEFT JOIN sys.check_constraints ch ON ch.object_id = o.object_id
  WHERE o.type IN ('C', 'D', 'F', 'PK', 'UQ')
  UNION ALL
  SELECT CONCAT('module|', SCHEMA_NAME(o.schema_id), '|', o.name, '|', o.type_desc, '|', COALESCE(m.definition, ''))
  FROM sys.objects o JOIN sys.sql_modules m ON m.object_id = o.object_id WHERE o.type IN ('V', 'TR', 'P', 'FN', 'IF', 'TF')
) catalog ORDER BY signature;`;
  throw new Error('Unsupported database engine for schema catalog inspection.');
}

export async function runDisposableServiceMigrationLab({ engine, projectPath = process.cwd(), migrationsPath = null, seedSqlPath = null, confirm = false, env = process.env, runner = runProcess, exists = commandExists, timeoutMs = 30000 } = {}) {
  if (!confirm) throw new Error('Service Database Lab can create and destroy a dedicated local database and user. Review the project and pass --confirm.');
  const config = ENGINE_CONFIG[engine];
  if (!config) throw new Error('Database engine must be postgres, mysql, mariadb or sqlserver.');
  const admin = parseAdminUrl(env[config.env], engine);
  if (!Number.isInteger(admin.port) || admin.port < 1 || admin.port > 65535) throw new Error('Database URL port is invalid.');
  if (engine === 'postgres' && admin.database !== 'postgres') throw new Error('PostgreSQL admin URL must target the postgres maintenance database.');
  if (['mysql','mariadb'].includes(engine) && admin.database !== 'mysql') throw new Error('MySQL/MariaDB admin URL must target the mysql system database.');
  if (engine === 'sqlserver' && admin.database !== 'master') throw new Error('SQL Server admin URL must target the master database.');
  const root = await realDirectory(path.resolve(projectPath), 'Project root');
  const { migrations, seed } = await readMigrationSet(root, migrationsPath, seedSqlPath);
  // MySQL limits account names to 32 characters; retain 96 random bits while
  // shortening only this engine's username prefix.
  const role = safeIdentifier(engine === 'mysql' ? 'pxrole' : 'paxi_role');
  const database = safeIdentifier('paxi_test');
  const password = randomBytes(24).toString('hex');
  for (const migration of migrations) {
    rejectClientDirectives(migration.sql, engine === 'sqlserver' ? 'mysql' : engine, migration.name);
    if (engine === 'sqlserver') rejectSqlServerOperations(migration.sql, migration.name);
  }
  if (seed) { rejectClientDirectives(seed, engine === 'sqlserver' ? 'mysql' : engine, '<seed-schema>'); if (engine === 'sqlserver') rejectSqlServerOperations(seed, '<seed-schema>'); }
  const executable = config.command;
  if (!(await exists(executable))) return { schemaVersion: 1, reportType: 'paxi-disposable-service-database-lab', engine, status: 'tool-missing', passed: false, cleanupComplete: true, note: `Install ${executable} deliberately. No database connection or SQL execution occurred.` };

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-service-db-lab-'));
  let adminCredentialFile = null;
  let testCredentialFile = null;
  let roleCreated = false;
  let databaseCreated = false;
  let passed = true;
  let failedMigration = null;
  const results = [];
  const startedAt = Date.now();
  const envBase = baseEnvironment();
  const invoke = async ({ databaseName, user, args, stdin, extraEnv = {}, maxOutputBytes = 128 * 1024 }) => runner(executable, args, {
    cwd: tempRoot, capture: true, tee: false, timeoutMs, maxOutputBytes,
    stdin: engine === 'sqlserver' ? sqlServerBatch(stdin) : stdin,
    env: { ...envBase, ...extraEnv }
  });

  try {
    if (engine === 'sqlserver') {
      // sqlcmd accepts SQLCMDPASSWORD through its environment; do not place passwords in argv.
      adminCredentialFile = null;
      testCredentialFile = null;
    } else if (engine === 'postgres') {
      // The administrator also connects to the generated database to grant
      // its test role scoped access, so its private pgpass record must match
      // both the maintenance and generated database names.
      const passContent = `${escapePgPass(admin.host)}:${admin.port}:*:${escapePgPass(admin.user)}:${escapePgPass(admin.password)}\n`;
      adminCredentialFile = await writePrivateFile(tempRoot, 'admin.pgpass', passContent);
      testCredentialFile = await writePrivateFile(tempRoot, 'test.pgpass', `${passContent}${escapePgPass(admin.host)}:${admin.port}:${escapePgPass(database)}:${escapePgPass(role)}:${password}\n`);
    } else {
      adminCredentialFile = await writePrivateFile(tempRoot, 'admin.cnf', mysqlDefaults(admin));
      testCredentialFile = await writePrivateFile(tempRoot, 'test.cnf', mysqlDefaults({ ...admin, user: role, password }, database));
    }

    const sqlcmdArgs = (user, databaseName) => {
      const args = ['-S', `tcp:${admin.host},${admin.port}`, '-U', user, '-d', databaseName, '-b', '-r', '1', '-h', '-1', '-W', '-l', '5', '-X'];
      if (env.PAXI_TEST_SQLSERVER_TRUST_SERVER_CERTIFICATE === '1') args.push('-C');
      return args;
    };
    const adminArgs = (databaseName) => engine === 'postgres'
      ? ['-X', '-v', 'ON_ERROR_STOP=1', '-h', admin.host, '-p', String(admin.port), '-U', admin.user, '-d', databaseName]
      : engine === 'sqlserver' ? sqlcmdArgs(admin.user, databaseName)
        : [`--defaults-file=${adminCredentialFile}`, '--batch', '--skip-column-names', '--local-infile=0', `--database=${databaseName}`];
    const testArgs = () => engine === 'postgres'
      ? ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', admin.host, '-p', String(admin.port), '-U', role, '-d', database]
      : engine === 'sqlserver' ? sqlcmdArgs(role, database)
        : [`--defaults-file=${testCredentialFile}`, '--batch', '--skip-column-names', '--local-infile=0', `--database=${database}`];
    const callAdmin = async (databaseName, sql) => {
      const args = adminArgs(databaseName);
      const extraEnv = engine === 'postgres' ? { PGPASSFILE: adminCredentialFile, PGPASSFILE_TEST: testCredentialFile, PGCONNECT_TIMEOUT: '5' } : engine === 'sqlserver' ? { SQLCMDPASSWORD: admin.password } : {};
      return invoke({ databaseName, user: admin.user, args, stdin: sql, extraEnv });
    };
    const callTest = async (sql, { maxOutputBytes = 128 * 1024 } = {}) => {
      const args = testArgs();
      const extraEnv = engine === 'postgres' ? { PGPASSFILE: testCredentialFile, PGCONNECT_TIMEOUT: '5' } : engine === 'sqlserver' ? { SQLCMDPASSWORD: password } : {};
      return invoke({ databaseName: database, user: role, args, stdin: sql, extraEnv, maxOutputBytes });
    };

    if (engine === 'sqlserver') {
      let result = await callAdmin(admin.database, `CREATE LOGIN ${quoteSqlServerIdentifier(role)} WITH PASSWORD = ${quoteSqlServerLiteral(password)}, CHECK_POLICY = OFF, CHECK_EXPIRATION = OFF;`);
      if (result.code !== 0) throw new Error(`Could not create isolated SQL Server test login (exit ${result.code}). ${redactSensitiveText(result.stderr || result.error || '').text.slice(0, 300)}`);
      roleCreated = true;
      result = await callAdmin(admin.database, `CREATE DATABASE ${quoteSqlServerIdentifier(database)};`);
      if (result.code !== 0) throw new Error(`Could not create isolated SQL Server test database (exit ${result.code}). ${redactSensitiveText(result.stderr || result.error || '').text.slice(0, 300)}`);
      databaseCreated = true;
      // A newly created SQL Server database may be created successfully but
      // not yet be ONLINE for an immediate connection using `-d`.
      let databaseOnline = false;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const readiness = await callAdmin(admin.database, `SET NOCOUNT ON; SELECT state_desc FROM sys.databases WHERE name = N'${database}';`);
        if (readiness.code !== 0) throw new Error(`Could not verify the isolated SQL Server database state. ${redactSensitiveText(readiness.stderr || readiness.error || '').text.slice(0, 300)}`);
        if (String(readiness.stdout || '').trim().split(/\r?\n/).some((line) => line.trim() === 'ONLINE')) { databaseOnline = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!databaseOnline) throw new Error('The isolated SQL Server database did not reach ONLINE state within 5 seconds.');
      result = await callAdmin(database, `CREATE USER ${quoteSqlServerIdentifier(role)} FOR LOGIN ${quoteSqlServerIdentifier(role)}; ALTER ROLE [db_owner] ADD MEMBER ${quoteSqlServerIdentifier(role)};`);
      if (result.code !== 0) throw new Error(`Could not scope SQL Server test login to the disposable database (exit ${result.code}). ${redactSensitiveText(result.stderr || result.error || '').text.slice(0, 300)}`);
    } else if (engine === 'postgres') {
      let result = await callAdmin(admin.database, `CREATE ROLE ${quotePgIdentifier(role)} LOGIN PASSWORD ${quotePgLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;`);
      if (result.code !== 0) throw new Error(`Could not create isolated PostgreSQL test role (exit ${result.code}). ${redactSensitiveText(result.stderr || result.error || '').text.slice(0, 300)}`);
      roleCreated = true;
      // PostgreSQL 16+ requires the caller to be able to SET ROLE to the
      // requested owner. Keep ownership with the configured admin instead
      // of granting it membership in the generated, restricted test role.
      result = await callAdmin(admin.database, `CREATE DATABASE ${quotePgIdentifier(database)} OWNER ${quotePgIdentifier(admin.user)} TEMPLATE template0;`);
      if (result.code !== 0) throw new Error(`Could not create isolated PostgreSQL test database (exit ${result.code}). ${redactSensitiveText(result.stderr || result.error || '').text.slice(0, 300)}`);
      databaseCreated = true;
      result = await callAdmin(database, `GRANT CONNECT, CREATE, TEMPORARY ON DATABASE ${quotePgIdentifier(database)} TO ${quotePgIdentifier(role)}; GRANT USAGE, CREATE ON SCHEMA public TO ${quotePgIdentifier(role)};`);
      if (result.code !== 0) throw new Error(`Could not grant privileges on the isolated PostgreSQL test database (exit ${result.code}). ${redactSensitiveText(result.stderr || result.error || '').text.slice(0, 300)}`);
    } else {
      const hostAccount = admin.host === '::1' ? '::1' : '127.0.0.1';
      let result = await callAdmin(admin.database, `CREATE USER '${role}'@'${hostAccount}' IDENTIFIED BY '${password}';`);
      if (result.code !== 0) throw new Error(`Could not create isolated ${engine} test user (exit ${result.code}). ${redactSensitiveText(result.stderr || result.error || '').text.slice(0, 300)}`);
      roleCreated = true;
      result = await callAdmin(admin.database, `CREATE DATABASE ${quoteMyIdentifier(database)} CHARACTER SET utf8mb4;`);
      if (result.code !== 0) throw new Error(`Could not create isolated ${engine} test database (exit ${result.code}). ${redactSensitiveText(result.stderr || result.error || '').text.slice(0, 300)}`);
      databaseCreated = true;
      result = await callAdmin(admin.database, `GRANT ALL PRIVILEGES ON ${quoteMyIdentifier(database)}.* TO '${role}'@'${hostAccount}';`);
      if (result.code !== 0) throw new Error(`Could not grant privileges on the isolated ${engine} database (exit ${result.code}). ${redactSensitiveText(result.stderr || result.error || '').text.slice(0, 300)}`);
    }

    const snapshot = async () => {
      const sql = engine === 'postgres'
        ? "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema'); SELECT count(*) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema'); SELECT count(*) FROM information_schema.table_constraints WHERE constraint_schema NOT IN ('pg_catalog','information_schema'); SELECT count(*) FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog','information_schema'); SELECT count(*) FROM information_schema.triggers WHERE trigger_schema NOT IN ('pg_catalog','information_schema'); SELECT count(*) FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog','information_schema');"
        : engine === 'sqlserver'
          ? "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.tables; SELECT COUNT(*) FROM sys.indexes WHERE index_id > 0; SELECT (SELECT COUNT(*) FROM sys.check_constraints) + (SELECT COUNT(*) FROM sys.default_constraints) + (SELECT COUNT(*) FROM sys.foreign_keys) + (SELECT COUNT(*) FROM sys.key_constraints); SELECT COUNT(*) FROM sys.views; SELECT COUNT(*) FROM sys.triggers; SELECT COUNT(*) FROM sys.procedures;"
          : "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'; SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE(); SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = DATABASE(); SELECT COUNT(*) FROM information_schema.views WHERE table_schema = DATABASE(); SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = DATABASE(); SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = DATABASE();";
      const result = await callTest(sql);
      if (result.code !== 0) return { available: false, error: redactSensitiveText(result.stderr || result.error || '').text.slice(0, 300) };
      const values = String(result.stdout || '').trim().split(/\r?\n/).map((item) => Number(item.trim())).filter(Number.isFinite);
      if (values.length < 2) return { available: false, error: 'Schema summary output could not be parsed.' };
      const counts = { available: true, tables: values[0], indexes: values[1], constraints: values[2] ?? null, views: values[3] ?? null, triggers: values[4] ?? null, routines: values[5] ?? null };
      const catalogResult = await callTest(schemaCatalogQuery(engine), { maxOutputBytes: 2 * 1024 * 1024 });
      if (catalogResult.code !== 0 || catalogResult.timedOut || catalogResult.cancelled || catalogResult.outputTruncated) {
        return { ...counts, catalog: { available: false, reason: catalogResult.outputTruncated ? 'metadata-output-limit-exceeded' : 'metadata-query-unavailable' } };
      }
      const catalogText = String(catalogResult.stdout || '');
      return { ...counts, catalog: { available: true, sha256: createHash('sha256').update(catalogText).digest('hex'), bytes: Buffer.byteLength(catalogText), comparison: 'metadata-content-fingerprint', rawMetadataRetained: false } };
    };
    const before = await snapshot();
    if (!before.available) throw new Error(`Could not inspect the empty test database schema: ${before.error}`);
    if (seed) {
      const result = await callTest(seed);
      results.push({ name: '<seed-schema>', status: result.code === 0 && !result.timedOut ? 'passed' : 'failed', durationMs: result.durationMs || null });
      if (result.code !== 0 || result.timedOut) { passed = false; failedMigration = '<seed-schema>'; }
    }
    if (passed) {
      for (const migration of migrations) {
        const result = await callTest(migration.sql);
        const ok = result.code === 0 && !result.timedOut && !result.cancelled;
        results.push({ name: migration.name, sha256: migration.sha256, status: ok ? 'passed' : result.timedOut ? 'timed-out' : 'failed', durationMs: result.durationMs || null, ...(ok ? {} : { message: redactSensitiveText(result.stderr || result.error || '').text.slice(0, 400) }) });
        if (!ok) { passed = false; failedMigration = migration.name; break; }
      }
    }
    const after = await snapshot();
    const cleanup = await cleanupResources({ engine, admin, adminCredentialFile, database, role, databaseCreated, roleCreated, runner, envBase, tempRoot, executable, timeoutMs, trustServerCertificate: env.PAXI_TEST_SQLSERVER_TRUST_SERVER_CERTIFICATE === '1' });
    databaseCreated = false;
    roleCreated = false;
    const cleanupComplete = cleanup.complete;
    const countKeys = ['tables','indexes','constraints','views','triggers','routines'];
    const countsDiffer = countKeys.some((key) => before[key] !== null && after[key] !== null && before[key] !== after[key]);
    const detailedAvailable = before.catalog?.available === true && after.catalog?.available === true;
    const schemaComparison = detailedAvailable
      ? { status: before.catalog.sha256 === after.catalog.sha256 ? 'unchanged' : 'changed', method: 'metadata-content-fingerprint' }
      : countsDiffer
        ? { status: 'changed', method: 'object-count-fallback', confidence: 'limited' }
        : { status: 'indeterminate', method: 'object-count-fallback', reason: 'Detailed schema metadata was unavailable or exceeded the capture limit.' };
    const migrationReplayPassed = passed;
    const overallPassed = migrationReplayPassed && cleanupComplete && detailedAvailable;
    const overallStatus = !migrationReplayPassed || !cleanupComplete ? 'failed' : detailedAvailable ? 'passed' : 'partial';
    const report = {
      schemaVersion: 1, reportType: 'paxi-disposable-service-database-lab', engine,
      executionKind: 'local-loopback-disposable-database', status: overallStatus,
      passed: overallPassed, migrationReplayPassed, cleanupComplete, durationMs: Date.now() - startedAt,
      database: { generatedName: database, engine, hostScope: 'loopback-only', persistentTarget: false },
      migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })),
      summary: { total: results.length, passed: results.filter((item) => item.status === 'passed').length, failed: results.filter((item) => item.status !== 'passed').length },
      before, after, schemaComparison, schemaChanged: schemaComparison.status === 'changed' ? true : schemaComparison.status === 'unchanged' ? false : null,
      failedMigration, results, cleanup,
      safety: { connectionHostRestrictedToLoopback: true, generatedDatabaseAndUser: true, userPrivilegesScopedToDatabase: true, sqlServerLoginScopedToGeneratedDatabase: engine === 'sqlserver', sqlServerPasswordPassedThroughEnvironment: engine === 'sqlserver', sqlServerServerLevelOperationsBlocked: engine === 'sqlserver', migrationFilesReadOnly: true, credentialsExcludedFromReport: true, externalFileClientCommandsBlocked: true, automaticCleanupAttempted: true },
      limitations: ['A local PostgreSQL/MySQL/MariaDB/SQL Server administrator service must already be running and reachable on loopback; the matching native client must be installed.', 'This is a disposable local database replay, not a production migration rehearsal. Performance, locks, replicas and concurrent application traffic are not tested.', 'Migrations execute with generated test credentials inside the disposable database. Static SQL screening is defense-in-depth, not a formal SQL sandbox; review project SQL and never point the administrator URL at production.', 'Detailed schema metadata is limited to a 2 MiB in-memory capture. If capture is unavailable/truncated, overall status is partial and schema comparison is indeterminate.', 'SQL Server uses sqlcmd and a login scoped to the generated test database. A local self-signed SQL Server certificate is trusted only when PAXI_TEST_SQLSERVER_TRUST_SERVER_CERTIFICATE=1 is explicitly set.']
    };
    return report;
  } catch (error) {
    const cleanup = await cleanupResources({ engine, admin, adminCredentialFile, database, role, databaseCreated, roleCreated, runner, envBase, tempRoot, executable, timeoutMs, trustServerCertificate: env.PAXI_TEST_SQLSERVER_TRUST_SERVER_CERTIFICATE === '1' }).catch((cleanupError) => ({ complete: false, errors: [String(cleanupError.message).slice(0, 250)] }));
    return {
      schemaVersion: 1, reportType: 'paxi-disposable-service-database-lab', engine, executionKind: 'local-loopback-disposable-database',
      status: 'failed', passed: false, cleanupComplete: Boolean(cleanup.complete), durationMs: Date.now() - startedAt,
      summary: { total: results.length, passed: results.filter((item) => item.status === 'passed').length, failed: Math.max(1, results.filter((item) => item.status !== 'passed').length) },
      results, error: redactSensitiveText(error.message).text.slice(0, 500), cleanup,
      safety: { connectionHostRestrictedToLoopback: true, generatedDatabaseAndUser: true, userPrivilegesScopedToDatabase: true, sqlServerLoginScopedToGeneratedDatabase: engine === 'sqlserver', sqlServerPasswordPassedThroughEnvironment: engine === 'sqlserver', sqlServerServerLevelOperationsBlocked: engine === 'sqlserver', credentialsExcludedFromReport: true },
      limitations: ['No production database is supported. The adapter permits loopback hosts only.', 'Cleanup is attempted on partial creation and migration failure; inspect the cleanup report and manually remove any resource named there if cleanupComplete is false.']
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function quoteSqlServerIdentifier(value) { return `[${String(value).replaceAll(']', ']]')}]`; }
function quoteSqlServerLiteral(value) { return `N'${String(value).replaceAll("'", "''")}'`; }

function rejectSqlServerOperations(sql, label) {
  const checks = [
    [/^\s*:/m, 'SQLCMD client directive'],
    [/\b(?:xp_[A-Za-z0-9_]+|sp_OA[A-Za-z0-9_]*|sp_configure|OPENROWSET|OPENDATASOURCE|OPENQUERY|BULK\s+INSERT)\b/i, 'external access or server command'],
    [/\b(?:CREATE|ALTER|DROP)\s+(?:LOGIN|SERVER|CREDENTIAL|ENDPOINT|AVAILABILITY\s+GROUP|EXTERNAL\s+DATA\s+SOURCE|EXTERNAL\s+FILE\s+FORMAT|ASSEMBLY)\b/i, 'server-level security, external-access or assembly DDL'],
    [/\b(?:CREATE|ALTER|DROP)\s+DATABASE\b|\bALTER\s+SERVER\b|\bSHUTDOWN\b|\b(?:BACKUP|RESTORE)\s+DATABASE\b|\bDBCC\b|\bRECONFIGURE\b/i, 'server/database administration command'],
    [/\bEXEC(?:UTE)?\s+AS\s+LOGIN\b/i, 'server login impersonation'],
    [/^\s*USE\s+/im, 'database context switch']
  ];
  for (const [pattern, labelText] of checks) if (pattern.test(sql)) throw new Error(`${label} contains a blocked SQL Server ${labelText}.`);
}

async function cleanupResources({ engine, admin, adminCredentialFile, database, role, databaseCreated, roleCreated, runner, envBase, tempRoot, executable, timeoutMs, trustServerCertificate = false }) {
  const errors = [];
  if (!databaseCreated && !roleCreated) return { attempted: false, complete: true, errors };
  const sqlServerArgs = (db) => {
    const args = ['-S', `tcp:${admin.host},${admin.port}`, '-U', admin.user, '-d', db, '-b', '-r', '1', '-h', '-1', '-W', '-l', '5', '-X'];
    if (trustServerCertificate) args.push('-C');
    return args;
  };
  const run = async (db, sql) => {
    const args = engine === 'postgres'
      ? ['-X', '-v', 'ON_ERROR_STOP=1', '-h', admin.host, '-p', String(admin.port), '-U', admin.user, '-d', db]
      : engine === 'sqlserver' ? sqlServerArgs(db)
        : [`--defaults-file=${adminCredentialFile}`, '--batch', '--skip-column-names', '--local-infile=0', `--database=${db}`];
    const extraEnv = engine === 'postgres' ? { PGPASSFILE: adminCredentialFile, PGCONNECT_TIMEOUT: '5' } : engine === 'sqlserver' ? { SQLCMDPASSWORD: admin.password } : {};
    const result = await runner(executable, args, {
      cwd: tempRoot, capture: true, tee: false, timeoutMs, maxOutputBytes: 32768,
      stdin: engine === 'sqlserver' ? sqlServerBatch(sql) : sql,
      env: { ...envBase, ...extraEnv }
    });
    return result.code === 0 && !result.timedOut;
  };
  if (databaseCreated) {
    if (engine === 'postgres') await run(admin.database, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quotePgLiteral(database)} AND pid <> pg_backend_pid();`).catch(() => {});
    const drop = engine === 'postgres' ? `DROP DATABASE IF EXISTS ${quotePgIdentifier(database)};`
      : engine === 'sqlserver' ? `IF DB_ID(${quoteSqlServerLiteral(database)}) IS NOT NULL BEGIN ALTER DATABASE ${quoteSqlServerIdentifier(database)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${quoteSqlServerIdentifier(database)}; END;`
        : `DROP DATABASE IF EXISTS ${quoteMyIdentifier(database)};`;
    if (!(await run(engine === 'sqlserver' ? 'master' : admin.database, drop))) errors.push('Database cleanup failed; manually remove the generated disposable database.');
  }
  if (roleCreated) {
    const dropRole = engine === 'postgres' ? `DROP ROLE IF EXISTS ${quotePgIdentifier(role)};`
      : engine === 'sqlserver' ? `IF SUSER_ID(${quoteSqlServerLiteral(role)}) IS NOT NULL DROP LOGIN ${quoteSqlServerIdentifier(role)};`
        : `DROP USER IF EXISTS '${role}'@'${admin.host === '::1' ? '::1' : '127.0.0.1'}';`;
    if (!(await run(engine === 'sqlserver' ? 'master' : admin.database, dropRole))) errors.push('Test-user/login cleanup failed; manually remove the generated disposable user.');
  }
  return { attempted: true, complete: errors.length === 0, errors };
}
