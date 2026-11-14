import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CONFIG_DIR } from '../lib/paths.mjs';
import { commandExists, runProcess } from '../lib/process.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';

const TOOL_CANDIDATES = [
  { id: 'clang++', label: 'Clang C++ compiler', command: 'clang++', args: ['--version'], role: 'compiler' },
  { id: 'g++', label: 'GNU C++ compiler', command: 'g++', args: ['--version'], role: 'compiler' },
  { id: 'c++', label: 'System C++ compiler', command: 'c++', args: ['--version'], role: 'compiler' },
  { id: 'cl', label: 'Microsoft C++ compiler', command: 'cl', args: [], role: 'compiler', windowsOnly: true },
  { id: 'cmake', label: 'CMake', command: 'cmake', args: ['--version'], role: 'build-system' },
  { id: 'ninja', label: 'Ninja', command: 'ninja', args: ['--version'], role: 'build-tool' },
  { id: 'make', label: 'Make', command: 'make', args: ['--version'], role: 'build-tool' },
  { id: 'meson', label: 'Meson', command: 'meson', args: ['--version'], role: 'build-system' },
  { id: 'ctest', label: 'CTest', command: 'ctest', args: ['--version'], role: 'test-runner' },
  { id: 'clang-tidy', label: 'clang-tidy', command: 'clang-tidy', args: ['--version'], role: 'static-analysis' }
];

const isInside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

async function resolvePotentialRealPath(value) {
  const absolute = path.resolve(value);
  let current = absolute;
  const remainder = [];
  while (true) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, ...remainder);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      remainder.unshift(path.basename(current));
      current = parent;
    }
  }
}

function safeOutput(value) { return redactSensitiveText(String(value || '')).text; }

async function projectMarkers(root) {
  const names = await fs.readdir(root).catch(() => []);
  const set = new Set(names);
  const sourceFiles = names.filter((name) => /\.(?:cpp|cc|cxx|c|h|hpp|hh|hxx)$/i.test(name));
  return {
    cmake: set.has('CMakeLists.txt'),
    make: set.has('Makefile') || set.has('makefile'),
    meson: set.has('meson.build'),
    ninja: set.has('build.ninja'),
    conan: set.has('conanfile.py') || set.has('conanfile.txt'),
    vcpkg: set.has('vcpkg.json'),
    sourceFilesAtRoot: sourceFiles.length
  };
}

async function checkTool(tool) {
  if (tool.windowsOnly && process.platform !== 'win32') return { ...tool, available: false, skipped: true, reason: 'Windows-only compiler.' };
  const available = await commandExists(tool.command);
  if (!available) return { ...tool, available: false, version: null };
  if (tool.id === 'cl') return { ...tool, available: true, version: 'Present on PATH; MSVC environment not verified.' };
  const result = await runProcess(tool.command, tool.args, { capture: true, tee: false, timeoutMs: 4000, maxOutputBytes: 8192 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/).slice(0, 2).join(' ').slice(0, 300);
  return { ...tool, available: true, version: output || (result.code === 0 ? 'Version command succeeded; no text output.' : 'Present, but version command failed.'), versionExitCode: result.code };
}

export async function cppToolchainReport(projectPath = process.cwd(), { runVersionChecks = true } = {}) {
  const root = path.resolve(projectPath);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`C++ project directory does not exist: ${root}`);
  const markers = await projectMarkers(root);
  const tools = runVersionChecks ? await Promise.all(TOOL_CANDIDATES.map(checkTool)) : TOOL_CANDIDATES.map((tool) => ({ ...tool, available: null, reason: 'Version checks disabled.' }));
  const compilers = tools.filter((tool) => tool.role === 'compiler' && tool.available);
  const cmake = tools.find((tool) => tool.id === 'cmake');
  const warnings = [];
  if (!compilers.length) warnings.push('No C++ compiler was found on PATH. Install clang++, g++, or the Visual Studio C++ workload.');
  if (!markers.cmake && !markers.make && !markers.meson && !markers.ninja) warnings.push('No recognized C/C++ build definition was found at the project root.');
  if (markers.cmake && !cmake?.available) warnings.push('CMakeLists.txt is present, but CMake is not available on PATH.');
  return {
    schemaVersion: 1,
    inspectedAt: new Date().toISOString(),
    projectRoot: root,
    executionKind: 'toolchain-preflight-only',
    buildExecuted: false,
    testExecuted: false,
    markers,
    tools,
    compilerAvailable: compilers.length > 0,
    buildDefinitionAvailable: markers.cmake || markers.make || markers.meson || markers.ninja,
    warnings,
    nextSteps: [
      'Install a native compiler and the build system selected by this project.',
      ...(markers.cmake ? ['Run `paxi doctor cpp --project . --build --confirm` only after reviewing CMakeLists.txt and its included files.'] : ['Add or identify the intended project build definition before requesting a compile.']),
      'Run tests separately after reviewing the test commands; project build and test scripts execute project-controlled code.'
    ]
  };
}

