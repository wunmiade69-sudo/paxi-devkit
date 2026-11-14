import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export async function ask(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try { return (await rl.question(question)).trim(); }
  finally { rl.close(); }
}

export async function askSecret(question) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('A secure interactive terminal is required to enter a password.');
  }
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  let value = '';
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdout.write('\n');
    };
    const onData = (buffer) => {
      for (const char of buffer.toString('utf8')) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Password entry cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    stdin.on('data', onData);
  });
}
