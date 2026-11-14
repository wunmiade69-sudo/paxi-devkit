import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { AI_MODELS_DIR } from '../lib/paths.mjs';
import { commandExists, runProcess } from '../lib/process.mjs';

export const LOCAL_MODEL_CATALOG = Object.freeze({
  'qwen35-08b-q4km': {
    id: 'qwen35-08b-q4km', name: 'Qwen 3.5 0.8B Q4_K_M', family: 'Qwen', origin: 'China',
    runtime: 'llama.cpp', sizeLabel: '~580 MB', maxBytes: 900_000_000,
    repo: 'bartowski/Qwen_Qwen3.5-0.8B-GGUF', file: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    license: 'Apache-2.0 (verify the repository model card before use)',
    description: 'Small local text model for lightweight explanations and offline assistance. Not a replacement for a larger coding model.'
  },
  'deepseek-r1-15b-q4km': {
    id: 'deepseek-r1-15b-q4km', name: 'DeepSeek R1 Distill Qwen 1.5B Q4_K_M', family: 'DeepSeek', origin: 'China',
    runtime: 'llama.cpp', sizeLabel: '~1.12 GB', maxBytes: 1_500_000_000,
    repo: 'tensorblock/DeepSeek-R1-Distill-Qwen-1.5B-GGUF', file: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf',
    license: 'Community quantization; verify source model and quantization repository licences before use',
    description: 'Compact reasoning model. This is a community quantization, not a model file published by DeepSeek.'
  }
});

export const OLLAMA_STARTER_MODELS = Object.freeze([
  { id: 'qwen3.5:0.8b', origin: 'China', size: '~1.2 GB', note: 'Small multimodal Qwen model; actual runtime needs depend on context and memory.' },
  { id: 'qwen3.5:2b', origin: 'China', size: '~2.7 GB', note: 'Larger Qwen option; check available RAM before pulling.' },
  { id: 'deepseek-r1:1.5b', origin: 'China', size: '~1.1 GB', note: 'Compact reasoning-focused distillation.' }
]);

async function ensureModelDirectory() {
  await fs.mkdir(AI_MODELS_DIR, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(AI_MODELS_DIR);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Model directory is not a regular directory. Refusing to write models there.');
  await fs.chmod(AI_MODELS_DIR, 0o700).catch(() => {});
}

function safeFilename(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,180}\.gguf$/.test(value) || value.includes('..')) throw new Error('Model filename is not a safe GGUF filename.');
  return value;
}

