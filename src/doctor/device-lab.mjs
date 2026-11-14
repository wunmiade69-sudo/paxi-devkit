import { DOCTOR_LAB_FILE } from '../lib/paths.mjs';
import { readJson, updateJsonSecure } from '../lib/safe-store.mjs';

export const DEVICE_PROFILES = Object.freeze({
  compact: { label: 'Compact phone', purpose: 'Narrow phone layouts and constrained height', viewportHint: 'small-phone', execution: 'viewport-simulation-or-device' },
  standard: { label: 'Standard phone', purpose: 'Common modern smartphone layout', viewportHint: 'standard-phone', execution: 'viewport-simulation-or-device' },
  large: { label: 'Large phone', purpose: 'Tall or wide smartphone layouts', viewportHint: 'large-phone', execution: 'viewport-simulation-or-device' },
  foldable: { label: 'Foldable', purpose: 'Cover, unfolded and posture-aware layouts', viewportHint: 'foldable-cover-and-unfolded', execution: 'emulator-or-physical-device-required-for-posture' },
  tablet: { label: 'Tablet', purpose: 'Expanded and multi-pane layouts', viewportHint: 'tablet', execution: 'viewport-simulation-or-device' }
});

export const DEVICE_CONDITIONS = Object.freeze({
  font: 'Enlarged system font and text scaling',
  landscape: 'Landscape orientation and width/height changes',
  dark: 'Dark and light theme compatibility',
  keyboard: 'Visible software keyboard, focus and input obstruction',
  zoom: 'Display scaling and enlarged interface',
  offline: 'Disconnected or unavailable network behavior'
});

function normalizeLabStore(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.presets)) return { schemaVersion: 1, presets: [] };
  const presets = value.presets.filter((item) => item && typeof item.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/.test(item.name)
    && Array.isArray(item.profiles) && item.profiles.length > 0 && item.profiles.every((id) => Object.hasOwn(DEVICE_PROFILES, id))
    && Array.isArray(item.conditions) && item.conditions.every((id) => Object.hasOwn(DEVICE_CONDITIONS, id)))
    .map((item) => ({ name: item.name, profiles: [...new Set(item.profiles)], conditions: [...new Set(item.conditions)], ...(typeof item.updatedAt === 'string' ? { updatedAt: item.updatedAt } : {}) }))
    .slice(-30);
  return { schemaVersion: 1, presets };
}

async function readLabStore() {
  return normalizeLabStore(await readJson(DOCTOR_LAB_FILE, { schemaVersion: 1, presets: [] }));
}

export async function listLabPresets() {
  const store = await readLabStore();
  return store.presets;
}

export async function saveLabPreset({ name, profiles, conditions }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/.test(name)) throw new Error('Preset name must be 1–40 safe characters and start with a letter or number.');
  const uniqueProfiles = [...new Set(profiles)];
  const uniqueConditions = [...new Set(conditions)];
  if (!uniqueProfiles.length || uniqueProfiles.some((item) => !Object.hasOwn(DEVICE_PROFILES, item))) throw new Error(`Choose at least one valid profile: ${Object.keys(DEVICE_PROFILES).join(', ')}.`);
  if (uniqueConditions.some((item) => !Object.hasOwn(DEVICE_CONDITIONS, item))) throw new Error(`Unknown condition. Available: ${Object.keys(DEVICE_CONDITIONS).join(', ')}.`);
  let saved;
  await updateJsonSecure(DOCTOR_LAB_FILE, { schemaVersion: 1, presets: [] }, (current) => {
    const store = normalizeLabStore(current);
    const preset = { name, profiles: uniqueProfiles, conditions: uniqueConditions, updatedAt: new Date().toISOString() };
    const existing = store.presets.filter((item) => item.name.toLowerCase() !== name.toLowerCase());
    saved = preset;
    return { schemaVersion: 1, presets: [...existing, preset].slice(-30) };
  });
  return saved;
}

export async function deleteLabPreset(name) {
  let deleted = false;
  await updateJsonSecure(DOCTOR_LAB_FILE, { schemaVersion: 1, presets: [] }, (current) => {
    const store = normalizeLabStore(current);
    const presets = store.presets.filter((item) => {
      const keep = item.name.toLowerCase() !== name.toLowerCase();
      if (!keep) deleted = true;
      return keep;
    });
    return { schemaVersion: 1, presets };
  });
  return deleted;
}

export function buildLabPlan({ profiles, conditions, presetName = null }) {
  const selectedProfiles = [...new Set(profiles)];
  const selectedConditions = [...new Set(conditions)];
  if (!selectedProfiles.length || selectedProfiles.some((item) => !Object.hasOwn(DEVICE_PROFILES, item))) throw new Error(`Choose at least one valid profile: ${Object.keys(DEVICE_PROFILES).join(', ')}.`);
  if (selectedConditions.some((item) => !Object.hasOwn(DEVICE_CONDITIONS, item))) throw new Error(`Unknown condition. Available: ${Object.keys(DEVICE_CONDITIONS).join(', ')}.`);
  return {
    schemaVersion: 1,
    planStatus: 'planned-not-executed',
    presetName,
    createdAt: new Date().toISOString(),
    profiles: selectedProfiles.map((id) => ({ id, ...DEVICE_PROFILES[id] })),
    conditions: selectedConditions.map((id) => ({ id, description: DEVICE_CONDITIONS[id] })),
    plannedCases: selectedProfiles.length * Math.max(1, selectedConditions.length),
    evidenceCollected: false,
    passStatus: 'not-tested',
    note: 'This command creates a reusable test plan only. It does not simulate a device, launch an app or claim any profile passed.'
  };
}
