import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isTermuxEnvironment, getTermuxPaths } from './termux.mjs';

export const DEFAULT_GRADLE_USER_HOME = process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle');

export function readGradleDistributionUrl(wrapperProperties) {
  const source = String(wrapperProperties || '').split(/\r?\n/).find((line) => /^\s*distributionUrl\s*=/.test(line));
  if (!source) return null;
  const value = source.slice(source.indexOf('=') + 1).trim().replace(/\\:/g, ':');
  try { return new URL(value); } catch { return null; }
}

export function gradleDistributionName(wrapperProperties) {
  const url = readGradleDistributionUrl(wrapperProperties);
  if (!url) return null;
  const match = path.basename(url.pathname).match(/^gradle-([0-9][A-Za-z0-9.+-]*)-(all|bin|complete)\.zip$/);
  return match ? { version: match[1], flavor: match[2], directory: `gradle-${match[1]}-${match[2]}` } : null;
}

async function hasGradleExecutable(directory, depth = 0) {
  if (depth > 5) return false;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const executable = path.join(candidate, process.platform === 'win32' ? 'gradle.bat' : 'gradle');
      if (entry.name === 'bin' && await fs.stat(executable).then((s) => s.isFile(), () => false)) return true;
      if (entry.name === 'bin' && process.platform === 'win32' && await fs.stat(path.join(candidate, 'gradle')).then((s) => s.isFile(), () => false)) return true;
      if (await hasGradleExecutable(candidate, depth + 1)) return true;
    }
  }
  return false;
}

export async function inspectGradleWrapperCache(projectRoot, { gradleUserHome = DEFAULT_GRADLE_USER_HOME } = {}) {
  const wrapperRoot = path.join(projectRoot, 'android', 'gradle', 'wrapper');
  const rootWrapper = path.join(projectRoot, 'gradle', 'wrapper');
  const candidates = [wrapperRoot, rootWrapper];
  let propertiesFile = null;
  let wrapperScript = null;
  for (const directory of candidates) {
    const script = path.join(directory === wrapperRoot ? path.join(projectRoot, 'android') : projectRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
    const properties = path.join(directory, 'gradle-wrapper.properties');
    const propInfo = await fs.lstat(properties).catch(() => null);
    const scriptInfo = await fs.lstat(script).catch(() => null);
    const jarInfo = process.platform === 'win32' ? await fs.lstat(path.join(directory, 'gradle-wrapper.jar')).catch(() => null) : null;
    const jarReady = process.platform !== 'win32' || Boolean(jarInfo?.isFile() && !jarInfo.isSymbolicLink());
    if (propInfo?.isFile() && !propInfo.isSymbolicLink() && scriptInfo?.isFile() && !scriptInfo.isSymbolicLink() && jarReady) {
      propertiesFile = properties;
      wrapperScript = script;
      break;
    }
  }
  if (!propertiesFile) {
    return { wrapperPresent: false, cached: false, version: null, distributionUrl: null, path: null, reason: 'No regular project Gradle Wrapper and distribution properties were found.' };
  }
  const text = await fs.readFile(propertiesFile, 'utf8');
  const distribution = gradleDistributionName(text);
  const distributionUrl = readGradleDistributionUrl(text)?.toString() || null;
  if (!distribution) return { wrapperPresent: true, cached: false, version: null, distributionUrl, path: null, propertiesFile, wrapperScript, reason: 'The wrapper distribution URL could not be parsed.' };
  const distributionRoot = path.join(gradleUserHome, 'wrapper', 'dists', distribution.directory);
  const cached = await hasGradleExecutable(distributionRoot);
  return {
    wrapperPresent: true, cached, version: distribution.version, flavor: distribution.flavor,
    distributionUrl, path: distributionRoot, propertiesFile, wrapperScript,
    reason: cached ? null : `Gradle ${distribution.version} (${distribution.flavor}) is not cached in ${distributionRoot}.`
  };
}

/**
 * Flutter invokes the project wrapper itself, so appending --offline to the Flutter
 * command is not sufficient. Give that invocation a temporary Gradle user-home
 * with the existing wrapper/dependency caches linked in and an init script that
 * sets StartParameter.offline before dependency resolution starts.
 */
export async function createOfflineGradleEnvironment({ baseHome = DEFAULT_GRADLE_USER_HOME } = {}) {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-gradle-offline-'));
  try {
    for (const name of ['wrapper', 'caches', 'notifications', 'jdks', 'native']) {
      const source = path.join(baseHome, name);
      const info = await fs.lstat(source).catch(() => null);
      if (info?.isDirectory() && !info.isSymbolicLink()) {
        await fs.symlink(source, path.join(tempHome, name), os.platform() === 'win32' ? 'junction' : 'dir');
      }
    }
    const initDir = path.join(tempHome, 'init.d');
    await fs.mkdir(initDir, { recursive: true, mode: 0o700 });
    const initScript = path.join(initDir, 'paxi-offline.init.gradle');
    await fs.writeFile(initScript, [
      '// Generated by PAXI for this build only. Do not edit.',
      'gradle.startParameter.offline = true',
      ''
    ].join('\n'), { mode: 0o600, flag: 'wx' });
    return {
      env: { GRADLE_USER_HOME: tempHome },
      initScript,
      cleanup: async () => fs.rm(tempHome, { recursive: true, force: true })
    };
  } catch (error) {
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function offlineToolchainSnapshot(projectRoot = process.cwd()) {
  const termux = isTermuxEnvironment();
  const gradleUserHome = process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle');
  const wrapper = await inspectGradleWrapperCache(projectRoot, { gradleUserHome });
  let flutterExecutable = null;
  const flutterNames = process.platform === 'win32' ? ['flutter.bat', 'flutter.cmd', 'flutter.exe'] : ['flutter'];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of flutterNames) {
      const candidate = path.join(directory, name);
      const info = await fs.stat(candidate).catch(() => null);
      if (info?.isFile()) { flutterExecutable = candidate; break; }
    }
    if (flutterExecutable) break;
  }
  const flutterRoot = process.env.FLUTTER_ROOT || (flutterExecutable ? path.dirname(path.dirname(flutterExecutable)) : termux ? path.join(getTermuxPaths().prefix, 'opt', 'flutter') : null);
  const pubCache = process.env.PUB_CACHE || path.join(os.homedir(), '.pub-cache');
  const androidSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (termux ? getTermuxPaths().androidSdk : null);
  const statDir = async (value) => value ? fs.stat(value).then((s) => s.isDirectory(), () => false) : false;
  const flutterCacheRoot = flutterRoot ? path.join(flutterRoot, 'bin', 'cache') : null;
  const [gradleCaches, pubCachePresent, flutterCache, androidSdkPresent, windowsEngine] = await Promise.all([
    statDir(path.join(gradleUserHome, 'caches', 'modules-2')),
    statDir(pubCache),
    statDir(flutterCacheRoot || ''),
    statDir(androidSdk),
    statDir(flutterCacheRoot ? path.join(flutterCacheRoot, 'artifacts', 'engine', 'windows-x64') : '')
  ]);
  return {
    gradleUserHome,
    gradleWrapper: wrapper,
    gradleDependencies: { available: gradleCaches, path: path.join(gradleUserHome, 'caches', 'modules-2') },
    flutter: { available: Boolean(flutterRoot), root: flutterRoot, artifactsCached: flutterCache, windowsArtifactsCached: windowsEngine },
    pub: { available: pubCachePresent, path: pubCache },
    androidSdk: { available: androidSdkPresent, path: androidSdk }
  };
}
