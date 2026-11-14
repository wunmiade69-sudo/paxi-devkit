#!/usr/bin/env node
import { main } from '../src/cli.mjs';
import { exitCodeForError } from '../src/lib/exit-codes.mjs';

main(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nPAXI error: ${message}`);
  process.exitCode = exitCodeForError(error);
});
