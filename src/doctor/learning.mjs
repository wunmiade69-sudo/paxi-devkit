import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DOCTOR_PROFILE_FILE } from '../lib/paths.mjs';
import { readJson, updateJsonSecure } from '../lib/safe-store.mjs';
import { inspectProject } from './project-inspect.mjs';

const SKIP = new Set(['.git', 'node_modules', 'vendor', 'build', 'dist', 'coverage', '.dart_tool', '.gradle', 'target', '.next', '.expo']);
const SOURCE_EXT = /\.(?:js|jsx|mjs|cjs|ts|tsx|css|scss|html|vue|svelte|py|cpp|cc|cxx|hpp|h|java|kt|go|rs|php|cs)$/i;
const MAX_FILES = 40;
const MAX_BYTES_PER_FILE = 32 * 1024;

async function sourceFiles(root) {
  const found = [];
  async function visit(dir, depth) {
    if (depth > 5 || found.length >= MAX_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (found.length >= MAX_FILES) break;
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) await visit(full, depth + 1);
      } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
        const info = await fs.stat(full).catch(() => null);
        if (info?.size > 0 && info.size <= MAX_BYTES_PER_FILE) found.push(full);
      }
    }
  }
  await visit(root, 0);
  return found;
}

function mostCommon(counts, fallback = 'mixed') {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length || entries[0][1] < 2) return fallback;
  if (entries[1] && entries[0][1] === entries[1][1]) return 'mixed';
  return entries[0][0];
}

function increment(map, key) { map[key] = (map[key] || 0) + 1; }

