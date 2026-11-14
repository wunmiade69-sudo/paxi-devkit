/**
 * Small deterministic state-machine primitive for observable local workflows.
 * This intentionally has no persistence or side effects; callers decide where
 * snapshots are stored. Invalid transitions fail loudly during development.
 */
export function createStateMachine(name, initialState, transitions, { now = () => new Date() } = {}) {
  if (!name || typeof name !== 'string') throw new TypeError('State machine name is required.');
  if (!initialState || !Object.hasOwn(transitions || {}, initialState)) {
    throw new TypeError(`Unknown initial state for ${name}: ${initialState}`);
  }

  const allowed = new Map(Object.entries(transitions).map(([state, next]) => [state, new Set(next)]));
  let state = initialState;
  const history = [{ state, at: now().toISOString() }];

  return {
    get state() { return state; },
    get isTerminal() { return (allowed.get(state)?.size || 0) === 0; },
    canTransition(nextState) { return Boolean(allowed.get(state)?.has(nextState)); },
    transition(nextState, details = {}) {
      if (!allowed.get(state)?.has(nextState)) {
        throw new Error(`Invalid ${name} state transition: ${state} -> ${nextState}`);
      }
      if (details === null || typeof details !== 'object' || Array.isArray(details)) {
        throw new TypeError(`State transition details for ${name} must be an object.`);
      }
      state = nextState;
      // Reserved lifecycle fields are authoritative and cannot be overwritten by context.
      history.push({ ...details, state, at: now().toISOString() });
      return state;
    },
    snapshot() {
      return { name, state, history: history.map((entry) => ({ ...entry })) };
    }
  };
}

export const BUILD_STATE_TRANSITIONS = Object.freeze({
  created: ['preflight'],
  preflight: ['building', 'failed', 'cancelled', 'timed_out'],
  building: ['verifying', 'failed', 'cancelled', 'timed_out'],
  verifying: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: []
});

export function buildFailureState(error) {
  if (error?.timedOut || /timed out/i.test(String(error?.message || error))) return 'timed_out';
  if (error?.cancelled || /cancelled|canceled|Ctrl\+C/i.test(String(error?.message || error))) return 'cancelled';
  return 'failed';
}

export const PROCESS_STATE_TRANSITIONS = Object.freeze({
  created: ['starting'],
  starting: ['running', 'terminating', 'failed'],
  running: ['terminating', 'exited', 'failed'],
  terminating: ['cancelled', 'timed_out', 'exited', 'failed'],
  exited: [],
  failed: [],
  cancelled: [],
  timed_out: []
});
