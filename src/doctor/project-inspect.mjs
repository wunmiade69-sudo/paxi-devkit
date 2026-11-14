import fs from 'node:fs/promises';
import path from 'node:path';
import { detectProject } from '../lib/project-detect.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'build', 'dist', 'coverage', '.dart_tool', '.gradle', 'target', '.next', '.expo']);
const MAX_FILES = 1200;
const MAX_DEPTH = 6;
const MAX_TEXT_BYTES = 512 * 1024;

async function isRegularFile(file) {
  const info = await fs.lstat(file).catch(() => null);
  return Boolean(info?.isFile() && !info.isSymbolicLink() && info.size <= MAX_TEXT_BYTES);
}

async function readText(root, relative) {
  const file = path.join(root, relative);
  if (!await isRegularFile(file)) return null;
  return fs.readFile(file, 'utf8').catch(() => null);
}

async function walk(root) {
  const files = [];
  async function visit(directory, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (entry.name.startsWith('.') && entry.name !== '.gitignore' && !/^\.env(?:\.|$)/.test(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(absolute, depth + 1);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  }
  await visit(root, 0);
  return { files, truncated: files.length >= MAX_FILES };
}

function addFinding(findings, severity, code, message, recommendation) {
  findings.push({ severity, code, message, recommendation });
}

function unique(values) { return [...new Set(values)]; }

export async function inspectProject(inputPath = process.cwd()) {
  const root = path.resolve(inputPath);
  const base = detectProject(root);
  const { files, truncated } = await walk(root);
  const fileSet = new Set(files);
  const packageText = await readText(root, 'package.json');
  let packageJson = null;
  let packageJsonError = null;
  if (packageText) {
    try { packageJson = JSON.parse(packageText); }
    catch { packageJsonError = 'package.json is not valid JSON.'; }
  }
  const dependencies = { ...packageJson?.dependencies, ...packageJson?.devDependencies };
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};
  const frameworkSignals = [];
  const languages = new Set();
  const categories = new Set();

  if (fileSet.has('pubspec.yaml')) { languages.add('Dart'); categories.add('mobile'); frameworkSignals.push('Flutter'); }
  if (fileSet.has('CMakeLists.txt') || files.some((name) => /\.(cpp|cc|cxx|hpp|hh|hxx)$/i.test(name))) {
    languages.add('C++'); categories.add('native');
    if (fileSet.has('CMakeLists.txt')) frameworkSignals.push('CMake');
  }
  if (files.some((name) => /\.(c|h)$/i.test(name))) { languages.add('C'); categories.add('native'); }
  if (files.some((name) => /\.py$/i.test(name)) || fileSet.has('pyproject.toml') || fileSet.has('requirements.txt')) languages.add('Python');
  if (fileSet.has('go.mod') || files.some((name) => /\.go$/i.test(name))) languages.add('Go');
  if (fileSet.has('Cargo.toml') || files.some((name) => /\.rs$/i.test(name))) languages.add('Rust');
  if (fileSet.has('composer.json') || files.some((name) => /\.php$/i.test(name))) languages.add('PHP');
  if (fileSet.has('pom.xml') || files.some((name) => /\.java$/i.test(name))) languages.add('Java');
  if (files.some((name) => /\.kt$/i.test(name))) languages.add('Kotlin');
  if (files.some((name) => /\.swift$/i.test(name)) || fileSet.has('Package.swift')) { languages.add('Swift'); categories.add('ios'); }
  if (files.some((name) => /\.(m|mm)$/i.test(name))) languages.add('Objective-C');
  if (files.some((name) => /\.rb$/i.test(name)) || fileSet.has('Gemfile')) languages.add('Ruby');
  if (files.some((name) => /\.exs?$/i.test(name)) || fileSet.has('mix.exs')) languages.add('Elixir');
  if (files.some((name) => /\.scala$/i.test(name)) || fileSet.has('build.sbt')) languages.add('Scala');
  if (files.some((name) => /\.sol$/i.test(name)) || fileSet.has('foundry.toml') || files.some((name) => /^hardhat\.config\./.test(name))) { languages.add('Solidity'); categories.add('smart-contract'); }
  if (files.some((name) => /\.sql$/i.test(name))) languages.add('SQL');
  if (files.some((name) => /\.(sh|ps1|bat)$/i.test(name))) languages.add('Shell');
  if (files.some((name) => /\.(cs|csproj)$/i.test(name))) languages.add('C#');
  if (files.some((name) => /\.(js|jsx|mjs|cjs)$/i.test(name)) || packageJson) languages.add('JavaScript');
  if (files.some((name) => /\.(ts|tsx)$/i.test(name)) || fileSet.has('tsconfig.json')) languages.add('TypeScript');
  if (files.some((name) => /\.html?$/i.test(name))) { languages.add('HTML'); categories.add('website'); }
  if (files.some((name) => /\.css$/i.test(name))) languages.add('CSS');
  if (files.some((name) => /\.(cpp|cc|cxx|hpp|hh|hxx)$/i.test(name))) categories.add('C++ application/library');

  const hasReact = Boolean(dependencies.react || dependencies['react-dom']);
  const hasNext = Boolean(dependencies.next);
  const hasVite = Boolean(dependencies.vite);
  const hasAstro = Boolean(dependencies.astro);
  const hasVue = Boolean(dependencies.vue);
  const hasSvelte = Boolean(dependencies.svelte || dependencies['@sveltejs/kit']);
  const hasAngular = Boolean(dependencies['@angular/core']);
  const hasWebSource = fileSet.has('index.html') || fileSet.has('public/index.html') || files.some((name) => /\.(jsx|tsx|vue|svelte)$/i.test(name));
  if (hasNext) { frameworkSignals.push('Next.js'); categories.add('website'); }
  else if (hasReact && hasVite) { frameworkSignals.push('React + Vite'); categories.add('website'); }
  else if (hasReact) { frameworkSignals.push('React'); categories.add('website'); }
  if (hasAstro) { frameworkSignals.push('Astro'); categories.add('website'); }
  if (hasVue) { frameworkSignals.push('Vue'); categories.add('website'); }
  if (hasSvelte) { frameworkSignals.push('Svelte'); categories.add('website'); }
  if (hasAngular) { frameworkSignals.push('Angular'); categories.add('website'); }
  if (hasWebSource && !packageJson && !frameworkSignals.length) frameworkSignals.push('Static website');
  if (packageJson && !categories.has('website') && (hasReact || hasVite || hasAstro || hasVue || hasSvelte || hasAngular)) categories.add('website');

  if (fileSet.has('foundry.toml')) frameworkSignals.push('Foundry');
  if (files.some((name) => /^hardhat\.config\./.test(name))) frameworkSignals.push('Hardhat');
  if (fileSet.has('CMakeLists.txt')) frameworkSignals.push('CMake build');
  else if (fileSet.has('Makefile')) frameworkSignals.push('Make');
  if (fileSet.has('pyproject.toml')) frameworkSignals.push('Python project');
  if (fileSet.has('Cargo.toml')) frameworkSignals.push('Cargo');
  if (fileSet.has('go.mod')) frameworkSignals.push('Go modules');

  const findings = [];
  if (packageJsonError) addFinding(findings, 'warning', 'package-json-invalid', packageJsonError, 'Repair package.json before running npm or framework commands.');
  if (packageJson && categories.has('website')) {
    if (!scripts.build) addFinding(findings, 'info', 'build-script-missing', 'The web project does not define a build script.', 'Add a project-appropriate production build script when this website is intended to be deployed.');
    if (!scripts.test) addFinding(findings, 'info', 'test-script-missing', 'The web project does not define a test script.', 'Add a test script or document the chosen browser/unit test runner.');
  }
  const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'].filter((name) => fileSet.has(name));
  if (lockfiles.length > 1) addFinding(findings, 'warning', 'multiple-package-locks', `Found multiple package-manager lockfiles: ${lockfiles.join(', ')}.`, 'Choose one package manager and keep one authoritative lockfile to reduce dependency drift.');
  const envFiles = files.filter((name) => /^\.env(?:\.|$)/.test(name) && name !== '.env.example');
  if (envFiles.length) {
    const gitignore = await readText(root, '.gitignore');
    if (!gitignore || !/(^|\n)\s*\.env(?:\*|\s|$)/m.test(gitignore)) {
      addFinding(findings, 'warning', 'env-ignore-check', 'Environment files exist, but .gitignore does not clearly ignore .env files.', 'Review .gitignore and keep real credentials out of Git. PAXI did not read the contents of environment files.');
    }
  }
  if (hasWebSource) {
    const htmlPaths = ['index.html', 'public/index.html'].filter((name) => fileSet.has(name));
    for (const htmlPath of htmlPaths) {
      const html = await readText(root, htmlPath);
      if (!html) continue;
      const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
      const missingAlt = images.filter((tag) => !/\balt\s*=/.test(tag));
      if (missingAlt.length) addFinding(findings, 'warning', 'html-image-alt', `${missingAlt.length} image element(s) in ${htmlPath} do not declare an alt attribute.`, 'Add meaningful alt text for informative images or alt="" for decorative images.');
      const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)];
      const unnamed = buttons.filter((match) => !/\baria-label\s*=|\baria-labelledby\s*=/.test(match[0]) && !match[1].replace(/<[^>]+>/g, '').trim());
      if (unnamed.length) addFinding(findings, 'warning', 'html-button-name', `${unnamed.length} button(s) in ${htmlPath} appear to have no accessible name.`, 'Give each button visible text or an accessible aria-label.');
    }
  }
  if (languages.has('C++')) {
    const hasBuildDefinition = fileSet.has('CMakeLists.txt') || fileSet.has('Makefile') || fileSet.has('meson.build');
    if (!hasBuildDefinition) addFinding(findings, 'info', 'cpp-build-definition-missing', 'C++ source files were found, but no CMakeLists.txt, Makefile or meson.build was detected.', 'Add or identify the intended build system before PAXI attempts compiler-based checks.');
    if (!fileSet.has('CTestTestfile.cmake') && !files.some((name) => /(^|\/)(test|tests)\//i.test(name))) {
      addFinding(findings, 'info', 'cpp-tests-not-detected', 'No obvious C++ test directory or generated CTest file was detected.', 'Consider adding unit tests with the framework already used by the project.');
    }
  }
  if (!files.length) addFinding(findings, 'warning', 'empty-project', 'No regular project files were found within the inspection limits.', 'Check the selected project directory.');

  const supportedNow = ['flutter', 'gradle', 'xcode', 'javascript'].includes(base.framework) || ['expo', 'react-native'].includes(base.framework);
  const inspection = {
    schemaVersion: 1,
    inspectedAt: new Date().toISOString(),
    project: { name: base.name, root, primaryFramework: base.framework, detectionConfidence: base.confidence },
    technologies: { categories: unique([...categories]), languages: unique([...languages]).sort(), frameworks: unique(frameworkSignals) },
    capabilities: {
      existingDevKitDetection: base.framework,
      existingBuildAdapter: ['flutter', 'gradle', 'xcode'].includes(base.framework) ? 'available-with-host-requirements' : 'not-available-for-this-project-type',
      websiteStaticInspection: categories.has('website'),
      reactDetected: hasReact,
      cppDetected: languages.has('C++'),
      inspectionOnly: !['flutter', 'gradle', 'xcode'].includes(base.framework) || categories.has('website') || languages.has('C++')
    },
    inventory: { filesInspected: files.length, truncated, packageManagerLockfiles: lockfiles, scripts: Object.keys(scripts).sort() },
    findings,
    limitations: [
      'This inspection is read-only and does not execute project scripts, compile source code, install dependencies or contact remote services.',
      'Static checks are heuristic; they do not replace browser, device, compiler, accessibility or security testing.',
      'A detected technology is not proof that PAXI can currently build or run that project on this host.'
    ]
  };
  return inspection;
}

export function summarizeFindings(findings = []) {
  return findings.reduce((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] || 0) + 1;
    return counts;
  }, {});
}
