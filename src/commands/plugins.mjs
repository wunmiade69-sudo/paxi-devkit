import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CONFIG_DIR } from '../lib/paths.mjs';
import { getStoredConfig } from '../lib/config.mjs';
import { updateJsonSecure, ensureConfigDir } from '../lib/safe-store.mjs';
import { ask } from '../lib/prompt.mjs';
import { VERSION } from '../lib/version.mjs';

const PLUGIN_DIR = path.join(CONFIG_DIR, 'plugins');
const validName = (name) => /^[a-z][a-z0-9-]{1,40}$/.test(name || '');

async function getPluginFiles() {
  await ensureConfigDir();
  const configInfo = await fs.lstat(CONFIG_DIR).catch(() => null);
  if (configInfo && (!configInfo.isDirectory() || configInfo.isSymbolicLink())) throw new Error(`Refusing an unsafe PAXI config directory: ${CONFIG_DIR}`);
  await fs.mkdir(PLUGIN_DIR, { recursive: true, mode: 0o700 });
  const pluginInfo = await fs.lstat(PLUGIN_DIR);
  if (!pluginInfo.isDirectory() || pluginInfo.isSymbolicLink()) throw new Error(`Refusing an unsafe plugin directory: ${PLUGIN_DIR}`);
  await fs.chmod(PLUGIN_DIR, 0o700).catch(() => {});
  const entries = await fs.readdir(PLUGIN_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.mjs')).map((entry) => entry.name).sort();
}

async function inspectPlugin(name) {
  const file = path.join(PLUGIN_DIR, `${name}.mjs`);
  const info = await fs.lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Plugin file is missing or is not a regular file: ${file}`);
  const source = await fs.readFile(file);
  return { file, hash: createHash('sha256').update(source).digest('hex') };
}

function trustMap(config) {
  const value = config.trustedPluginHashes;
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

export async function pluginCommand(args) {
  const [action, name, ...pluginArgs] = args;
  const config = await getStoredConfig();
  const hashes = trustMap(config);
  if (action === 'disable-all' || action === 'enable-all') {
    await updateJsonSecure(path.join(CONFIG_DIR, 'config.json'), {}, (current) => ({ ...current, pluginsDisabled: action === 'disable-all' }));
    console.log(action === 'disable-all' ? '✓ All PAXI plugins disabled.' : '✓ PAXI plugins enabled. Individual plugins still require hash-bound trust.');
    return;
  }
  if (action === 'list') {
    const files = await getPluginFiles();
    console.log(`PAXI plugins directory: ${PLUGIN_DIR}`);
    if (!files.length) return console.log('No local plugins installed.');
    for (const file of files) {
      const id = file.slice(0, -4);
      const savedHash = hashes[id];
      let state = '· not trusted';
      if (savedHash) {
        const current = await inspectPlugin(id).catch(() => null);
        state = current?.hash === savedHash ? '✓ trusted · hash matches' : '! changed · review and trust again';
      }
      console.log(`${state}  ${id}`);
    }
    return;
  }
  if (action === 'trust' || action === 'revoke') {
    if (!validName(name)) throw new Error('Plugin name must use lowercase letters, numbers and hyphens (2–41 characters).');
    let approvedHash = null;
    if (action === 'trust') {
      const inspected = await inspectPlugin(name);
      approvedHash = inspected.hash;
      console.warn('WARNING: a trusted plugin runs arbitrary JavaScript with your user permissions. Hash trust checks integrity, not sandbox safety. Review the source before continuing.');
      if (pluginArgs.includes('--yes')) { /* explicit non-interactive trust acknowledgement */ }
      else if (process.stdin.isTTY) {
        const approval = await ask(`Type TRUST to approve plugin '${name}': `);
        if (approval !== 'TRUST') throw new Error('Plugin trust cancelled.');
      } else throw new Error(`Plugin trust requires interactive confirmation. Review the plugin source, then run paxi plugin trust ${name} --yes.`);
    }
    // Mutate the latest locked config, rather than a snapshot read before acquiring
    // the lock. This prevents concurrent trust/revoke operations from losing updates.
    await updateJsonSecure(path.join(CONFIG_DIR, 'config.json'), {}, (current) => {
      const { trustedPlugins: legacyTrust, ...currentRest } = current;
      const nextHashes = trustMap(current);
      if (action === 'trust') nextHashes[name] = approvedHash;
      else delete nextHashes[name];
      return { ...currentRest, trustedPluginHashes: nextHashes };
    });
    console.log(action === 'trust'
      ? `✓ Trusted '${name}' at its current SHA-256 hash. Any later code change requires re-review and re-trust.`
      : `✓ Revoked trust for '${name}'.`);
    return;
  }
  if (action === 'run') {
    if (!validName(name)) throw new Error('Usage: paxi plugin run <plugin-name> [args...]');
    // Re-read the latest security settings at the execution boundary. The initial
    // config snapshot may have become stale while a user was reviewing a plugin.
    const executionConfig = await getStoredConfig();
    if (executionConfig.pluginsDisabled) throw new Error('All PAXI plugins are globally disabled. Run paxi plugin enable-all to re-enable them.');
    const executionHashes = trustMap(executionConfig);
    const expectedHash = executionHashes[name];
    if (typeof expectedHash !== 'string') throw new Error(`Plugin '${name}' is not trusted. Review its source first, then run paxi plugin trust ${name}.`);
    const inspected = await inspectPlugin(name);
    if (inspected.hash !== expectedHash) throw new Error(`Plugin '${name}' changed after approval. Review the new source and run paxi plugin trust ${name} again.`);
    // Import the exact bytes that were hashed, avoiding a hash-then-file-import TOCTOU window.
    const approvedBytes = await fs.readFile(inspected.file);
    const approvedHash = createHash('sha256').update(approvedBytes).digest('hex');
    if (approvedHash !== expectedHash) throw new Error(`Plugin '${name}' changed during trust verification. Retry after reviewing the file.`);
    const sourceUrl = `data:text/javascript;base64,${approvedBytes.toString('base64')}`;
    const module = await import(sourceUrl);
    const run = module.run || module.default?.run || module.default;
    if (typeof run !== 'function') throw new Error('Plugin must export a run(args, context) function.');
    return run(pluginArgs, { cwd: process.cwd(), version: VERSION, pluginApiVersion: 1 });
  }
  console.log('Usage: paxi plugin <list|trust name [--yes]|revoke name|run name [args...]|disable-all|enable-all>');
}
