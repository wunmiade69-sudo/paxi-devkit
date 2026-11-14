import path from 'node:path';
import { createHash } from 'node:crypto';
import { getDoctorProfile } from './profile.mjs';

const SAFE_TECH = /^[A-Za-z0-9+#.\-/ ]{1,48}$/;
const SAFE_TOOL = new Set(['Prettier', 'Biome', 'ESLint', 'Tailwind CSS', 'MUI', 'Chakra UI', 'styled-components', 'NativeWind', 'Sass', 'Vitest', 'Jest', 'Playwright', 'Cypress', 'Mocha']);
const SAFE_PACKAGE_MANAGER = new Set(['npm', 'pnpm', 'yarn', 'bun', 'not-detected']);
const SAFE_STYLE = new Set(['single', 'double', 'mixed', 'tabs', 'spaces-2', 'spaces-4', 'spaces-mixed', 'yes', 'no']);

function safeLabels(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((item) => typeof item === 'string' && SAFE_TOOL.has(item)))].slice(0, 12);
}

function cleanCodeStyle(value = {}) {
  return {
    quoteStyle: SAFE_STYLE.has(value.quoteStyle) ? value.quoteStyle : 'not-observed',
    indentation: SAFE_STYLE.has(value.indentation) ? value.indentation : 'not-observed',
    semicolons: SAFE_STYLE.has(value.semicolons) ? value.semicolons : 'not-observed',
    cssCustomPropertiesObserved: Number.isInteger(value.cssCustomPropertiesObserved) ? Math.max(0, Math.min(value.cssCustomPropertiesObserved, 10000)) : 0
  };
}

/** Build a small, non-source profile summary. Nothing is persisted by this function. */
export async function buildAdaptiveContext(projectPath = process.cwd(), { includeProjectLearning = true } = {}) {
  const profile = await getDoctorProfile();
  const preferences = profile.preferences || {};
  const context = {
    developerPreferences: {
      guidance: preferences.guidance,
      automation: preferences.automation,
      uiTheme: preferences.uiTheme,
      dependencyPolicy: preferences.dependencyPolicy,
      testingStyle: preferences.testingStyle,
      preferredLanguages: Array.isArray(preferences.preferredLanguages) ? preferences.preferredLanguages.filter((item) => typeof item === 'string' && /^[A-Za-z0-9+#.-]{1,32}$/.test(item)).slice(0, 20) : []
    },
    projectConventions: null,
    privacy: 'Preference and convention metadata only; no source code, absolute paths, credentials, or environment variables.'
  };

  if (!includeProjectLearning || profile.learningMode !== 'explicit') return context;
  const projectId = createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 24);
  const learned = profile.learnedProjects?.find((item) => item.projectId === projectId);
  if (!learned) return context;
  const conventions = learned.conventions || {};
  const codeStyle = conventions.codeStyle || {};
  context.projectConventions = {
    technologies: Array.isArray(learned.technologies) ? learned.technologies.filter((item) => typeof item === 'string' && SAFE_TECH.test(item)).slice(0, 24) : [],
    packageManager: SAFE_PACKAGE_MANAGER.has(conventions.packageManager) ? conventions.packageManager : 'not-detected',
    formatters: safeLabels(conventions.formatters),
    uiTools: safeLabels(conventions.uiTools),
    testTools: safeLabels(conventions.testTools),
    codeStyle: cleanCodeStyle(codeStyle),
    sampleFiles: Number.isInteger(conventions.sampleFiles) ? Math.max(0, Math.min(conventions.sampleFiles, 40)) : 0
  };
  return context;
}
