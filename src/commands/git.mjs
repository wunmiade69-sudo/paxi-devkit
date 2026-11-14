import { runProcess, commandExists, sanitizedEnvironment } from '../lib/process.mjs';

async function git(args, options = {}) {
  if (!(await commandExists('git'))) throw new Error('Git is not installed or not available on PATH.');
  const result = await runProcess('git', args, { cwd: options.cwd || process.cwd(), capture: options.capture, env: sanitizedEnvironment() });
  if (result.code !== 0) throw new Error(`git ${args[0] || ''} failed (exit code ${result.code}). Check the Git output and repository credentials.`);
  return result;
}

export async function gitCommand(args) {
  const [action, ...rest] = args;
  if (!action || action === 'help') {
    console.log('Usage: paxi git <clone|status|add|commit|push|pull|log> [options]');
    return;
  }
  if (action === 'clone') {
    if (!rest[0] || rest.length > 2 || rest.some((value) => value.startsWith('-'))) throw new Error('Usage: paxi git clone <repository-url> [directory]');
    const remote = rest[0];
    const validRemote = /^(https?:\/\/|ssh:\/\/|git:\/\/|git@|\.\.?\/|\/)/.test(remote);
    if (!validRemote) throw new Error('Use an HTTPS, SSH, Git, or explicit local-path repository URL.');
    return git(['clone', '--', remote, ...(rest[1] ? [rest[1]] : [])]);
  }
  if (action === 'status') return git(['status', '--short', '--branch']);
  if (action === 'add') {
    if (!rest.length) throw new Error('Usage: paxi git add <path...> (review files before staging).');
    return git(['add', '--', ...rest]);
  }
  if (action === 'commit') {
    let message = '';
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '-m' || rest[i] === '--message') message = rest[++i] || '';
      else throw new Error(`Unsupported commit option: ${rest[i]}`);
    }
    if (!message.trim()) throw new Error('Usage: paxi git commit -m "Your message"');
    return git(['commit', '-m', message]);
  }
  if (action === 'push' || action === 'pull') {
    if (rest.length > 2 || rest.some((value) => value.startsWith('-') || !/^[A-Za-z0-9._/@:-]+$/.test(value))) throw new Error(`Usage: paxi git ${action} [remote] [branch]`);
    return git([action, ...rest]);
  }
  if (action === 'log') return git(['log', '--oneline', '-n', '12']);
  throw new Error(`Unsupported PAXI Git action: ${action}. Run paxi git help.`);
}
