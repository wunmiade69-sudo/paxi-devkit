import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runProcess, commandExists, sanitizedEnvironment } from './process.mjs';
import { detectProject } from './project-detect.mjs';

export function isTermuxEnvironment(env = process.env) {
  // Detect the Termux userland, not Android as an operating-system target.
  // Android-hosted Node runtimes may report platform='android' even when a
  // test fixture (or another Android environment) is not running inside
  // Termux. PREFIX is the authoritative Termux installation marker.
  const prefix = typeof env.PREFIX === 'string' ? env.PREFIX : '';
  return prefix.includes('/com.termux/files/usr') && Boolean(env.HOME);
}

export function getTermuxPaths(env = process.env) {
  const prefix = env.PREFIX || '/data/data/com.termux/files/usr';
  return {
    prefix,
    // Some Flutter-for-Termux releases do not ship a per-project helper.
    // PAXI performs the documented edits itself in that case.
    flutterProjectConfig: path.join(prefix, 'share', 'flutter', 'flutter_project_config.sh'),
    flutterPostInstall: path.join(prefix, 'share', 'flutter', 'post_install.sh'),
    flutterBin: path.join(prefix, 'opt', 'flutter', 'bin'),
    androidSdk: path.join(prefix, 'opt', 'android-sdk'),
    aapt2: path.join(prefix, 'bin', 'aapt2')
  };
}

async function existsRegularFile(file) {
  const stat = await fs.lstat(file).catch(() => null);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink());
}

async function setGradleProperty(file, key, value) {
  const stat = await fs.lstat(file).catch(() => null);
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
    throw new Error(`Refusing to modify a non-regular Gradle properties file: ${file}`);
  }
  const previous = stat ? await fs.readFile(file, 'utf8') : '';
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = previous.split(/\r?\n/).filter((line) => !new RegExp(`^\\s*${escapedKey}\\s*=`).test(line));
  while (lines.length && lines.at(-1) === '') lines.pop();
  lines.push(`${key}=${value}`);
  const output = `${lines.join('\n')}\n`;
  await atomicWrite(file, output, stat ? (stat.mode & 0o777) : 0o600);
}

async function configureGradleWrapperTimeout(gradleRoot) {
  const wrapperScript = path.join(gradleRoot, 'gradlew');
  const wrapperProperties = path.join(gradleRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  if (!(await existsRegularFile(wrapperScript)) || !(await existsRegularFile(wrapperProperties))) return null;
  await setGradleProperty(wrapperProperties, 'networkTimeout', '180000');
  return wrapperProperties;
}

async function atomicWrite(file, content, mode = 0o600) {
  const temporary = `${file}.paxi-${process.pid}.tmp`;
  await fs.writeFile(temporary, content, { mode, flag: 'wx' });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function findBlock(source, name) {
  const match = new RegExp(`\\b${name}\\s*\\{`).exec(source);
  if (!match) return null;
  const open = source.indexOf('{', match.index);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start: open, end: index, text: source.slice(open + 1, index) };
    }
  }
  throw new Error(`Could not safely parse the ${name} block in the Android Gradle file.`);
}

function setGradleAndroidValues(source, { kotlinDsl }) {
  const settings = kotlinDsl
    ? [
        [/^(\s*)compileSdk\s*=\s*[^\r\n]+$/m, '$1compileSdk = 36', 'compileSdk'],
        [/^(\s*)targetSdk\s*=\s*[^\r\n]+$/m, '$1targetSdk = 36', 'targetSdk']
      ]
    : [
        [/^(\s*)compileSdkVersion\s+[^\r\n]+$/m, '$1compileSdkVersion 36', 'compileSdkVersion'],
        [/^(\s*)targetSdkVersion\s+[^\r\n]+$/m, '$1targetSdkVersion 36', 'targetSdkVersion']
      ];

  let updated = source;
  for (const [pattern, replacement, label] of settings) {
    if (!pattern.test(updated)) {
      throw new Error(`Could not find a standard ${label} declaration in the Android app Gradle file. Please review the file manually; PAXI will not guess where to insert it.`);
    }
    updated = updated.replace(pattern, replacement);
  }

  const block = findBlock(updated, 'defaultConfig');
  if (!block) throw new Error('Could not find the defaultConfig block in the Android app Gradle file.');
  if (!/\babiFilters\b/.test(block.text)) {
    const lineStart = updated.lastIndexOf('\n', block.end - 1) + 1;
    const closingIndent = (updated.slice(lineStart, block.end).match(/^\s*/) || [''])[0];
    const indent = `${closingIndent}    `;
    const ndkBlock = kotlinDsl
      ? `${indent}ndk {\n${indent}    abiFilters += listOf("arm64-v8a")\n${indent}}\n`
      : `${indent}ndk {\n${indent}    abiFilters 'arm64-v8a'\n${indent}}\n`;
    updated = `${updated.slice(0, lineStart)}${ndkBlock}${updated.slice(lineStart)}`;
  }
  return updated;
}

