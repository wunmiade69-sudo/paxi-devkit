import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const version = packageInfo.version;
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

test('Termux installer relocates shared-storage source and writes an Android-native Node launcher', { skip: process.platform === 'win32' ? 'Termux shell installer test runs on POSIX hosts.' : false }, async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-termux-install-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));

  const home = path.join(temp, "private-home-'quoted");
  const prefix = path.join(temp, 'data', 'com.termux', 'files', 'usr');
  const fakeBin = path.join(temp, 'fake-bin');
  const globalBin = path.join(prefix, 'bin');
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.mkdir(globalBin, { recursive: true });

  const fakeNpm = path.join(fakeBin, 'npm');
  await fs.writeFile(fakeNpm, '#!/bin/sh\nset -eu\n[ "$1" = ci ] || { echo "unexpected npm command: $*" >&2; exit 2; }\nexit 0\n');
  await fs.chmod(fakeNpm, 0o755);
  const fakeNode = path.join(fakeBin, 'node');
  await fs.writeFile(fakeNode, `#!/bin/sh\nexec ${quote(process.execPath)} "$@"\n`);
  await fs.chmod(fakeNode, 0o755);

  const env = {
    ...process.env,
    HOME: home,
    PREFIX: prefix,
    PATH: `${globalBin}:${fakeBin}:${process.env.PATH}`
  };
  const output = execFileSync('bash', [path.join(root, 'scripts/install-termux.sh')], {
    env,
    encoding: 'utf8'
  });

  const installed = path.join(home, '.local', 'share', 'paxi-devkit', version);
  const installedCli = path.join(installed, 'bin', 'paxi.mjs');
  const launcher = path.join(globalBin, 'paxi');
  const stat = await fs.stat(installedCli);
  const launcherText = await fs.readFile(launcher, 'utf8');
  assert.equal((stat.mode & 0o111) !== 0, true, 'CLI source should be executable');
  assert.equal((await fs.stat(launcher)).mode & 0o111 ? true : false, true, 'generated launcher should be executable');
  assert.ok(launcherText.startsWith('#!/system/bin/sh\n'), 'launcher must use Android system shell, not /usr/bin/env');
  assert.ok(launcherText.includes('PAXI_TERMUX_LAUNCHER'));
  assert.ok(launcherText.includes(quote(installedCli)), 'entry path must be safely shell-quoted');
  assert.ok(output.includes(`PAXI DevKit ${version} installed successfully`));
  assert.ok(output.includes(`Installed at: ${installed}`));
  assert.ok(output.includes(launcher));
  assert.equal(output.includes(root), false, 'the global launcher must not point back to shared storage');

  // Linux CI has no /system/bin/sh; invoking the generated POSIX script via
  // /bin/sh validates its argument forwarding and Node path without faking Android.
  const cliVersion = execFileSync('sh', [launcher, 'version'], { env, encoding: 'utf8' }).trim();
  assert.equal(cliVersion, version);
});


test('Termux installer refuses to replace an unrelated command symlink', { skip: process.platform === 'win32' ? 'Termux shell installer test runs on POSIX hosts.' : false }, async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-termux-symlink-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home');
  const prefix = path.join(temp, 'data', 'com.termux', 'files', 'usr');
  const fakeBin = path.join(temp, 'bin');
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(path.join(prefix, 'bin'), { recursive: true });
  await fs.mkdir(fakeBin, { recursive: true });
  const source = path.join(home, 'paxi-source');
  await fs.mkdir(source, { recursive: true });
  await fs.cp(root, source, { recursive: true, filter: (name) => !name.includes('node_modules') });
  const unrelated = path.join(temp, 'not-paxi');
  await fs.writeFile(unrelated, '#!/bin/sh\necho unrelated\n');
  const launcher = path.join(prefix, 'bin', 'paxi');
  await fs.symlink(unrelated, launcher);
  for (const [name, content] of [['npm', '#!/bin/sh\nexit 0\n'], ['node', `#!/bin/sh\nexec ${quote(process.execPath)} "$@"\n`]]) {
    const file = path.join(fakeBin, name);
    await fs.writeFile(file, content);
    await fs.chmod(file, 0o755);
  }
  const env = { ...process.env, HOME: home, PREFIX: prefix, PATH: `${prefix}/bin:${fakeBin}:${process.env.PATH}` };
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('bash', [path.join(source, 'scripts/install-termux.sh')], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Refusing to replace an unrelated command symlink/);
  assert.equal(await fs.readlink(launcher), unrelated);
});

test('Termux installer refuses to overwrite an unrelated existing command', { skip: process.platform === 'win32' ? 'Termux shell installer test runs on POSIX hosts.' : false }, async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-termux-existing-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home');
  const prefix = path.join(temp, 'data', 'com.termux', 'files', 'usr');
  const fakeBin = path.join(temp, 'bin');
  await fs.mkdir(path.join(prefix, 'bin'), { recursive: true });
  await fs.mkdir(fakeBin, { recursive: true });
  const source = path.join(home, 'project');
  await fs.mkdir(path.join(source, 'scripts'), { recursive: true });
  await fs.cp(root, source, { recursive: true, filter: (name) => !name.includes('node_modules') });
  const launcher = path.join(prefix, 'bin', 'paxi');
  await fs.writeFile(launcher, '#!/system/bin/sh\necho user command\n');
  const fakeNpm = path.join(fakeBin, 'npm');
  await fs.writeFile(fakeNpm, '#!/bin/sh\nexit 0\n');
  await fs.chmod(fakeNpm, 0o755);
  const fakeNode = path.join(fakeBin, 'node');
  await fs.writeFile(fakeNode, `#!/bin/sh\nexec ${quote(process.execPath)} "$@"\n`);
  await fs.chmod(fakeNode, 0o755);
  const env = { ...process.env, HOME: home, PREFIX: prefix, PATH: `${prefix}/bin:${fakeBin}:${process.env.PATH}` };
  const result = await import('node:child_process').then(({ spawnSync }) => spawnSync('bash', [path.join(source, 'scripts/install-termux.sh')], { env, encoding: 'utf8' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /Refusing to overwrite an existing non-PAXI command/);
  assert.equal(await fs.readFile(launcher, 'utf8'), '#!/system/bin/sh\necho user command\n');
});
