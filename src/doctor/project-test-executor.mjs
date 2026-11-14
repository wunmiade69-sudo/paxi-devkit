import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { runProcess, commandExists, sanitizedEnvironment } from '../lib/process.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';

async function regular(root, relative) {
  const file = path.join(root, relative);
  const stat = await fs.lstat(file).catch(() => null);
  return stat?.isFile() && !stat.isSymbolicLink() ? file : null;
}

async function packageInfo(root) {
  const file = await regular(root, 'package.json');
  if (!file) return null;
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

function packageManager(rootFiles) {
  if (rootFiles.includes('pnpm-lock.yaml')) return 'pnpm';
  if (rootFiles.includes('yarn.lock')) return 'yarn';
  if (rootFiles.includes('bun.lock') || rootFiles.includes('bun.lockb')) return 'bun';
  return 'npm';
}

/** Detect a conventional test command; this function never executes it. */
export async function detectProjectTestCommand(projectPath = process.cwd(), { exists = commandExists } = {}) {
  const root = path.resolve(projectPath);
  const rootStat = await fs.lstat(root).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Project test root must be a real, non-symlink directory.');
  const entries = await fs.readdir(root);
  const pkg = await packageInfo(root);
  const isExpo = Boolean(pkg?.dependencies?.expo || pkg?.devDependencies?.expo);
  const isReactNative = Boolean(pkg?.dependencies?.['react-native'] || pkg?.devDependencies?.['react-native']);
  const nodeFramework = isExpo ? 'Expo/Node.js' : isReactNative ? 'React Native/Node.js' : 'Node.js';
  const nodePlanId = isExpo ? 'expo-package-test' : isReactNative ? 'react-native-package-test' : 'node-package-test';
  const missing = (id, command, args, reason, framework) => ({ id, command, args, reason: `${reason} Required tool '${command}' is missing from PATH.`, available: false, projectControlled: true, framework });
  if (pkg?.scripts?.test && typeof pkg.scripts.test === 'string') {
    const manager = packageManager(entries);
    if (await exists(manager)) return { id: nodePlanId, command: manager, args: ['test'], reason: `package.json defines a test script; ${manager} selected from the project lockfile.`, projectControlled: true, framework: nodeFramework };
    return missing(nodePlanId, manager, ['test'], 'package.json defines a test script.', nodeFramework);
  }

  // Expo/React Native projects sometimes have a Jest configuration but no
  // package.json test script. Resolve the already-installed Jest entry point
  // from the project; never use npx here because it may download packages.
  const jestConfigured = Boolean(pkg?.jest) || ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.ts', '.jestrc', '.jestrc.json'].some((name) => entries.includes(name));
  if ((isExpo || isReactNative) && jestConfigured) {
    let jestEntry = null;
    try { jestEntry = createRequire(path.join(root, 'package.json')).resolve('jest/bin/jest'); } catch {}
    if (jestEntry) return {
      id: isExpo ? 'expo-jest-test' : 'react-native-jest-test',
      command: process.execPath,
      args: [jestEntry, '--runInBand'],
      reason: `${isExpo ? 'Expo' : 'React Native'} Jest configuration detected; using the already-installed local Jest package without network installation.`,
      projectControlled: true,
      framework: isExpo ? 'Expo/Jest' : 'React Native/Jest'
    };
    return missing(isExpo ? 'expo-jest-test' : 'react-native-jest-test', 'local Jest package', [], 'Expo/React Native Jest configuration was detected, but local Jest is unavailable. Run the project package manager install first.', isExpo ? 'Expo/Jest' : 'React Native/Jest');
  }

  if (entries.includes('pubspec.yaml')) {
    if (await exists('flutter')) return { id: 'flutter-test', command: 'flutter', args: ['test'], reason: 'Flutter project detected; using the standard Flutter test command.', projectControlled: true, framework: 'Flutter/Dart' };
    if (await exists('dart')) return { id: 'dart-test', command: 'dart', args: ['test'], reason: 'Dart package detected; using dart test.', projectControlled: true, framework: 'Dart' };
    return missing('flutter-test', 'flutter', ['test'], 'pubspec.yaml was detected.', 'Flutter/Dart');
  }
  if (entries.includes('Cargo.toml')) return await exists('cargo')
    ? { id: 'rust-test', command: 'cargo', args: ['test'], reason: 'Cargo project detected.', projectControlled: true, framework: 'Rust' }
    : missing('rust-test', 'cargo', ['test'], 'Cargo.toml was detected.', 'Rust');
  if (entries.includes('go.mod')) return await exists('go')
    ? { id: 'go-test', command: 'go', args: ['test', './...'], reason: 'Go module detected.', projectControlled: true, framework: 'Go' }
    : missing('go-test', 'go', ['test', './...'], 'go.mod was detected.', 'Go');
  if (entries.includes('pyproject.toml') || entries.includes('pytest.ini') || entries.includes('tests')) {
    if (await exists('pytest')) return { id: 'python-pytest', command: 'pytest', args: ['-q'], reason: 'Python tests detected and pytest is installed.', projectControlled: true, framework: 'Python/pytest' };
    if (await exists('python3')) return { id: 'python-unittest', command: 'python3', args: ['-m', 'unittest', 'discover'], reason: 'Python project detected; using standard-library unittest discovery.', projectControlled: true, framework: 'Python/unittest' };
    if (await exists('python')) return { id: 'python-unittest', command: 'python', args: ['-m', 'unittest', 'discover'], reason: 'Python project detected; using standard-library unittest discovery.', projectControlled: true, framework: 'Python/unittest' };
    return missing('python-test', 'python3', ['-m', 'unittest', 'discover'], 'Python test markers were detected.', 'Python');
  }
  if ((entries.includes('phpunit.xml') || entries.includes('phpunit.xml.dist')))
    return await exists('phpunit') ? { id: 'php-phpunit-test', command: 'phpunit', args: [], reason: 'PHPUnit configuration detected.', projectControlled: true, framework: 'PHP/PHPUnit' }
      : missing('php-phpunit-test', 'phpunit', [], 'PHPUnit configuration detected.', 'PHP/PHPUnit');
  if (entries.includes('Gemfile') && entries.includes('Rakefile'))
    return await exists('bundle') ? { id: 'ruby-rake-test', command: 'bundle', args: ['exec', 'rake', 'test'], reason: 'Ruby Gemfile and Rakefile detected.', projectControlled: true, framework: 'Ruby/Rake' }
      : missing('ruby-rake-test', 'bundle', ['exec', 'rake', 'test'], 'Ruby Gemfile and Rakefile detected.', 'Ruby/Rake');
  if (entries.includes('Gemfile') && (entries.includes('.rspec') || entries.includes('spec')))
    return await exists('bundle') ? { id: 'ruby-rspec-test', command: 'bundle', args: ['exec', 'rspec'], reason: 'Ruby RSpec project markers detected.', projectControlled: true, framework: 'Ruby/RSpec' }
      : missing('ruby-rspec-test', 'bundle', ['exec', 'rspec'], 'Ruby RSpec markers detected.', 'Ruby/RSpec');
  if (entries.includes('Package.swift'))
    return await exists('swift') ? { id: 'swift-test', command: 'swift', args: ['test'], reason: 'Swift package manifest detected.', projectControlled: true, framework: 'Swift Package Manager' }
      : missing('swift-test', 'swift', ['test'], 'Package.swift was detected; Swift tests require a Swift host toolchain.', 'Swift Package Manager');

  if (entries.includes('composer.json')) {
    const composerPath = await regular(root, 'composer.json');
    try {
      const composer = JSON.parse(await fs.readFile(composerPath, 'utf8'));
      if (composer.scripts?.test) return await exists('composer')
        ? { id: 'php-composer-test', command: 'composer', args: ['test'], reason: 'composer.json defines a test script.', projectControlled: true, framework: 'PHP/Composer' }
        : missing('php-composer-test', 'composer', ['test'], 'composer.json defines a test script.', 'PHP/Composer');
    } catch {}
  }
  const dotnetProject = entries.find((name) => name.endsWith('.sln') || name.endsWith('.csproj'));
  if (dotnetProject) return await exists('dotnet')
    ? { id: 'dotnet-test', command: 'dotnet', args: ['test', dotnetProject], reason: '.NET solution/project detected.', projectControlled: true, framework: '.NET' }
    : missing('dotnet-test', 'dotnet', ['test', dotnetProject], '.NET solution/project detected.', '.NET');
  if (entries.includes('pom.xml')) return await exists('mvn')
    ? { id: 'maven-test', command: 'mvn', args: ['test'], reason: 'Maven project detected.', projectControlled: true, framework: 'Java/Maven' }
    : missing('maven-test', 'mvn', ['test'], 'pom.xml was detected.', 'Java/Maven');
  if (entries.includes('foundry.toml')) return await exists('forge')
    ? { id: 'foundry-test', command: 'forge', args: ['test'], reason: 'Foundry Solidity project detected.', projectControlled: true, framework: 'Solidity/Foundry' }
    : missing('foundry-test', 'forge', ['test'], 'foundry.toml was detected.', 'Solidity/Foundry');

  const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
  const wrapperPath = await regular(root, wrapper);
  if (wrapperPath) {
    if (process.platform === 'win32') return { id: 'gradle-test', command: wrapperPath, args: ['test'], reason: 'Project-local Gradle wrapper detected.', projectControlled: true, framework: 'Gradle' };
    const executable = await fs.access(wrapperPath, fs.constants.X_OK).then(() => true).catch(() => false);
    if (executable) return { id: 'gradle-test', command: wrapperPath, args: ['test'], reason: 'Executable project-local Gradle wrapper detected.', projectControlled: true, framework: 'Gradle' };
    if (await exists('bash')) return { id: 'gradle-test', command: 'bash', args: [wrapperPath, 'test'], reason: 'Project-local Gradle wrapper detected; invoked through bash because execute permission is absent.', projectControlled: true, framework: 'Gradle' };
    return missing('gradle-test', 'bash', [wrapperPath, 'test'], 'Gradle wrapper detected but cannot be executed directly.', 'Gradle');
  }
  if (entries.some((name) => name === 'build.gradle' || name === 'build.gradle.kts')) return await exists('gradle')
    ? { id: 'gradle-test-global', command: 'gradle', args: ['test', '--no-daemon'], reason: 'Gradle build file detected; no local wrapper was found, so the installed Gradle is used.', projectControlled: true, framework: 'Gradle' }
    : missing('gradle-test-global', 'gradle', ['test', '--no-daemon'], 'Gradle build file detected but no local wrapper was found.', 'Gradle');
  // A source CMake project with an explicit CTest declaration can be tested
  // from a disposable build tree. Configuration/build/test are separate
  // confirmed steps and all generated files remain outside the project.
  const cmakeListsPath = await regular(root, 'CMakeLists.txt');
  if (cmakeListsPath) {
    const cmakeLists = await fs.readFile(cmakeListsPath, 'utf8').catch(() => '');
    if (/(?:\benable_testing\s*\(|\binclude\s*\(\s*CTest\b)/i.test(cmakeLists)) {
      const cmakeAvailable = await exists('cmake');
      const ctestAvailable = await exists('ctest');
      if (cmakeAvailable && ctestAvailable) return {
        id: 'cmake-configure-build-ctest', command: 'cmake', args: ['-S', root, '-B', '<temporary-build-directory>'],
        strategy: 'cmake-configure-build-ctest', reason: 'CMakeLists.txt declares CTest; PAXI will configure, list tests, build and run CTest in a disposable temporary directory.',
        projectControlled: true, framework: 'C/C++ CMake', temporaryBuild: true
      };
      const missingTool = !cmakeAvailable ? 'cmake' : 'ctest';
      return missing('cmake-configure-build-ctest', missingTool, [], 'CMake CTest project detected.', 'C/C++ CMake');
    }
  }

  if (await exists('ctest')) {
    for (const candidate of ['.', 'build', 'cmake-build-debug', 'cmake-build-release', 'out/build']) {
      const manifest = path.join(root, candidate, 'CTestTestfile.cmake');
      const stat = await fs.lstat(manifest).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink()) {
        const buildRoot = path.resolve(root, candidate);
        return { id: 'ctest', command: 'ctest', args: ['--test-dir', buildRoot, '--output-on-failure'], reason: `Configured CTest manifest detected in ${candidate}.`, projectControlled: true, framework: 'C/C++ CMake' };
      }
    }
  }
  return null;
}

function normalizeResult(result) {
  const stdout = redactSensitiveText(result.stdout).text;
  const stderr = redactSensitiveText(result.stderr).text;
  const error = redactSensitiveText(result.error).text;
  return { stdout, stderr, error };
}

function testOutcome(result, outputTruncated) {
  return result.timedOut ? 'timed-out'
    : result.cancelled ? 'cancelled'
      : outputTruncated ? (result.code === 0 ? 'passed-output-truncated' : 'failed-output-truncated')
        : result.code === 0 ? 'passed' : 'failed';
}

async function runCmakeTestPlan({ root, plan, timeoutMs, runner }) {
  const startedAt = Date.now();
  const buildRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-cmake-test-'));
  const steps = [];
  const output = { stdout: '', stderr: '', error: '' };
  let outputBytes = 0;
  let outputTruncated = false;
  let finalCode = 0;
  let timedOut = false;
  let cancelled = false;
  let noTests = false;
  const append = (target, value) => {
    if (!value) return;
    output[target] = `${output[target]}${value}`.slice(-256 * 1024);
  };
  const execute = async (id, command, args, cwd) => {
    const elapsed = Date.now() - startedAt;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      timedOut = true;
      finalCode = null;
      steps.push({ id, status: 'timed-out-before-start', exitCode: null });
      return null;
    }
    const result = await runner(command, args, {
      cwd, capture: true, tee: false, timeoutMs: remaining, maxOutputBytes: 256 * 1024,
      env: sanitizedEnvironment()
    });
    const safe = normalizeResult(result);
    append('stdout', `\n[${id}]\n${safe.stdout}`);
    append('stderr', `\n[${id}]\n${safe.stderr}`);
    append('error', safe.error);
    outputBytes += Number.isFinite(result.outputBytes) ? result.outputBytes : Buffer.byteLength(`${safe.stdout}${safe.stderr}${safe.error}`);
    outputTruncated ||= Boolean(result.outputTruncated);
    timedOut ||= Boolean(result.timedOut);
    cancelled ||= Boolean(result.cancelled);
    finalCode = result.code;
    steps.push({ id, status: result.timedOut ? 'timed-out' : result.cancelled ? 'cancelled' : result.outputTruncated ? 'output-truncated' : result.code === 0 ? 'passed' : 'failed', exitCode: result.code, outputBytes: Number.isFinite(result.outputBytes) ? result.outputBytes : null, outputTruncated: Boolean(result.outputTruncated) });
    return result;
  };
  let cleanupComplete = true;
  try {
    let result = await execute('configure', 'cmake', ['-S', root, '-B', buildRoot, '-DBUILD_TESTING=ON'], root);
    if (!result || result.code !== 0 || result.timedOut || result.cancelled) {
      // The failing configure result is preserved in the final report.
    } else {
      result = await execute('discover-tests', 'ctest', ['--test-dir', buildRoot, '--show-only'], root);
      if (result?.outputTruncated) {
        // Test discovery is a coverage gate. Never build/run a possibly partial
        // inventory and then present the result as a complete CTest pass.
        // Preserve the process exit code but leave evidence incomplete.
      } else if (result && result.code === 0 && !result.timedOut && !result.cancelled) {
        const totalMatch = `${result.stdout || ''}\n${result.stderr || ''}`.match(/Total Tests:\s*(\d+)/i);
        const count = totalMatch ? Number(totalMatch[1]) : null;
        if (count === 0) {
          noTests = true;
          steps.push({ id: 'test-inventory', status: 'no-tests-discovered', testCount: 0 });
        } else if (count === null) {
          // New CTest may format --show-only output differently. A structured
          // JSON inventory is the fallback; malformed/unknown inventory is not
          // allowed to become a passing test run.
          const inventory = await execute('discover-tests-json', 'ctest', ['--test-dir', buildRoot, '--show-only=json-v1'], root);
          if (inventory && inventory.code === 0 && !inventory.outputTruncated) {
            try {
              const parsed = JSON.parse(inventory.stdout);
              const tests = Array.isArray(parsed.tests) ? parsed.tests.length : null;
              if (tests === 0) noTests = true;
              else if (tests === null) finalCode = 1;
            } catch { finalCode = 1; }
          } else finalCode = inventory?.code ?? 1;
        }
      }
      if (!noTests && finalCode === 0 && !timedOut && !cancelled && !outputTruncated) {
        result = await execute('build', 'cmake', ['--build', buildRoot, '--config', 'Debug', '--parallel', '2'], root);
        if (result && result.code === 0 && !result.timedOut && !result.cancelled) {
          await execute('ctest', 'ctest', ['--test-dir', buildRoot, '--output-on-failure', '--build-config', 'Debug'], root);
        }
      }
    }
  } finally {
    try { await fs.rm(buildRoot, { recursive: true, force: true }); }
    catch { cleanupComplete = false; }
  }
  const durationMs = Date.now() - startedAt;
  const passed = !noTests && cleanupComplete && finalCode === 0 && !timedOut && !cancelled && !outputTruncated && steps.length >= 4 && steps.slice(0, 4).every((step) => step.status === 'passed');
  const status = noTests ? 'no-tests' : timedOut ? 'timed-out' : cancelled ? 'cancelled' : !cleanupComplete ? 'cleanup-incomplete' : outputTruncated ? (finalCode === 0 ? 'passed-output-truncated' : 'failed-output-truncated') : passed ? 'passed' : 'failed';
  return {
    executed: true, status, passed, evidenceComplete: !outputTruncated && !timedOut && !cancelled && cleanupComplete,
    outputTruncated, outputBytes, exitCode: finalCode, timedOut, cancelled, durationMs, plan,
    steps, cleanupComplete, buildArtifactsRetained: false,
    output, note: noTests ? 'CMake configured successfully but CTest discovered no tests. The run is not considered passed.' : 'CMake configure/build/CTest ran in a disposable temporary directory, which was removed after the run.'
  };
}

export async function runProjectTests({ projectPath = process.cwd(), confirm = false, timeoutMs = 15 * 60 * 1000, runner = runProcess, exists = commandExists } = {}) {
  if (!confirm) throw new Error('Running project test commands executes project-controlled code. Inspect the detected command, then rerun with explicit --confirm.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60 * 60 * 1000) throw new Error('Test timeout must be between 1 and 3600 seconds.');
  const root = path.resolve(projectPath);
  const plan = await detectProjectTestCommand(root, { exists });
  if (!plan) return { executed: false, status: 'not-available', passed: false, plan: null, note: 'No supported conventional test command was detected. No project code was executed.' };
  if (plan.available === false || !(await exists(plan.command)) && !path.isAbsolute(plan.command)) {
    return { executed: false, status: 'tool-missing', passed: false, plan, note: `Required test command ${plan.command} is not available on PATH. No project code was executed.` };
  }
  if (plan.strategy === 'cmake-configure-build-ctest') return runCmakeTestPlan({ root, plan, timeoutMs, runner });
  const startedAt = Date.now();
  const result = await runner(plan.command, plan.args, {
    cwd: root, capture: true, tee: false, timeoutMs, maxOutputBytes: 512 * 1024,
    env: sanitizedEnvironment()
  });
  const safe = normalizeResult(result);
  const outputTruncated = Boolean(result.outputTruncated);
  return {
    executed: true,
    status: testOutcome(result, outputTruncated),
    passed: result.code === 0 && !result.timedOut && !result.cancelled,
    evidenceComplete: !outputTruncated && !result.timedOut && !result.cancelled,
    outputTruncated,
    outputBytes: Number.isFinite(result.outputBytes) ? result.outputBytes : null,
    exitCode: result.code,
    timedOut: Boolean(result.timedOut),
    cancelled: Boolean(result.cancelled),
    durationMs: Date.now() - startedAt,
    plan,
    output: safe
  };
}
