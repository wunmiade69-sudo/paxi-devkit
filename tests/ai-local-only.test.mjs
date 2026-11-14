import test from 'node:test';
import assert from 'node:assert/strict';
import { aiDoctor } from '../src/commands/ai.mjs';

test('local AI refuses a remote endpoint', async () => {
  process.env.PAXI_AI_MODE = 'local';
  process.env.PAXI_AI_LOCAL_URL = 'https://example.com';
  await assert.rejects(() => aiDoctor(), /Local AI mode only connects to localhost/);
  delete process.env.PAXI_AI_MODE;
  delete process.env.PAXI_AI_LOCAL_URL;
});