async function getHuggingFaceFileMetadata(repo, filename) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid Hugging Face model repository identifier.');
  const url = `https://huggingface.co/api/models/${repo}/tree/main?recursive=false&expand=true`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not verify model metadata on Hugging Face (HTTP ${response.status}).`);
  const items = await response.json();
  const item = Array.isArray(items) ? items.find((entry) => entry.path === filename && entry.type === 'file') : null;
  const size = Number(item?.size || item?.lfs?.size || 0);
  const sha256 = String(item?.lfs?.oid || '').replace(/^sha256:/, '').toLowerCase();
  if (!item || !Number.isSafeInteger(size) || size < 4 || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('The model file is missing verifiable file metadata (size and SHA-256). PAXI will not download an unverified model file.');
  }
  return { size, sha256 };
}

export async function downloadCatalogModel(modelId, { confirm = false, onProgress = null } = {}) {
  const model = LOCAL_MODEL_CATALOG[modelId];
  if (!model) throw new Error(`Unknown local model ${modelId}. Run paxi ai models catalog.`);
  if (!confirm) throw new Error('Model downloads can use hundreds of megabytes or more. Review the catalogue and rerun with --confirm.');
  await ensureModelDirectory();
  const filename = safeFilename(model.file);
  const destination = path.join(AI_MODELS_DIR, filename);
  const existing = await fs.lstat(destination).catch(() => null);
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Refusing to replace a non-regular model destination.');
    throw new Error(`Model file already exists: ${destination}. Remove it manually only after checking whether it is in use.`);
  }
  const metadata = await getHuggingFaceFileMetadata(model.repo, filename);
  if (metadata.size > model.maxBytes) throw new Error(`Model file is larger than the catalogue safety limit (${metadata.size} bytes).`);
  const free = await fs.statfs(AI_MODELS_DIR).catch(() => null);
  if (free && Number(free.bavail) * Number(free.bsize) < metadata.size * 1.1) throw new Error('Not enough free disk space for this model plus a temporary download file.');
  const url = `https://huggingface.co/${model.repo}/resolve/main/${encodeURIComponent(filename)}?download=true`;
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6 * 60 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status}).`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > model.maxBytes) throw new Error('Model server declared a download larger than the catalogue safety limit.');
  const partial = `${destination}.part-${process.pid}`;
  const handle = await fs.open(partial, 'wx', 0o600);
  const hash = crypto.createHash('sha256');
  let total = 0;
  let first = Buffer.alloc(0);
  try {
    for await (const chunkLike of response.body) {
      const chunk = Buffer.from(chunkLike);
      total += chunk.length;
      if (total > model.maxBytes || total > metadata.size) throw new Error('Model download exceeded the verified file size limit.');
      if (first.length < 4) first = Buffer.concat([first, chunk.subarray(0, 4 - first.length)]);
      hash.update(chunk);
      await handle.write(chunk);
      if (typeof onProgress === 'function') onProgress(total, metadata.size);
    }
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(partial, { force: true });
    throw error;
  }
  await handle.close();
  const actualHash = hash.digest('hex');
  if (first.toString('ascii') !== 'GGUF' || total !== metadata.size || actualHash !== metadata.sha256) {
    await fs.rm(partial, { force: true });
    throw new Error('Downloaded file failed GGUF format, size or SHA-256 verification. The partial file was deleted.');
  }
  await fs.rename(partial, destination);
  await fs.chmod(destination, 0o600).catch(() => {});
  return { ...model, path: destination, bytes: total, sha256: actualHash, verified: true };
}

export async function pullOllamaModel(modelId, { confirm = false, timeoutMs = 6 * 60 * 60 * 1000 } = {}) {
  const item = OLLAMA_STARTER_MODELS.find((model) => model.id === modelId);
  if (!item) throw new Error(`Model is not in the reviewed Ollama starter list. Run paxi ai models catalog.`);
  if (!confirm) throw new Error('Ollama model pulls can download multiple gigabytes. Rerun with --confirm after reviewing the model size.');
  if (!await commandExists('ollama')) throw new Error('Ollama CLI was not found. Install the Ollama runtime first, or use `paxi ai models download <catalog-id> --confirm` for a GGUF file to run with llama.cpp.');
  const result = await runProcess('ollama', ['pull', modelId], { timeoutMs, tee: true, maxOutputBytes: 256 * 1024 });
  if (result.code !== 0) throw new Error(`Ollama model pull failed (${result.code}). ${result.stderr.slice(-1000)}`);
  return item;
}

export async function listInstalledModels() {
  const models = [];
  if (await commandExists('ollama')) {
    const result = await runProcess('ollama', ['list'], { capture: true, tee: false, timeoutMs: 15000, maxOutputBytes: 256 * 1024 });
    if (result.code === 0) models.push(...result.stdout.split(/\r?\n/).slice(1).filter(Boolean).map((line) => ({ runtime: 'ollama', entry: line.trim() })));
  }
  await ensureModelDirectory();
  for (const name of await fs.readdir(AI_MODELS_DIR)) {
    if (name.endsWith('.gguf')) {
      const info = await fs.lstat(path.join(AI_MODELS_DIR, name));
      if (!info.isFile() || info.isSymbolicLink()) continue;
      models.push({ runtime: 'llama.cpp', name, path: path.join(AI_MODELS_DIR, name), bytes: info.size });
    }
  }
  return models;
}

export function getModelCatalog() {
  return {
    ollama: OLLAMA_STARTER_MODELS,
    gguf: Object.values(LOCAL_MODEL_CATALOG).map(({ id, name, origin, sizeLabel, runtime, license, description }) => ({ id, name, origin, size: sizeLabel, runtime, license, description }))
  };
}
