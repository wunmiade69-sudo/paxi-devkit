import test from 'node:test';
import assert from 'node:assert/strict';
import { gitCommand } from '../src/commands/git.mjs';

test('Git wrapper rejects option injection in clone', async () => {
  await assert.rejects(() => gitCommand(['clone', '--upload-pack=bad']), /Usage: paxi git clone/);
});

test('Git wrapper rejects unknown Git subcommands', async () => {
  await assert.rejects(() => gitCommand(['config', '--global', 'core.sshCommand=bad']), /Unsupported PAXI Git action/);
});
