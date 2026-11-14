import { runProcess, commandExists, sanitizedEnvironment } from '../lib/process.mjs';

const PACKAGE = '@paxi/devkit';

export async function updateCommand(args = []) {
  const checkOnly = args.includes('--check');
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown update option: ${unknown[0]}`);
  if (!(await commandExists('npm'))) throw new Error('npm is required for the package self-update command.');
  const check = await runProcess('npm', ['view', PACKAGE, 'version'], { capture: true, env: sanitizedEnvironment() });
  if (check.code !== 0) throw new Error(`Could not check ${PACKAGE} on npm. The package must be published before registry self-update is available.`);
  const latest = check.stdout.trim();
  console.log(`Latest published version: ${latest}`);
  if (checkOnly) return;
  console.log('Updating global PAXI DevKit installation...');
  const result = await runProcess('npm', ['install', '--global', `${PACKAGE}@latest`], { env: sanitizedEnvironment() });
  if (result.code !== 0) throw new Error('Update failed. Check npm permissions and network connectivity.');
  console.log('✓ PAXI DevKit update completed. Run paxi version to verify.');
}