async function configureFlutterGradleProject(projectRoot, prefix, aapt2) {
  const androidRoot = path.join(projectRoot, 'android');
  const ktsFile = path.join(androidRoot, 'app', 'build.gradle.kts');
  const groovyFile = path.join(androidRoot, 'app', 'build.gradle');
  const appFile = await existsRegularFile(ktsFile) ? ktsFile : await existsRegularFile(groovyFile) ? groovyFile : null;
  if (!appFile) throw new Error(`Flutter Android app Gradle file was not found. Expected ${ktsFile} or ${groovyFile}. Run flutter create or inspect the project structure.`);

  const stat = await fs.lstat(appFile);
  const previous = await fs.readFile(appFile, 'utf8');
  const configured = setGradleAndroidValues(previous, { kotlinDsl: appFile.endsWith('.kts') });
  if (configured !== previous) await atomicWrite(appFile, configured, stat.mode & 0o777);

  const propertiesFile = path.join(androidRoot, 'gradle.properties');
  await setGradleProperty(propertiesFile, 'android.aapt2FromMavenOverride', aapt2);
  await setGradleProperty(propertiesFile, 'org.gradle.workers.max', '2');
  const wrapperPropertiesFile = await configureGradleWrapperTimeout(androidRoot);

  const wrapper = path.join(androidRoot, 'gradlew');
  const wrapperStat = await fs.lstat(wrapper).catch(() => null);
  if (wrapperStat?.isFile() && !wrapperStat.isSymbolicLink()) {
    let wrapperSource = await fs.readFile(wrapper, 'utf8');
    const shell = path.join(prefix, 'bin', 'bash');
    if (wrapperSource.startsWith('#!/usr/bin/env bash') || wrapperSource.startsWith('#!/bin/bash') || wrapperSource.startsWith('#!/usr/bin/bash')) {
      wrapperSource = wrapperSource.replace(/^#![^\r\n]+/, `#!${shell}`);
      await atomicWrite(wrapper, wrapperSource, (wrapperStat.mode & 0o777) | 0o100);
    } else if (!wrapperSource.startsWith('#!')) {
      throw new Error(`Gradle wrapper has no shebang: ${wrapper}. Review it before building.`);
    } else {
      // Flutter's generated /usr/bin/env sh wrapper is not resolvable on Android.
      wrapperSource = wrapperSource.replace(/^#!\/usr\/bin\/env\s+sh/, `#!${path.join(prefix, 'bin', 'sh')}`);
      await atomicWrite(wrapper, wrapperSource, (wrapperStat.mode & 0o777) | 0o100);
    }
  }
  return { appFile, propertiesFile, wrapper, wrapperPropertiesFile };
}

export async function hasAapt2Override(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'android', 'gradle.properties'),
    path.join(projectRoot, 'gradle.properties')
  ];
  for (const file of candidates) {
    try {
      const info = await fs.lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const content = await fs.readFile(file, 'utf8');
      if (/^\s*android\.aapt2FromMavenOverride\s*=\s*\S+/m.test(content)) return true;
    } catch {}
  }
  return false;
}

