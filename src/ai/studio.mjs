import { getConfig, setConfigValues } from '../lib/config.mjs';
import { ask, askSecret } from '../lib/prompt.mjs';
import { PROVIDERS, AI_ROLES, getProvider, maskKey } from './providers.mjs';
import { getProviderKey, saveProviderKey, removeProviderKey, listVaultProviders, vaultExists, unlockVault, providerEnvironmentNames } from './vault.mjs';
import { getModelCatalog, listInstalledModels, downloadCatalogModel, pullOllamaModel } from './models.mjs';
import { modelListEndpoint, readJsonBounded } from './transport.mjs';

function safeModelId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 180 || /[\r\n\0]/.test(value)) throw new Error('Model ID must be 1–180 characters with no control characters.');
  return value.trim();
}

export function validateProviderEndpoint(providerId, value) {
  const provider = getProvider(providerId);
  let url;
  try { url = new URL(value); } catch { throw new Error('Provider endpoint is not a valid URL.'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('Provider endpoint cannot contain credentials, query strings or fragments.');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (provider.category === 'local') {
    if (url.protocol !== 'http:' || !loopback) throw new Error('Local model endpoints must use HTTP on localhost/loopback only.');
  } else if (url.protocol !== 'https:') throw new Error('Cloud provider endpoints must use HTTPS.');
  return url;
}

export async function getProviderBaseUrl(providerId) {
  const config = await getConfig();
  const provider = getProvider(providerId);
  const override = config.aiProviderProfiles?.[providerId]?.baseUrl;
  const value = override || provider.baseUrl;
  if (!value) throw new Error('Custom provider needs an endpoint. Run paxi ai provider endpoint custom <https-url>.');
  return validateProviderEndpoint(providerId, value).toString().replace(/\/$/, '');
}

export async function saveProviderEndpoint(providerId, baseUrl) {
  validateProviderEndpoint(providerId, baseUrl);
  const config = await getConfig();
  const profiles = { ...(config.aiProviderProfiles || {}), [providerId]: { ...(config.aiProviderProfiles?.[providerId] || {}), baseUrl: baseUrl.replace(/\/$/, '') } };
  await setConfigValues({ aiProviderProfiles: profiles });
  return profiles[providerId];
}

export async function saveAiRoute(role, providerId, model) {
  if (!AI_ROLES.includes(role)) throw new Error(`Role must be one of: ${AI_ROLES.join(', ')}.`);
  const provider = getProvider(providerId);
  const modelId = safeModelId(model);
  const config = await getConfig();
  const routes = { ...(config.aiRoutes || {}), [role]: { provider: providerId, model: modelId } };
  const aiMode = provider.category === 'local' ? 'local' : 'api';
  const updates = { aiRoutes: routes, aiMode };
  if (provider.category === 'local') updates.aiLocalUrl = await getProviderBaseUrl(providerId).catch(() => provider.baseUrl);
  else {
    updates.aiProvider = providerId;
    updates.aiApiUrl = await getProviderBaseUrl(providerId).catch(() => provider.baseUrl);
    updates.aiModel = modelId;
  }
  await setConfigValues(updates);
  return routes[role];
}

export async function discoverModels(providerId, { passphrase } = {}) {
  const provider = getProvider(providerId);
  const baseUrl = await getProviderBaseUrl(providerId);
  let apiKey = null;
  if (provider.category !== 'local') apiKey = await getProviderKey(providerId, { passphrase });
  if (provider.category !== 'local' && !apiKey) throw new Error(`No key for ${provider.name}. Use paxi ai key add ${providerId} or set ${[provider.envKey, ...(provider.envAliases || [])].filter(Boolean).join(' or ')}.`);
  const headers = {};
  if (provider.protocol === 'anthropic') { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'; }
  else if (provider.protocol === 'gemini') headers['x-goog-api-key'] = apiKey;
  else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const url = modelListEndpoint(providerId, baseUrl);
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  let data;
  try { data = await readJsonBounded(response, 2 * 1024 * 1024); } catch { throw new Error(`Provider model list returned invalid or oversized JSON (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(`Provider model discovery failed (HTTP ${response.status}): ${String(data?.error?.message || data?.message || 'request failed').slice(0, 500)}`);
  const rows = data?.data || data?.models || [];
  const ids = rows.map((item) => String(item.id || item.name || '').replace(/^models\//, '')).filter((id) => id && id.length <= 180).sort();
  return [...new Set(ids)];
}

export async function aiProvidersCommand() {
  console.log('\nPAXI AI providers');
  console.log('Region labels describe provider origin/default endpoints, not a guarantee of data residency. Verify regional terms with each vendor.\n');
  for (const provider of Object.values(PROVIDERS)) {
    console.log(`${provider.id.padEnd(10)} ${provider.name} — ${provider.region} [${provider.category}]`);
    if (provider.suggestedModels.length) console.log(`           Starter models: ${provider.suggestedModels.join(', ')}`);
    console.log(`           ${provider.notes}`);
  }
}

async function addKey(providerId) {
  const provider = getProvider(providerId);
  if (provider.category === 'local') throw new Error('Local runtimes do not use provider API keys.');
  if (providerId === 'custom' && !await getProviderBaseUrl('custom').catch(() => null)) throw new Error('Configure your custom HTTPS endpoint first.');
  const key = await askSecret(`Enter ${provider.name} API key (hidden): `);
  if (!key || key.length < 8 || /[\r\n\0]/.test(key)) throw new Error('API key was empty or invalid. No key was saved.');
  let passphrase;
  if (await vaultExists()) passphrase = await askSecret('Unlock the PAXI AI vault passphrase (hidden): ');
  else {
    passphrase = await askSecret('Create a PAXI AI vault passphrase (10+ characters, hidden): ');
    const repeat = await askSecret('Confirm vault passphrase (hidden): ');
    if (passphrase !== repeat) throw new Error('Passphrases did not match. No key was saved.');
  }
  await saveProviderKey(providerId, key, passphrase);
  console.log(`✓ ${provider.name} API key encrypted and saved. PAXI does not display it again.`);
}

async function removeKey(providerId) {
  getProvider(providerId);
  if (!await vaultExists()) return console.log('No encrypted AI key vault exists.');
  const passphrase = await askSecret('Unlock the PAXI AI vault passphrase (hidden): ');
  const removed = await removeProviderKey(providerId, passphrase);
  console.log(removed ? `✓ Removed the encrypted ${providerId} API key.` : `No saved key was found for ${providerId}.`);
}

export async function aiKeyCommand(args = []) {
  const [action, providerId] = args;
  if (action === 'add' && providerId) return addKey(providerId);
  if (action === 'remove' && providerId) return removeKey(providerId);
  if (action === 'status') {
    const saved = await listVaultProviders();
    console.log('Encrypted AI vault: ', await vaultExists() ? 'present' : 'not created');
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      if (provider.category === 'local') continue;
      const envNames = providerEnvironmentNames(id);
      const activeEnv = envNames.find((name) => process.env[name]);
      console.log(`${id.padEnd(10)} ${activeEnv ? `environment key available (${activeEnv})` : saved.includes(id) ? 'encrypted key saved' : 'not configured'}`);
    }
    console.log('Legacy PAXI_AI_API_KEY: ', process.env.PAXI_AI_API_KEY ? 'available' : 'not set');
    console.log('Key values are never printed.');
    return;
  }
  throw new Error('Usage: paxi ai key add <provider> | remove <provider> | status');
}

export async function aiModelsCommand(args = []) {
  const [action, value, ...flags] = args;
  if (action === 'catalog' || action === 'list') {
    const catalog = getModelCatalog();
    console.log('\nOllama model catalogue (pull requires local Ollama runtime):');
    for (const m of catalog.ollama) console.log(`  ${m.id.padEnd(26)} ${m.size.padEnd(10)} ${m.origin} — ${m.note}`);
    console.log('\nGGUF downloads for llama.cpp (downloaded files are checksum-verified):');
    for (const m of catalog.gguf) console.log(`  ${m.id.padEnd(26)} ${m.size.padEnd(10)} ${m.origin} — ${m.description}\n    License: ${m.license}`);
    console.log('\nRun paxi ai models installed to inspect downloaded models and Ollama tags.');
    return;
  }
  if (action === 'installed') {
    const models = await listInstalledModels();
    if (!models.length) return console.log('No local AI models detected. Use paxi ai models catalog.');
    for (const model of models) console.log(`${model.runtime}: ${model.entry || model.name}${model.path ? ` — ${model.path}` : ''}${model.bytes ? ` (${(model.bytes / 1024 ** 3).toFixed(2)} GiB)` : ''}`);
    return;
  }
  if (action === 'download' && value) {
    const confirm = flags.includes('--confirm');
    const result = await downloadCatalogModel(value, { confirm, onProgress: (done, total) => {
      const pct = Math.min(100, Math.floor(done / total * 100));
      process.stdout.write(`\rDownloading ${resultLabel(value)}: ${pct}% (${(done / 1024 ** 2).toFixed(0)} / ${(total / 1024 ** 2).toFixed(0)} MiB)`);
    } });
    console.log(`\n✓ Downloaded and verified ${result.name}.`);
    console.log(`File: ${result.path}`);
    console.log(`SHA-256: ${result.sha256}`);
    console.log('Start llama-server with this GGUF file to use it locally.');
    return result;
  }
  if (action === 'pull' && value) {
    const result = await pullOllamaModel(value, { confirm: flags.includes('--confirm') });
    console.log(`✓ Ollama model pull completed: ${result.id}`);
    return result;
  }
  if (action === 'discover' && value) {
    const provider = getProvider(value);
    let passphrase;
    if (provider.category !== 'local' && await vaultExists() && !providerEnvironmentNames(value).some((name) => process.env[name])) {
      passphrase = process.env.PAXI_AI_VAULT_PASSPHRASE || await askSecret('Unlock the PAXI AI vault passphrase (hidden): ');
      await unlockVault(passphrase);
    }
    const models = await discoverModels(value, { passphrase });
    console.log(models.length ? `Available models for ${value}:\n${models.map((m) => `  ${m}`).join('\n')}` : `No models were returned by ${value}.`);
    return models;
  }
  throw new Error('Usage: paxi ai models <catalog|installed|discover <provider>|download <catalog-id> --confirm|pull <ollama-model> --confirm>');
}

function resultLabel(id) { return LOCAL_MODEL_CATALOG_LABELS[id] || id; }
const LOCAL_MODEL_CATALOG_LABELS = { 'qwen35-08b-q4km': 'Qwen 3.5 0.8B', 'deepseek-r1-15b-q4km': 'DeepSeek R1 1.5B' };

export async function aiRouteCommand(args = []) {
  const [action, role, providerId, model, ...rest] = args;
  const config = await getConfig();
  if (action === 'show' || action === 'list') {
    console.log('AI model routes:');
    for (const item of AI_ROLES) {
      const route = config.aiRoutes?.[item];
      console.log(`  ${item.padEnd(8)} ${route ? `${route.provider} / ${route.model}` : 'not assigned'}`);
    }
    console.log('Assign one with: paxi ai route set <role> <provider> <model>');
    return;
  }
  if (action === 'set' && role && providerId && model && !rest.length) {
    const result = await saveAiRoute(role, providerId, model);
    console.log(`✓ ${role} model route set to ${result.provider} / ${result.model}.`);
    return result;
  }
  throw new Error('Usage: paxi ai route show | set <general|coding|vision|journey> <provider> <model>');
}

export async function aiProviderCommand(args = []) {
  const [action, providerId, value] = args;
  if (action === 'endpoint' && providerId && value) {
    const profile = await saveProviderEndpoint(providerId, value);
    console.log(`✓ ${providerId} endpoint saved: ${new URL(profile.baseUrl).origin}${new URL(profile.baseUrl).pathname}`);
    return;
  }
  if (action === 'use' && providerId) {
    const provider = getProvider(providerId);
    const model = value || provider.suggestedModels[0];
    if (!model) throw new Error('Supply a model ID: paxi ai provider use <provider> <model>.');
    return aiRouteCommand(['set', 'general', providerId, model]);
  }
  throw new Error('Usage: paxi ai provider endpoint <provider> <https-url> | use <provider> <model>');
}

export async function aiLocalCommand(args = []) {
  const [action] = args;
  if (action === 'status') {
    const installed = await listInstalledModels();
    console.log(`Local models detected: ${installed.length}`);
    for (const entry of installed) console.log(`  ${entry.runtime}: ${entry.entry || entry.name}`);
    console.log('Ollama default endpoint: http://127.0.0.1:11434/v1');
    console.log('llama.cpp default endpoint: http://127.0.0.1:8080/v1');
    return;
  }
  throw new Error('Usage: paxi ai local status');
}

export async function aiStudio() {
  if (!process.stdin.isTTY) throw new Error('AI Studio requires an interactive terminal. Use paxi ai providers, key, models and route commands in scripts.');
  while (true) {
    console.log('\n╭────────────────────────────────────────╮');
    console.log('│              PAXI AI STUDIO            │');
    console.log('│  Cloud providers · Local models · Keys │');
    console.log('╰────────────────────────────────────────╯');
    console.log('1. Browse US and China providers');
    console.log('2. Add encrypted provider API key');
    console.log('3. Discover available provider models');
    console.log('4. Assign a model to a task');
    console.log('5. Browse/download local models');
    console.log('6. Show configured model routes');
    console.log('7. Check local model runtime');
    console.log('8. Check key configuration');
    console.log('9. Remove a provider key');
    console.log('10. Configure a provider endpoint/region');
    console.log('11. List installed local models');
    console.log('12. Test a configured model route');
    console.log('0. Exit AI Studio');
    const choice = await ask('Select an action: ');
    if (choice === '0') return;
    try {
      if (choice === '1') await aiProvidersCommand();
      else if (choice === '2') {
        const providerId = await ask(`Provider ID (${Object.keys(PROVIDERS).filter((id) => PROVIDERS[id].category !== 'local').join(', ')}): `);
        await addKey(providerId);
      } else if (choice === '3') {
        const providerId = await ask(`Provider ID (${Object.keys(PROVIDERS).join(', ')}): `);
        await aiModelsCommand(['discover', providerId]);
      } else if (choice === '4') {
        const role = await ask(`Task role (${AI_ROLES.join(', ')}): `);
        const providerId = await ask(`Provider ID (${Object.keys(PROVIDERS).join(', ')}): `);
        const provider = getProvider(providerId);
        const discover = await ask('Discover available model IDs first? [Y/n]: ');
        if (discover.toLowerCase() !== 'n') {
          try { await aiModelsCommand(['discover', providerId]); }
          catch (error) { console.log(`Model discovery unavailable: ${error.message}`); }
        }
        const model = await ask(`Exact model ID${provider.suggestedModels[0] ? ` [${provider.suggestedModels[0]}]` : ''}: `);
        const selected = model || provider.suggestedModels[0];
        if (!selected) throw new Error('Enter a model ID returned by discovery or listed by the provider.');
        await aiRouteCommand(['set', role, providerId, selected]);
      } else if (choice === '5') {
        await aiModelsCommand(['catalog']);
        const runtime = await ask('Download type: gguf or ollama (blank to return): ');
        if (!runtime) continue;
        if (!['gguf', 'ollama'].includes(runtime.toLowerCase())) throw new Error('Choose gguf or ollama.');
        const modelId = await ask('Exact catalogue model ID: ');
        if (!modelId) continue;
        const confirmation = await ask('This download uses storage and network data. Type DOWNLOAD to continue: ');
        if (confirmation !== 'DOWNLOAD') { console.log('Download cancelled.'); continue; }
        if (runtime.toLowerCase() === 'ollama') await aiModelsCommand(['pull', modelId, '--confirm']);
        else await aiModelsCommand(['download', modelId, '--confirm']);
      } else if (choice === '6') await aiRouteCommand(['show']);
      else if (choice === '7') await aiLocalCommand(['status']);
      else if (choice === '8') await aiKeyCommand(['status']);
      else if (choice === '9') {
        const providerId = await ask('Provider ID to remove: ');
        await removeKey(providerId);
      } else if (choice === '10') {
        const providerId = await ask(`Provider ID (${Object.keys(PROVIDERS).filter((id) => id !== 'ollama' && id !== 'llamacpp').join(', ')}): `);
        const endpoint = await ask('HTTPS base URL (local providers must use loopback HTTP): ');
        await saveProviderEndpoint(providerId, endpoint);
        console.log(`✓ ${providerId} endpoint saved.`);
      } else if (choice === '11') await aiModelsCommand(['installed']);
      else if (choice === '12') {
        const role = await ask(`Task role (${AI_ROLES.join(', ')}): `);
        const { aiAsk } = await import('../commands/ai.mjs');
        await aiAsk('Reply with exactly: PAXI AI Studio connection test passed.', { role: AI_ROLES.includes(role) ? role : 'general', includeProfile: false });
      } else console.log('Choose one of the listed AI Studio actions.');
    } catch (error) {
      console.error(`AI Studio: ${error.message}`);
    }
  }
}

export async function resolveConfiguredRoute(role = 'general') {
  const config = await getConfig();
  if (config.aiMode === 'off') throw new Error('AI is disabled. Run paxi ai studio or paxi ai setup to choose a provider and model.');
  const route = config.aiRoutes?.[role] || config.aiRoutes?.general;
  if (route?.provider && route?.model) {
    const provider = getProvider(route.provider);
    return { providerId: route.provider, model: route.model, baseUrl: await getProviderBaseUrl(route.provider), local: provider.category === 'local', config };
  }
  if (config.aiMode === 'api') {
    const providerId = config.aiProvider && config.aiProvider !== 'openai-compatible' && PROVIDERS[config.aiProvider] ? config.aiProvider : 'custom';
    const provider = getProvider(providerId);
    const baseUrl = providerId === 'custom' ? config.aiApiUrl : await getProviderBaseUrl(providerId);
    return { providerId, model: config.aiModel, baseUrl, local: false, config };
  }
  if (config.aiMode === 'local') {
    return { providerId: 'llamacpp', model: 'local-model', baseUrl: config.aiLocalUrl, local: true, config };
  }
  throw new Error('AI is disabled. Run paxi ai studio or paxi ai setup to choose a provider and model.');
}

export async function unlockProviderKeyForRequest(providerId) {
  const provider = getProvider(providerId);
  if (provider.category === 'local') return null;
  for (const name of providerEnvironmentNames(providerId)) if (process.env[name]) return process.env[name];
  // Preserve the original single-key configuration for routes migrated from V0.8 and earlier.
  if (process.env.PAXI_AI_API_KEY) return process.env.PAXI_AI_API_KEY;
  if (!await vaultExists()) return null;
  const passphrase = process.env.PAXI_AI_VAULT_PASSPHRASE || await askSecret('Unlock PAXI AI key vault for this request (hidden): ');
  await unlockVault(passphrase);
  return getProviderKey(providerId, { passphrase });
}