export async function runConfirmedCMakeBuild({ projectPath = process.cwd(), buildDir = null, confirm = false, timeoutMs = 15 * 60 * 1000 } = {}) {
  if (!confirm) throw new Error('CMake build executes project-controlled CMake configuration. Re-run with --confirm after reviewing the project build files.');
  const root = path.resolve(projectPath);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`C++ project directory does not exist: ${root}`);
  const cmakeLists = path.join(root, 'CMakeLists.txt');
  const cmakeInfo = await fs.lstat(cmakeLists).catch(() => null);
  if (!cmakeInfo?.isFile() || cmakeInfo.isSymbolicLink()) throw new Error('Confirmed CMake build requires a regular, non-symlink CMakeLists.txt at the project root.');
  const projectReal = await fs.realpath(root);
  const projectKey = createHash('sha256').update(projectReal).digest('hex').slice(0, 20);
  const target = path.resolve(buildDir || path.join(CONFIG_DIR, 'builds', 'cpp', projectKey));
  const existingTarget = await fs.lstat(target).catch(() => null);
  if (existingTarget?.isSymbolicLink()) throw new Error('Build directory must not be a symbolic link.');
  const targetRealCandidate = await resolvePotentialRealPath(target);
  if (isInside(projectReal, targetRealCandidate)) throw new Error('Build directory must resolve outside the project source directory, including through symbolic links.');
  if (!await commandExists('cmake')) throw new Error('CMake is not available on PATH. Install CMake before building this project.');
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  const createdTarget = await fs.lstat(target);
  if (!createdTarget.isDirectory() || createdTarget.isSymbolicLink()) throw new Error('Build directory must be a regular directory, not a symbolic link.');
  const targetReal = await fs.realpath(target);
  if (isInside(projectReal, targetReal)) throw new Error('Build directory resolves inside the project source directory.');
  const configure = await runProcess('cmake', ['-S', root, '-B', target, '-DCMAKE_BUILD_TYPE=Debug'], {
    cwd: root, capture: true, tee: false, timeoutMs, maxOutputBytes: 512 * 1024
  });
  const report = {
    schemaVersion: 1,
    executionKind: 'confirmed-local-cmake-build',
    projectRoot: root,
    buildDirectory: target,
    configure: { exitCode: configure.code, stdout: safeOutput(configure.stdout), stderr: safeOutput(configure.stderr), timedOut: configure.timedOut, error: safeOutput(configure.error) },
    build: null,
    testExecuted: false,
    succeeded: false,
    warning: 'CMake configuration and compilation execute commands defined by the project. Review CMakeLists.txt and dependencies before using --confirm.'
  };
  if (configure.code !== 0) return report;
  const build = await runProcess('cmake', ['--build', target, '--parallel', '2'], {
    cwd: root, capture: true, tee: false, timeoutMs, maxOutputBytes: 512 * 1024
  });
  report.build = { exitCode: build.code, stdout: safeOutput(build.stdout), stderr: safeOutput(build.stderr), timedOut: build.timedOut, error: safeOutput(build.error) };
  report.succeeded = build.code === 0;
  return report;
}
