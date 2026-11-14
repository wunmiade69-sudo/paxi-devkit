import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { commandExists, runProcess } from '../lib/process.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/validate-json-schema.py', import.meta.url));
const SHA256 = /^[a-f0-9]{64}$/i;

async function inspectRegularFile(filePath, label, limit) {
  if (!filePath) throw new Error(`${label} path is required.`);
  const absolute = path.resolve(filePath);
  const stat = await fs.lstat(absolute).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink file.`);
  if (stat.size > limit) throw new Error(`${label} exceeds the ${limit}-byte limit.`);
  return { absolute, bytes: await fs.readFile(absolute) };
}

export async function validateSbomAgainstSchema({ filePath, schemaPath, schemaSha256 = null, python = null, runner = runProcess, exists = commandExists } = {}) {
  const [document, schema] = await Promise.all([
    inspectRegularFile(filePath, 'SBOM', 50 * 1024 * 1024),
    inspectRegularFile(schemaPath, 'JSON Schema', 10 * 1024 * 1024)
  ]);
  const actualSchemaHash = createHash('sha256').update(schema.bytes).digest('hex');
  if (schemaSha256 && !SHA256.test(schemaSha256)) throw new Error('--schema-sha256 must be a 64-character hexadecimal SHA-256 digest.');
  if (schemaSha256 && actualSchemaHash !== schemaSha256.toLowerCase()) throw new Error('JSON Schema SHA-256 does not match the supplied pin. Refusing to validate against an unapproved schema snapshot.');
  let pythonCommand = python;
  if (pythonCommand) {
    if (!['python', 'python3'].includes(pythonCommand)) throw new Error('--python must be python or python3.');
    if (!(await exists(pythonCommand))) return { status: 'tool-missing', valid: false, message: `${pythonCommand} is not installed.`, schema: { path: schema.absolute, sha256: actualSchemaHash } };
  } else if (await exists('python3')) pythonCommand = 'python3';
  else if (await exists('python')) pythonCommand = 'python';
  else return { status: 'tool-missing', valid: false, message: 'Python 3 is required for local JSON Schema validation.', schema: { path: schema.absolute, sha256: actualSchemaHash } };

  const result = await runner(pythonCommand, [SCRIPT, document.absolute, schema.absolute], {
    capture: true, tee: false, timeoutMs: 30000, maxOutputBytes: 256 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  if (result.code !== 0 || result.timedOut || result.cancelled) {
    return { status: result.timedOut ? 'timed-out' : 'error', valid: false, schema: { path: schema.absolute, sha256: actualSchemaHash }, message: String(result.stderr || result.error || `Validator exited with code ${result.code}.`).slice(0, 800) };
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error('JSON Schema validator returned non-JSON output; inspect the local Python environment.'); }
  return {
    schemaVersion: 1,
    reportType: 'paxi-sbom-json-schema-validation',
    ...parsed,
    pinned: Boolean(schemaSha256),
    validationLevel: 'official-json-schema-validator-with-external-refs-blocked',
    limitations: ['Validation proves conformance only to the supplied local schema snapshot. Verify its official origin, version and hash before use.', 'External JSON Schema references are blocked; provide a self-contained schema snapshot.', 'A conformant SBOM may still have incomplete component or dependency coverage.']
  };
}