function analyseStyle(contents) {
  const counts = { quotes: {}, indentation: {}, semicolons: { yes: 0, no: 0 } };
  let cssVariables = 0;
  for (const source of contents) {
    const lines = source.split(/\r?\n/).slice(0, 1200);
    for (const line of lines) {
      if (/^\s*$/.test(line) || /^\s*(?:\/\/|\*|#)/.test(line)) continue;
      const quoteMatches = [...line.matchAll(/(?:^|[^\\])(['"])/g)];
      for (const match of quoteMatches) increment(counts.quotes, match[1] === "'" ? 'single' : 'double');
      if (/^\t+\S/.test(line)) increment(counts.indentation, 'tabs');
      else {
        const leading = line.match(/^( +)\S/);
        if (leading) {
          const n = leading[1].length;
          increment(counts.indentation, n % 4 === 0 ? 'spaces-4' : n % 2 === 0 ? 'spaces-2' : 'spaces-mixed');
        }
      }
      if (/[;]\s*(?:\/\/.*)?$/.test(line)) counts.semicolons.yes += 1;
      else if (/[)}\]]\s*(?:\/\/.*)?$/.test(line) || /\b(?:return|throw|break|continue)\b/.test(line)) counts.semicolons.no += 1;
    }
    cssVariables += (source.match(/--[a-z][a-z0-9-]*\s*:/gi) || []).length;
  }
  return {
    quoteStyle: mostCommon(counts.quotes),
    indentation: mostCommon(counts.indentation),
    semicolons: mostCommon(counts.semicolons, 'mixed'),
    cssCustomPropertiesObserved: cssVariables
  };
}

function detectProjectTools(root, packageJson, files) {
  const dependencies = { ...packageJson?.dependencies, ...packageJson?.devDependencies };
  const names = new Set(files.map((file) => path.basename(file)));
  const packageManager = names.has('pnpm-lock.yaml') ? 'pnpm' : names.has('yarn.lock') ? 'yarn' : names.has('bun.lock') || names.has('bun.lockb') ? 'bun' : names.has('package-lock.json') ? 'npm' : 'not-detected';
  const formatters = [];
  if (dependencies.prettier || names.has('.prettierrc') || names.has('.prettierrc.json')) formatters.push('Prettier');
  if (dependencies['@biomejs/biome'] || names.has('biome.json')) formatters.push('Biome');
  if (dependencies.eslint || names.has('eslint.config.js') || names.has('.eslintrc')) formatters.push('ESLint');
  const uiTools = [];
  for (const [needle, label] of [['tailwindcss', 'Tailwind CSS'], ['@mui', 'MUI'], ['@chakra-ui', 'Chakra UI'], ['styled-components', 'styled-components'], ['nativewind', 'NativeWind'], ['sass', 'Sass']]) {
    if (Object.keys(dependencies).some((name) => name === needle || name.startsWith(`${needle}/`))) uiTools.push(label);
  }
  const testTools = [];
  for (const [needle, label] of [['vitest', 'Vitest'], ['jest', 'Jest'], ['playwright', 'Playwright'], ['cypress', 'Cypress'], ['mocha', 'Mocha']]) if (dependencies[needle]) testTools.push(label);
  return { packageManager, formatters, uiTools, testTools };
}

function normalizeLearned(current) {
  if (!Array.isArray(current)) return [];
  return current.filter((item) => item && typeof item.projectId === 'string' && /^[a-f0-9]{24}$/.test(item.projectId) && typeof item.projectName === 'string' && item.conventions && typeof item.conventions === 'object')
    .slice(0, 12).map((item) => ({ projectId: item.projectId, projectName: item.projectName.slice(0, 80), learnedAt: typeof item.learnedAt === 'string' ? item.learnedAt : null, technologies: Array.isArray(item.technologies) ? item.technologies.slice(0, 24) : [], conventions: item.conventions }));
}

export async function learnProjectConventions(projectPath = process.cwd()) {
  const root = path.resolve(projectPath);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Project directory does not exist: ${root}`);
  const profile = await readJson(DOCTOR_PROFILE_FILE, { schemaVersion: 1, learningMode: 'explicit' });
  if (profile?.learningMode === 'off') throw new Error('Developer learning is disabled. Enable it with `paxi doctor profile learning explicit` before running a learn command.');

  const [inspection, files] = await Promise.all([inspectProject(root), sourceFiles(root)]);
  const contents = [];
  for (const file of files) {
    const value = await fs.readFile(file, 'utf8').catch(() => null);
    if (value !== null) contents.push(value);
  }
  const packageText = await fs.readFile(path.join(root, 'package.json'), 'utf8').catch(() => null);
  let packageJson = null;
  try { packageJson = packageText ? JSON.parse(packageText) : null; } catch {}
  const filesForTools = await (async () => {
    const all = [];
    for (const file of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json', '.prettierrc', '.prettierrc.json', 'biome.json', 'eslint.config.js', '.eslintrc']) {
      if (await fs.lstat(path.join(root, file)).then((x) => x.isFile() && !x.isSymbolicLink()).catch(() => false)) all.push(file);
    }
    return [...all, ...files.map((file) => path.relative(root, file))];
  })();
  const projectId = createHash('sha256').update(root).digest('hex').slice(0, 24);
  const learned = {
    projectId,
    projectName: (typeof packageJson?.name === 'string' && packageJson.name.trim() ? packageJson.name.trim() : inspection.project.name).slice(0, 80),
    learnedAt: new Date().toISOString(),
    technologies: [...inspection.technologies.languages, ...inspection.technologies.frameworks].slice(0, 24),
    conventions: { ...detectProjectTools(root, packageJson, filesForTools), codeStyle: analyseStyle(contents), sampleFiles: contents.length }
  };
  await updateJsonSecure(DOCTOR_PROFILE_FILE, { schemaVersion: 1, learningMode: 'explicit', preferences: {} }, (current) => {
    const previous = normalizeLearned(current?.learnedProjects);
    const rest = previous.filter((item) => item.projectId !== projectId);
    return { ...current, schemaVersion: 1, learnedProjects: [learned, ...rest].slice(0, 12), updatedAt: learned.learnedAt };
  });
  return learned;
}

export async function forgetLearnedProject(projectPath) {
  const root = path.resolve(projectPath);
  const projectId = createHash('sha256').update(root).digest('hex').slice(0, 24);
  let removed = false;
  await updateJsonSecure(DOCTOR_PROFILE_FILE, { schemaVersion: 1, learningMode: 'explicit', preferences: {}, learnedProjects: [] }, (current) => {
    const learnedProjects = normalizeLearned(current?.learnedProjects).filter((item) => {
      const keep = item.projectId !== projectId;
      if (!keep) removed = true;
      return keep;
    });
    return { ...current, schemaVersion: 1, learnedProjects, updatedAt: new Date().toISOString() };
  });
  return removed;
}

export async function clearLearnedProjects() {
  await updateJsonSecure(DOCTOR_PROFILE_FILE, { schemaVersion: 1, learningMode: 'explicit', preferences: {} }, (current) => ({ ...current, schemaVersion: 1, learnedProjects: [], updatedAt: new Date().toISOString() }));
}

export function listLearnedProjects(value) { return normalizeLearned(value); }
