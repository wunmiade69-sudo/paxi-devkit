import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateMachine, BUILD_STATE_TRANSITIONS, buildFailureState } from '../src/lib/state-machine.mjs';

test('build state machine records only valid lifecycle transitions', () => {
  const times = [
    '2026-11-09T10:00:00.000Z', '2026-11-09T10:00:01.000Z',
    '2026-11-09T10:00:02.000Z', '2026-11-09T10:00:03.000Z',
    '2026-11-09T10:00:04.000Z'
  ];
  const machine = createStateMachine('build', 'created', BUILD_STATE_TRANSITIONS, { now: () => new Date(times.shift()) });
  machine.transition('preflight');
  machine.transition('building', { platform: 'android' });
  machine.transition('verifying');
  machine.transition('succeeded');
  assert.equal(machine.isTerminal, true);
  assert.deepEqual(machine.snapshot().history.map((entry) => entry.state), ['created', 'preflight', 'building', 'verifying', 'succeeded']);
  assert.throws(() => machine.transition('building'), /Invalid build state transition/);
});

test('build failures distinguish timeout and cancellation terminal states', () => {
  assert.equal(buildFailureState(new Error('Build timed out after 30 seconds')), 'timed_out');
  assert.equal(buildFailureState(new Error('Build was cancelled by Ctrl+C')), 'cancelled');
  assert.equal(buildFailureState(new Error('Compiler exited with code 1')), 'failed');
});


test('state transition metadata cannot overwrite authoritative state or timestamp', () => {
  const machine = createStateMachine('test', 'created', { created: ['done'], done: [] }, {
    now: () => new Date('2026-11-09T12:00:00.000Z')
  });
  machine.transition('done', { state: 'forged', at: 'not-a-date', note: 'preflight complete' });
  const history = machine.snapshot().history;
  assert.equal(history[1].state, 'done');
  assert.equal(history[1].at, '2026-11-09T12:00:00.000Z');
  assert.equal(history[1].note, 'preflight complete');
});
