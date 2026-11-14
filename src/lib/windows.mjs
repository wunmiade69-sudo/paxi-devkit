import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commandExists, runProcess, sanitizedEnvironment } from './process.mjs';

async function regularFile(file) {
  const info = await fs.lstat(file).catch(() => null);
  return Boolean(info?.isFile() && !info.isSymbolicLink());
}

async function hasVersionedDirectory(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isDirectory() && /^\d+(?:\.\d+){1,3}$/.test(entry.name));
}

/**
 * Inspect the native Windows desktop toolchain without installing or modifying it.
 * Android builds on Windows do not require Visual Studio; this check is specific to
 * Flutter's Windows desktop target.
 */
export async function inspectWindowsToolchain({ platform = os.platform(), env = process.env } = {}) {
  if (platform !== 'win32') {
    return {
      hostSupported: false,
      visualStudioAvailable: false,
      windowsSdkAvailable: false,
      ready: false,
      installationPath: null,
      vswherePath: null,
      detail: 'Windows desktop builds require a Windows host.'
    };
  }

  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const programFiles = env.ProgramFiles || 'C:\\Program Files';
  const candidates = [
    path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    path.join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  ];
  let vswherePath = null;
  for (const candidate of candidates) {
    if (await regularFile(candidate)) { vswherePath = candidate; break; }
  }
  if (!vswherePath && await commandExists('vswhere')) vswherePath = 'vswhere.exe';

  let installationPath = null;
  if (vswherePath) {
    const result = await runProcess(vswherePath, [
      '-latest', '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', 'Microsoft.VisualStudio.Component.VC.CMake.Project',
      '-property', 'installationPath'
    ], { capture: true, tee: false, timeoutMs: 10000, maxOutputBytes: 8192, env: sanitizedEnvironment() });
    if (result.code === 0) installationPath = result.stdout.trim().split(/\r?\n/).find(Boolean) || null;
  }

  const sdkRoots = [
    path.join(programFilesX86, 'Windows Kits', '10', 'Include'),
    path.join(programFiles, 'Windows Kits', '10', 'Include'),
    path.join(programFiles, 'Windows Kits', '11', 'Include')
  ];
  let windowsSdkAvailable = false;
  for (const sdkRoot of sdkRoots) {
    if (await hasVersionedDirectory(sdkRoot)) { windowsSdkAvailable = true; break; }
  }

  const visualStudioAvailable = Boolean(installationPath);
  const ready = visualStudioAvailable && windowsSdkAvailable;
  const detail = ready
    ? `Visual Studio C++/CMake toolchain and Windows SDK detected at ${installationPath}`
    : !visualStudioAvailable
      ? 'Visual Studio C++ Build Tools/CMake components not detected. Install Visual Studio with the Desktop development with C++ workload.'
      : 'Windows SDK not detected. Add a Windows 10/11 SDK component in Visual Studio Installer.';

  return { hostSupported: true, visualStudioAvailable, windowsSdkAvailable, ready, installationPath, vswherePath, detail };
}
