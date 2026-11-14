import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { CONFIG_DIR } from './paths.mjs';

async function assertDirectoryNotSymlink(directory, { create = false } = {}) {
  const parent = path.dirname(directory);
  if (create) await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const parentInfo = await fs.lstat(parent).catch(() => null);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error(`Refusing to use a missing, non-directory or symbolic-link config parent: ${parent}`);
  }
  if (create) await fs.mkdir(directory, { recursive: false, mode: 0o700 }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const info = await fs.lstat(directory).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Refusing to use a missing, non-directory or symbolic-link config directory: ${directory}`);
  }
}

async function readJsonUnlocked(file, fallback) {
  const info = await fs.lstat(file).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`Cannot inspect ${file}: ${error.message}`);
  });
  if (!info) return fallback;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Refusing to read a non-regular or symbolic-link config file: ${file}`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      const backup = `${file}.bak`;
      const backupInfo = await fs.lstat(backup).catch(() => null);
      if (backupInfo?.isFile() && !backupInfo.isSymbolicLink()) {
        try {
          const recovered = JSON.parse(await fs.readFile(backup, 'utf8'));
          console.error(`Warning: ${file} was malformed; recovered the last valid copy from ${backup}.`);
          return recovered;
        } catch {}
      }
    }
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
}

export async function readJson(file, fallback) {
  const directory = path.dirname(file);
  const directoryInfo = await fs.lstat(directory).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (directoryInfo && (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())) {
    throw new Error(`Refusing to read from a non-directory or symbolic-link config directory: ${directory}`);
  }
  if (!directoryInfo) return fallback;
  const parentInfo = await fs.lstat(path.dirname(directory)).catch(() => null);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) throw new Error(`Refusing to read from a symbolic-link or invalid config parent: ${path.dirname(directory)}`);
  return readJsonUnlocked(file, fallback);
}

async function acquireFileLock(file, timeoutMs = 5000) {
  const lockPath = `${file}.lock`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const handle = await fs.open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n${Date.now()}\n`);
      return async () => {
        await handle.close().catch(() => {});
        await fs.rm(lockPath, { force: true }).catch(() => {});
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await fs.lstat(lockPath).catch(() => null);
      if (info?.isSymbolicLink()) throw new Error(`Refusing symbolic-link lock file: ${lockPath}`);
      if (info && Date.now() - info.mtimeMs > 30000) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        continue;
      }
      await delay(50 + Math.floor(Math.random() * 50));
    }
  }
  throw new Error(`Timed out waiting for local config lock: ${lockPath}`);
}

async function atomicWriteUnlocked(file, value) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const backup = `${file}.bak`;
  let handle;
  try {
    const current = await fs.lstat(file).catch(() => null);
    if (current) {
      if (!current.isFile() || current.isSymbolicLink()) throw new Error(`Refusing to replace a non-regular or symbolic-link config file: ${file}`);
      const oldBytes = await fs.readFile(file);
      try { JSON.parse(oldBytes.toString('utf8')); } catch { /* Never overwrite a malformed file as a valid backup. */ }
      if (oldBytes.length) {
        try {
          JSON.parse(oldBytes.toString('utf8'));
          const backupTemp = `${backup}.${process.pid}.${randomUUID()}.tmp`;
          await fs.writeFile(backupTemp, oldBytes, { mode: 0o600, flag: 'wx' });
          await fs.rename(backupTemp, backup);
          await fs.chmod(backup, 0o600).catch(() => {});
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
    }
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600).catch(() => {});
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

export async function writeJsonSecure(file, value) {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const base = path.dirname(directory);
  const baseInfo = await fs.lstat(base).catch(() => null);
  if (!baseInfo?.isDirectory() || baseInfo.isSymbolicLink()) throw new Error(`Refusing a symbolic-link or invalid config parent: ${base}`);
  await assertDirectoryNotSymlink(directory);
  await fs.chmod(directory, 0o700).catch(() => {});
  const release = await acquireFileLock(file);
  try { await atomicWriteUnlocked(file, value); }
  finally { await release(); }
}

export async function updateJsonSecure(file, fallback, updater) {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const baseInfo = await fs.lstat(path.dirname(directory)).catch(() => null);
  if (!baseInfo?.isDirectory() || baseInfo.isSymbolicLink()) throw new Error(`Refusing a symbolic-link or invalid config parent: ${path.dirname(directory)}`);
  await assertDirectoryNotSymlink(directory);
  await fs.chmod(directory, 0o700).catch(() => {});
  const release = await acquireFileLock(file);
  try {
    const current = await readJsonUnlocked(file, fallback);
    const next = await updater(current);
    await atomicWriteUnlocked(file, next);
    return next;
  } finally { await release(); }
}

export async function removeFile(file) {
  await fs.rm(file, { force: true });
}

export async function ensureConfigDir() {
  await fs.mkdir(path.dirname(CONFIG_DIR), { recursive: true, mode: 0o700 });
  await assertDirectoryNotSymlink(CONFIG_DIR, { create: true });
  await fs.chmod(CONFIG_DIR, 0o700).catch(() => {});
}
