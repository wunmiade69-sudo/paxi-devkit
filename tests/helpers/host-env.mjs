/**
 * Return an environment for tests that exercise the generic desktop/Linux path.
 *
 * CI and local development can run the test suite inside Termux. In that case,
 * inheriting PREFIX makes the CLI correctly enable real Termux AAPT2 checks and
 * Gradle worker limits, which is undesirable for fixtures that model an ordinary
 * Linux host. Termux-specific behaviour is covered separately by termux tests.
 */
export function nonTermuxTestEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  // An empty PREFIX is intentional: Termux detection is based on its userland
  // prefix, not on the underlying Android OS platform. All other inherited
  // environment remains available to the test process.
  env.PREFIX = '';
  return env;
}
