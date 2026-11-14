import { DOCTOR_PROFILE_FILE } from '../lib/paths.mjs';
import { readJson, updateJsonSecure } from '../lib/safe-store.mjs';

export const PROFILE_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  learningMode: 'explicit',
  preferences: {
    guidance: 'step-by-step',
    automation: 'approval-required',
    uiTheme: 'preserve-project',
    dependencyPolicy: 'minimal',
    testingStyle: 'after-changes',
    preferredLanguages: []
  }
});

export const PROFILE_OPTIONS = Object.freeze({
  guidance: ['concise', 'step-by-step', 'detailed'],
  automation: ['manual', 'approval-required', 'proactive-recommendations'],
  uiTheme: ['preserve-project', 'dark', 'light', 'system', 'custom'],
  dependencyPolicy: ['reuse', 'minimal', 'flexible'],
  testingStyle: ['test-first', 'after-changes', 'manual'],
  preferredLanguages: null
});

const cloneDefaults = () => JSON.parse(JSON.stringify(PROFILE_DEFAULTS));

function normalizeProfile(value) {
  const result = cloneDefaults();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  result.learningMode = value.learningMode === 'off' ? 'off' : 'explicit';
  for (const [key, allowed] of Object.entries(PROFILE_OPTIONS)) {
    const incoming = value.preferences?.[key];
    if (key === 'preferredLanguages' && Array.isArray(incoming)) {
      result.preferences.preferredLanguages = [...new Set(incoming.filter((item) => typeof item === 'string' && /^[A-Za-z0-9+#.-]{1,32}$/.test(item)))].slice(0, 20);
    } else if (allowed?.includes(incoming)) {
      result.preferences[key] = incoming;
    }
  }
  if (Array.isArray(value.learnedProjects)) {
    result.learnedProjects = value.learnedProjects.filter((item) => item && typeof item.projectId === 'string' && /^[a-f0-9]{24}$/.test(item.projectId) && typeof item.projectName === 'string' && item.conventions && typeof item.conventions === 'object')
      .slice(0, 12).map((item) => ({
        projectId: item.projectId, projectName: item.projectName.slice(0, 80),
        learnedAt: typeof item.learnedAt === 'string' ? item.learnedAt : null,
        technologies: Array.isArray(item.technologies) ? item.technologies.filter((entry) => typeof entry === 'string').slice(0, 24) : [],
        conventions: item.conventions
      }));
  }
  if (typeof value.updatedAt === 'string') result.updatedAt = value.updatedAt;
  return result;
}

export async function getDoctorProfile() {
  return normalizeProfile(await readJson(DOCTOR_PROFILE_FILE, cloneDefaults()));
}

export async function setDoctorPreference(key, rawValue) {
  if (!Object.hasOwn(PROFILE_OPTIONS, key)) {
    throw new Error(`Unknown preference '${key}'. Available: ${Object.keys(PROFILE_OPTIONS).join(', ')}.`);
  }
  let value;
  if (key === 'preferredLanguages') {
    value = [...new Set(String(rawValue).split(',').map((item) => item.trim()).filter(Boolean))];
    if (!value.length || value.length > 20 || value.some((item) => !/^[A-Za-z0-9+#.-]{1,32}$/.test(item))) {
      throw new Error('preferredLanguages must be a comma-separated list of language names (letters, numbers, +, #, dot and hyphen only).');
    }
  } else {
    value = String(rawValue);
    if (!PROFILE_OPTIONS[key].includes(value)) {
      throw new Error(`${key} must be one of: ${PROFILE_OPTIONS[key].join(', ')}.`);
    }
  }
  const next = await updateJsonSecure(DOCTOR_PROFILE_FILE, cloneDefaults(), (current) => {
    const normalized = normalizeProfile(current);
    normalized.preferences[key] = value;
    normalized.updatedAt = new Date().toISOString();
    return normalized;
  });
  return normalizeProfile(next);
}

export async function setDoctorLearningMode(mode) {
  if (!['explicit', 'off'].includes(mode)) throw new Error('Learning mode must be explicit or off.');
  const next = await updateJsonSecure(DOCTOR_PROFILE_FILE, cloneDefaults(), (current) => ({
    ...normalizeProfile(current), learningMode: mode, updatedAt: new Date().toISOString()
  }));
  return normalizeProfile(next);
}

export async function resetDoctorProfile() {
  const next = { ...cloneDefaults(), updatedAt: new Date().toISOString() };
  await updateJsonSecure(DOCTOR_PROFILE_FILE, cloneDefaults(), () => next);
  return next;
}

