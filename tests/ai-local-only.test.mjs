import test from 'node:test';
import assert from 'node:assert/strict';
import { aiDoctor, parseUrl } from '../src/commands/ai.mjs';

test('local AI refuses a remote endpoint', async () => {
  process.env.PAXI_AI_MODE = 'local';
  process.env.PAXI_AI_LOCAL_URL = 'https://example.com';
  await assert.rejects(() => aiDoctor(), /Local AI mode requires an HTTP localhost\/loopback endpoint/);
  delete process.env.PAXI_AI_MODE;
  delete process.env.PAXI_AI_LOCAL_URL;
});

test('local AI refuses HTTPS loopback endpoints before saving unusable configuration', () => {
  assert.throws(() => parseUrl('https://127.0.0.1:8080', false), /HTTP localhost\/loopback/);
  assert.equal(parseUrl('http://127.0.0.1:8080', false).hostname, '127.0.0.1');
});
