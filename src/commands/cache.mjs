import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { offlineToolchainSnapshot } from '../lib/offline.mjs';

async function directorySize(target) {
  let total = 0;
  async function walk(current, depth = 0) {
    if (depth > 12) return;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile()) total += (await fs.stat(file).catch(() => ({ size: 0 }))).size;
    }
  }
  await walk(target);
  return total;
}

const human = (bytes) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;

export async function cacheStatus(projectPath = process.cwd(), { json = false } = {}) {
  const snapshot = await offlineToolchainSnapshot(projectPath);
  const paths = {
    gradleWrapper: path.join(snapshot.gradleUserHome, 'wrapper', 'dists'),
    gradleDependencies: path.join(snapshot.gradleUserHome, 'caches', 'modules-2'),
    flutterPub: snapshot.pub.path,
    flutterSdkArtifacts: snapshot.flutter.root ? path.join(snapshot.flutter.root, 'bin', 'cache') : null,
    projectBuild: path.join(projectPath, 'build'),
    projectGradle: path.join(projectPath, 'android', '.gradle'),
    projectDart: path.join(projectPath, '.dart_tool')
  };
  const result = {};
  for (const [name, target] of Object.entries(paths)) {
    const info = target ? await fs.lstat(target).catch(() => null) : null;
    result[name] = { path: target, available: Boolean(info?.isDirectory() && !info.isSymbolicLink()), sizeBytes: info?.isDirectory() ? await directorySize(target) : 0 };
  }
  if (json) console.log(JSON.stringify({ snapshot, caches: result }, null, 2));
  else {
    console.log('\nPAXI local cache status\n');
    for (const [name, item] of Object.entries(result)) console.log(`${item.available ? '✓' : '·'} ${name}: ${item.available ? human(item.sizeBytes) : 'not present'}${item.path ? ` · ${item.path}` : ''}`);
    if (snapshot.gradleWrapper.wrapperPresent) console.log(`${snapshot.gradleWrapper.cached ? '✓' : '✗'} Gradle wrapper ${snapshot.gradleWrapper.version}: ${snapshot.gradleWrapper.cached ? 'distribution cached' : 'distribution missing'}`);
    else console.log('· Gradle wrapper: no wrapper found in the selected project');
  }
  return { snapshot, caches: result };
}

export async function cacheClean(args = []) {
  const selected = new Set(args.filter((arg) => ['--gradle', '--flutter', '--project'].includes(arg)));
  const allowed = new Set(['--gradle', '--flutter', '--project', '--confirm']);
  for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown cache clean option: ${arg}`);
  if (!selected.size) throw new Error('Usage: paxi cache clean --gradle|--flutter|--project [--confirm]. Select at least one cache scope.');
  if (!args.includes('--confirm')) throw new Error('Cache cleanup is destructive. Review the scope and re-run with --confirm. No files were deleted.');
  const targets = [];
  const gradleHome = process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle');
  if (selected.has('--gradle')) {
    // Preserve wrapper distributions. Removing them would force a large network download next time.
    targets.push(path.join(gradleHome, 'caches', 'modules-2'), path.join(gradleHome, 'caches', 'build-cache-1'));
  }
  if (selected.has('--flutter')) targets.push(process.env.PUB_CACHE || path.join(os.homedir(), '.pub-cache'));
  if (selected.has('--project')) {
    targets.push(path.join(process.cwd(), '.dart_tool'), path.join(process.cwd(), 'build'), path.join(process.cwd(), 'android', '.gradle'));
  }
  for (const target of targets) {
    const info = await fs.lstat(target).catch(() => null);
    if (!info) continue;
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Refusing to clean a non-directory or symbolic link: ${target}`);
    await fs.rm(target, { recursive: true, force: true });
    console.log(`✓ Removed cache: ${target}`);
  }
  console.log('Cache cleanup complete. Gradle wrapper distributions and Flutter SDK artifacts were preserved.');
}

export async function cacheCommand(args = []) {
  const [action, ...rest] = args;
  if (action === 'status') {
    const json = rest.includes('--json');
    const argsPath = rest.filter((value) => value !== '--json')[0] || process.cwd();
    return cacheStatus(argsPath, { json });
  }
  if (action === 'clean') return cacheClean(rest);
  throw new Error('Usage: paxi cache <status [project] [--json]|clean --gradle|--flutter|--project [--confirm]>');
}
