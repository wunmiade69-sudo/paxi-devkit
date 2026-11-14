import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createStateMachine, PROCESS_STATE_TRANSITIONS } from './state-machine.mjs';

export function sanitizedEnvironment() {
  const env = { ...process.env };
  delete env.PAXI_AI_API_KEY;
  delete env.PAXI_AI_VAULT_PASSPHRASE;
  for (const name of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','DEEPSEEK_API_KEY','BAILIAN_API_KEY','DASHSCOPE_API_KEY','MOONSHOT_API_KEY','ZHIPUAI_API_KEY']) delete env[name];
  return env;
}

function signalChild(child, signal) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // child.kill() only targets PowerShell/cmd itself. Kill the complete process
    // tree so Gradle, Flutter and their compiler children cannot outlive a timeout.
    try {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore', shell: false, windowsHide: true
      });
      killer.unref?.();
    } catch {
      try { child.kill(signal); } catch {}
    }
    return;
  }
  try { process.kill(-child.pid, signal); }
  catch { try { child.kill(signal); } catch {} }
}

async function resolveWindowsScript(command, env) {
  const suffix = path.extname(command).toLowerCase();
  if (suffix === '.bat' || suffix === '.cmd') return command;
  const suffixes = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';');
  const directories = command.includes('\\') || command.includes('/')
    ? [path.dirname(command)]
    : (env.PATH || '').split(path.delimiter);
  const base = command.includes('\\') || command.includes('/') ? path.basename(command) : command;
  for (const directory of directories) {
    if (!directory) continue;
    for (const extension of suffixes) {
      if (!['.BAT', '.CMD'].includes(extension.toUpperCase())) continue;
      const candidate = path.join(directory, `${base}${extension}`);
      const info = await fsp.stat(candidate).catch(() => null);
      if (info?.isFile()) return candidate;
    }
  }
  return null;
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function runProcess(command, args = [], options = {}) {
  const lifecycle = createStateMachine('process', 'created', PROCESS_STATE_TRANSITIONS);
  lifecycle.transition('starting', { command: path.basename(command) });
  const childEnv = options.env || process.env;
  let executable = command;
  let spawnArgs = args;
  if (process.platform === 'win32') {
    const batchFile = await resolveWindowsScript(command, childEnv);
    if (batchFile) {
      const script = `& ${quotePowerShell(batchFile)}${args.length ? ` ${args.map(quotePowerShell).join(' ')}` : ''}; exit $LASTEXITCODE`;
      const powershell = path.join(childEnv.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      executable = powershell;
      spawnArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
    }
  }
  return new Promise((resolve) => {
    const capture = Boolean(options.capture);
    const logFile = options.logFile ? path.resolve(options.logFile) : null;
    const piped = capture || Boolean(logFile);
    const hasInput = options.stdin !== undefined && options.stdin !== null;
    if (hasInput && !(typeof options.stdin === 'string' || Buffer.isBuffer(options.stdin))) {
      resolve({ code: 2, signal: null, stdout: '', stderr: '', timedOut: false, cancelled: false, error: 'stdin must be a string or Buffer.', logFile, lifecycle: lifecycle.snapshot() });
      return;
    }
    const child = spawn(executable, spawnArgs, {
      cwd: options.cwd || process.cwd(),
      env: childEnv,
      stdio: piped || hasInput ? [hasInput ? 'pipe' : 'ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32'
    });
    const limit = Number.isFinite(options.maxOutputBytes) ? Math.max(0, options.maxOutputBytes) : 2 * 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let capturedBytes = 0;
    let outputBytes = 0;
    let outputTruncated = false;
    let logStream = null;
    let timeoutTimer = null;
    let killTimer = null;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const finish = (code, signal, error = null) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      process.removeListener('SIGINT', onInterrupt);
      if (logStream) logStream.end();
      if (!lifecycle.isTerminal) {
        const finalState = error ? 'failed' : cancelled ? 'cancelled' : timedOut ? 'timed_out' : code === 0 ? 'exited' : 'failed';
        lifecycle.transition(finalState, { code: code ?? null, signal: signal || null, ...(error ? { error: error.message } : {}) });
      }
      resolve({
        code: error ? 127 : (cancelled ? 130 : timedOut ? 124 : (code ?? 1)), signal,
        stdout, stderr,
        outputBytes, outputTruncated,
        timedOut, cancelled,
        error: error ? `Could not start ${command}: ${error.message}` : null,
        logFile,
        lifecycle: lifecycle.snapshot()
      });
    };

    const terminate = (reason) => {
      if (settled || child.killed || lifecycle.state === 'terminating') return;
      if (reason === 'timeout') timedOut = true;
      if (reason === 'interrupt') cancelled = true;
      lifecycle.transition('terminating', { reason });
      signalChild(child, 'SIGTERM');
      killTimer = setTimeout(() => signalChild(child, 'SIGKILL'), options.killGraceMs ?? 1500);
      killTimer.unref?.();
    };
    const onInterrupt = () => terminate('interrupt');

    if (logFile) {
      try {
        fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
        logStream = fs.createWriteStream(logFile, { flags: 'a', mode: 0o600 });
      } catch (error) {
        finish(1, null, error);
        signalChild(child, 'SIGTERM');
        return;
      }
    }

    child.once('spawn', () => { if (lifecycle.state === 'starting') lifecycle.transition('running'); });
    if (options.forwardSignals !== false) process.once('SIGINT', onInterrupt);
    const commandName = path.basename(command).toLowerCase();
    const effectiveTimeoutMs = options.timeoutMs ?? (['git', 'npm', 'curl', 'wget'].includes(commandName) ? 10 * 60 * 1000 : 0);
    if (Number.isFinite(effectiveTimeoutMs) && effectiveTimeoutMs > 0) {
      timeoutTimer = setTimeout(() => terminate('timeout'), effectiveTimeoutMs);
      timeoutTimer.unref?.();
    }

    const consume = (stream, kind) => stream?.on('data', (chunk) => {
      outputBytes += chunk.length;
      const remaining = Math.max(0, limit - capturedBytes);
      const piece = chunk.subarray(0, remaining);
      if (piece.length < chunk.length) outputTruncated = true;
      if (piece.length > 0) {
        if (kind === 'stdout') stdout += piece.toString();
        else stderr += piece.toString();
        capturedBytes += piece.length;
      }
      if (logStream && !logStream.destroyed) logStream.write(`[${kind}] ${chunk.toString()}`);
      if (options.tee !== false) (kind === 'stdout' ? process.stdout : process.stderr).write(chunk);
    });
    consume(child.stdout, 'stdout');
    consume(child.stderr, 'stderr');
    if (hasInput) {
      child.stdin.on('error', () => {});
      child.stdin.end(options.stdin);
    }
    child.once('error', (error) => finish(127, null, error));
    child.once('close', (code, signal) => finish(code, signal));
  });
}

export async function commandExists(command) {
  const pathValue = process.env.PATH || '';
  const suffixes = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const suffix of suffixes) {
      try {
        await fsp.access(path.join(directory, `${command}${suffix}`), process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        return true;
      } catch {}
    }
  }
  return false;
}
