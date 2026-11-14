import { CONFIG_FILE } from './paths.mjs';
import { readJson, updateJsonSecure } from './safe-store.mjs';

const DEFAULTS = {
  aiMode: 'off',
  aiLocalUrl: 'http://127.0.0.1:8080',
  aiApiUrl: 'https://api.openai.com/v1',
  aiProvider: 'openai-compatible',
  aiModel: 'local-model',
  aiProviderProfiles: {},
  aiRoutes: {}
};
const ALLOWED = new Set(['aiMode', 'aiLocalUrl', 'aiApiUrl', 'aiProvider', 'aiModel', 'aiProviderProfiles', 'aiRoutes']);

export async function getConfig() {
  const fileConfig = await readJson(CONFIG_FILE, {});
  return {
    ...DEFAULTS,
    ...fileConfig,
    aiMode: process.env.PAXI_AI_MODE || fileConfig.aiMode || DEFAULTS.aiMode,
    aiLocalUrl: process.env.PAXI_AI_LOCAL_URL || fileConfig.aiLocalUrl || DEFAULTS.aiLocalUrl,
    aiApiUrl: process.env.PAXI_AI_API_URL || fileConfig.aiApiUrl || DEFAULTS.aiApiUrl,
    aiProvider: process.env.PAXI_AI_PROVIDER || fileConfig.aiProvider || DEFAULTS.aiProvider,
    aiModel: process.env.PAXI_AI_MODEL || fileConfig.aiModel || DEFAULTS.aiModel
  };
}

export async function setConfigValue(key, value) {
  return setConfigValues({ [key]: value });
}

/** Persist a related configuration change as one locked, atomic update. */
export async function setConfigValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new TypeError('Configuration updates must be supplied as an object.');
  }
  const entries = Object.entries(values);
  if (!entries.length) return;
  for (const [key] of entries) {
    if (!ALLOWED.has(key)) throw new Error(`Unsupported config key: ${key}`);
  }
  await updateJsonSecure(CONFIG_FILE, {}, (current) => ({ ...current, ...Object.fromEntries(entries) }));
}

export async function getStoredConfig() {
  return readJson(CONFIG_FILE, {});
}
