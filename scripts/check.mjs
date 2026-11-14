import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile() && full.endsWith('.mjs')) files.push(full);
  }
}
await walk(path.join(root, 'bin'));
await walk(path.join(root, 'src'));
await walk(path.join(root, 'scripts'));
for (const file of files) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) {
    process.stderr.write(checked.stderr || checked.stdout || `Syntax check failed: ${file}\n`);
    process.exit(1);
  }
}
console.log(`✓ JavaScript syntax checks passed (${files.length} files).`);
if (process.platform === 'win32') {
  // These POSIX scripts are for Termux/Android. Windows CI validates the
  // PowerShell installer separately and does not require Git Bash on PATH.
  console.log('· Termux shell syntax checks skipped on Windows (not a supported execution host).');
} else {
  for (const file of ['scripts/install-termux.sh', 'scripts/termux-bootstrap.sh']) {
    const shell = spawnSync('bash', ['-n', path.join(root, file)], { encoding: 'utf8' });
    if (shell.status !== 0) {
      process.stderr.write(shell.stderr || shell.stdout || `Shell syntax check failed: ${file}\n`);
      process.exit(1);
    }
  }
  console.log('✓ Termux shell script syntax checks passed.');
}
const python = ['python3', 'python'].find((name) => spawnSync(name, ['--version'], { stdio: 'ignore' }).status === 0);
if (python) {
  for (const file of ['scripts/sqlite-lab.py', 'scripts/validate-json-schema.py']) {
    const checked = spawnSync(python, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding=\'utf-8\').read())', path.join(root, file)], { encoding: 'utf8' });
    if (checked.status !== 0) { process.stderr.write(checked.stderr || checked.stdout || `Python syntax check failed: ${file}\n`); process.exit(1); }
  }
  console.log('✓ Python helper syntax checks passed (2 files).');
} else {
  console.log('· Python helper syntax checks not run; Python is optional for this host.');
}