export async function getTermuxBuildEnvironment(base = sanitizedEnvironment()) {
  const { prefix, flutterBin, androidSdk } = getTermuxPaths();
  const env = { ...base };
  const jvmRoot = path.join(prefix, 'lib', 'jvm');
  const currentJavaHome = env.JAVA_HOME;
  const currentJavaValid = currentJavaHome && await fs.stat(path.join(currentJavaHome, 'bin', 'java')).then(() => true, () => false);
  if (!currentJavaValid) {
    const jvmEntries = await fs.readdir(jvmRoot, { withFileTypes: true }).catch(() => []);
    const choices = jvmEntries.filter((entry) => entry.isDirectory() && /^java-.*-openjdk$/.test(entry.name)).map((entry) => entry.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (choices.length) env.JAVA_HOME = path.join(jvmRoot, choices.at(-1));
  }
  if (await fs.stat(androidSdk).then(() => true, () => false)) {
    env.ANDROID_HOME ||= androidSdk;
    env.ANDROID_SDK_ROOT ||= androidSdk;
  }
  if (await fs.stat(path.join(flutterBin, 'flutter')).then(() => true, () => false)) {
    env.PATH = `${flutterBin}${path.delimiter}${env.PATH || ''}`;
  }
  return env;
}

/** Apply explicit, local Termux Android compatibility settings to a project. */
export async function configureTermuxAndroid({ projectPath = process.cwd() } = {}) {
  if (!isTermuxEnvironment()) {
    throw new Error('This compatibility setup is for Termux on Android. On desktop hosts, configure the Android SDK using the platform tools.');
  }

  const project = detectProject(projectPath);
  if (!['flutter', 'gradle'].includes(project.framework)) {
    throw new Error(`Cannot configure Android for '${project.framework}'. Supported project types: Flutter and Android Gradle.`);
  }

  const { prefix, aapt2, flutterProjectConfig } = getTermuxPaths();
  if (!(await commandExists('aapt2'))) throw new Error(`Termux AAPT2 was not found at ${aapt2}. Install it with: pkg install aapt2`);

  if (project.framework === 'flutter') {
    if (!(await commandExists('flutter'))) throw new Error('Flutter was not found on PATH. Source the Termux Flutter profile first: source "$PREFIX/etc/profile.d/flutter.sh"');
    const vendorHelper = await existsRegularFile(flutterProjectConfig);
    if (vendorHelper) {
      console.log(`Running the installed Termux Flutter project helper for ${project.root}`);
      const result = await runProcess('bash', [flutterProjectConfig], { cwd: project.root, env: sanitizedEnvironment() });
      if (result.code !== 0) throw new Error(`Termux Flutter project configuration failed (exit code ${result.code}).`);
    } else {
      console.log('Termux Flutter distribution has no project helper; applying its documented project settings directly.');
      const files = await configureFlutterGradleProject(project.root, prefix, aapt2);
      console.log(`✓ Android app Gradle configuration: ${files.appFile}`);
      console.log(`✓ Gradle properties: ${files.propertiesFile}`);
      if (files.wrapperPropertiesFile) console.log(`✓ Gradle download timeout: 180 seconds (${files.wrapperPropertiesFile})`);
      if (await fs.stat(files.wrapper).then(() => true, () => false)) console.log(`✓ Gradle wrapper: ${files.wrapper}`);
    }
  } else {
    const propertiesFile = path.join(project.root, 'gradle.properties');
    await setGradleProperty(propertiesFile, 'android.aapt2FromMavenOverride', aapt2);
    await setGradleProperty(propertiesFile, 'org.gradle.workers.max', '2');
    const wrapperPropertiesFile = await configureGradleWrapperTimeout(project.root);
    console.log(`Configured Termux AAPT2 and Gradle worker limits in ${propertiesFile}`);
    if (wrapperPropertiesFile) console.log(`Configured Gradle wrapper network timeout to 180 seconds in ${wrapperPropertiesFile}`);
  }

  console.log('\n✓ Android project configured for the local Termux toolchain.');
  console.log('Review the project diff before committing; PAXI only changed local Android build configuration.');
  return { project, prefix, aapt2 };
}
