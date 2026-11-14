import crypto from 'node:crypto';
import { readJson, writeJsonSecure } from '../lib/safe-store.mjs';
import { AI_VAULT_FILE } from '../lib/paths.mjs';

const VAULT_VERSION = 1;
const AAD = Buffer.from('paxi-ai-vault-v1', 'utf8');
const KEY_ENV = Object.freeze({
  openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY', qwen: ['BAILIAN_API_KEY', 'DASHSCOPE_API_KEY'], kimi: 'MOONSHOT_API_KEY',
  zhipu: 'ZHIPUAI_API_KEY', custom: 'PAXI_AI_API_KEY'
});

function derive(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function validatePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 10 || passphrase.length > 1024) {
    throw new Error('AI vault passphrase must contain 10–1024 characters. It is never stored by PAXI.');
  }
}

function encryptVault(entries, passphrase) {
  validatePassphrase(passphrase);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = derive(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const plaintext = Buffer.from(JSON.stringify({ version: VAULT_VERSION, keys: entries }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: VAULT_VERSION, kdf: 'scrypt', cipher: 'aes-256-gcm',
    providers: Object.keys(entries).sort(),
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64')
  };
}

function decryptVault(record, passphrase) {
  validatePassphrase(passphrase);
  if (!record || record.version !== VAULT_VERSION || record.kdf !== 'scrypt' || record.cipher !== 'aes-256-gcm') {
    throw new Error('Unsupported or invalid PAXI AI vault format.');
  }
  try {
    const key = derive(passphrase, Buffer.from(record.salt, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]);
    const data = JSON.parse(plaintext.toString('utf8'));
    if (data.version !== VAULT_VERSION || !data.keys || typeof data.keys !== 'object' || Array.isArray(data.keys)) throw new Error('Invalid vault payload.');
    return data.keys;
  } catch {
    throw new Error('Could not unlock the AI key vault. Check the passphrase; PAXI cannot recover a lost vault passphrase.');
  }
}

export async function vaultExists() {
  const record = await readJson(AI_VAULT_FILE, null);
  return Boolean(record);
}

export async function listVaultProviders() {
  const record = await readJson(AI_VAULT_FILE, null);
  return record ? (Array.isArray(record.providers) ? record.providers.filter((id) => typeof id === 'string').sort() : []) : [];
}

export async function saveProviderKey(providerId, apiKey, passphrase) {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(providerId)) throw new Error('Invalid provider identifier.');
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 4096 || /[\r\n\0]/.test(apiKey)) throw new Error('API key must be 8–4096 characters with no line breaks or control characters.');
  validatePassphrase(passphrase);
  const existing = await readJson(AI_VAULT_FILE, null);
  const keys = existing ? decryptVault(existing, passphrase) : {};
  keys[providerId] = apiKey;
  await writeJsonSecure(AI_VAULT_FILE, encryptVault(keys, passphrase));
  return { providerId, count: Object.keys(keys).length };
}

export async function removeProviderKey(providerId, passphrase) {
  const existing = await readJson(AI_VAULT_FILE, null);
  if (!existing) return false;
  const keys = decryptVault(existing, passphrase);
  const existed = Object.hasOwn(keys, providerId);
  delete keys[providerId];
  if (Object.keys(keys).length) await writeJsonSecure(AI_VAULT_FILE, encryptVault(keys, passphrase));
  else {
    const { removeFile } = await import('../lib/safe-store.mjs');
    await removeFile(AI_VAULT_FILE);
    await removeFile(`${AI_VAULT_FILE}.bak`);
  }
  return existed;
}

export async function getProviderKey(providerId, { passphrase } = {}) {
  const envNames = providerEnvironmentNames(providerId);
  for (const envName of envNames) if (process.env[envName]) return process.env[envName];
  // Backward compatibility: the old single-key setting remains a fallback for any cloud provider.
  if (process.env.PAXI_AI_API_KEY) return process.env.PAXI_AI_API_KEY;
  const record = await readJson(AI_VAULT_FILE, null);
  if (!record) return null;
  if (!passphrase) return null;
  const keys = decryptVault(record, passphrase);
  return keys[providerId] || null;
}

export function providerEnvironmentNames(providerId) {
  const configured = KEY_ENV[providerId];
  return configured ? (Array.isArray(configured) ? [...configured] : [configured]) : [];
}

export function providerEnvironmentName(providerId) {
  return providerEnvironmentNames(providerId)[0] || null;
}

export async function unlockVault(passphrase) {
  const record = await readJson(AI_VAULT_FILE, null);
  if (!record) throw new Error('No encrypted AI key vault exists yet. Add a key first.');
  return Object.keys(decryptVault(record, passphrase));
}
