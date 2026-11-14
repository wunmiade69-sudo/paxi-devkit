import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveText } from '../src/lib/redact.mjs';

test('redacts common API credentials and quoted secret assignments', () => {
  const input = [
    'api_key="two words that must not leave this device"',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
    'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    'Database: postgres://dbuser:dbpass@db.example.net:5432/app',
    'callback=https://example.invalid/?access_token=secret-query-value'
  ].join('\n');
  const result = redactSensitiveText(input);
  assert.equal(result.redacted, true);
  assert.match(result.text, /api_key=\[REDACTED\]/i);
  assert.doesNotMatch(result.text, /two words that must not leave this device/);
  assert.doesNotMatch(result.text, /Bearer abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.doesNotMatch(result.text, /ghp_abcdefghijklmnopqrstuvwxyz1234567890/);
  assert.doesNotMatch(result.text, /dbuser:dbpass@/);
  assert.doesNotMatch(result.text, /access_token=secret-query-value/);
});

test('leaves ordinary compiler diagnostics unchanged', () => {
  const input = 'Execution failed for task :app:compileDebugKotlin';
  const result = redactSensitiveText(input);
  assert.equal(result.text, input);
  assert.equal(result.redacted, false);
});

test('AI response reader rejects oversized content-length before parsing', async () => {
  const { readBoundedJson } = await import('../src/commands/ai.mjs');
  const response = new Response('{"ok":true}', { headers: { 'content-length': '2048' } });
  await assert.rejects(readBoundedJson(response, 1024), /response is too large/i);
});

test('AI response reader rejects oversized streamed bodies', async () => {
  const { readBoundedJson } = await import('../src/commands/ai.mjs');
  const response = new Response('x'.repeat(4096));
  await assert.rejects(readBoundedJson(response, 1024), /exceeded the 1024-byte limit/i);
});

test('AI response reader reports invalid JSON clearly', async () => {
  const { readBoundedJson } = await import('../src/commands/ai.mjs');
  const response = new Response('not json');
  await assert.rejects(readBoundedJson(response), /invalid JSON/i);
});

test('redacts npm tokens, JWTs, Azure key assignments and signed URL parameters', () => {
  const input = [
    'npm token npm_abcdefghijklmnopqrstuvwxyz1234567890',
    'jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturepayload123456',
    'AZURE_STORAGE_KEY=supersecretstoragekey',
    'https://storage.example/file?X-Amz-Signature=deadbeef&sig=othersecret'
  ].join('\n');
  const result = redactSensitiveText(input);
  assert.equal(result.redacted, true);
  assert.doesNotMatch(result.text, /npm_abcdefghijklmnopqrstuvwxyz1234567890/);
  assert.doesNotMatch(result.text, /eyJhbGciOiJIUzI1NiJ9/);
  assert.doesNotMatch(result.text, /supersecretstoragekey/);
  assert.doesNotMatch(result.text, /deadbeef|othersecret/);
});
