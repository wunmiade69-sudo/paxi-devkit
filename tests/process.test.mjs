import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/lib/process.mjs';

test('runProcess enforces a timeout and terminates a long-running child', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    capture: true, timeoutMs: 150, killGraceMs: 100
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.code, 124);
  assert.equal(result.lifecycle.state, 'timed_out');
  assert.deepEqual(result.lifecycle.history.map((entry) => entry.state), ['created', 'starting', 'running', 'terminating', 'timed_out']);
});

test('runProcess captures output when requested', async () => {
  const result = await runProcess(process.execPath, ['-e', 'console.log("hello paxi")'], { capture: true });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /hello paxi/);
  assert.equal(result.lifecycle.state, 'exited');
});

test('runProcess forwards explicit stdin without shell interpolation', async () => {
  const result = await runProcess(process.execPath, ['-e', 'let data=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => process.stdout.write(data));'], {
    capture: true, stdin: 'select 1; -- paxi-safe-input'
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'select 1; -- paxi-safe-input');
});


test('runProcess explicitly reports when captured stdout/stderr exceeds the configured limit', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("123456"); process.stderr.write("abcdef");'], {
    capture: true, tee: false, maxOutputBytes: 8
  });
  assert.equal(result.code, 0);
  assert.equal(result.outputTruncated, true);
  assert.equal(result.outputBytes, 12);
  assert.equal(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr), 8);
});


test('runProcess reports complete captured output when it stays within the limit', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("short");'], {
    capture: true, tee: false, maxOutputBytes: 64
  });
  assert.equal(result.outputTruncated, false);
  assert.equal(result.outputBytes, 5);
  assert.equal(result.stdout, 'short');
});
