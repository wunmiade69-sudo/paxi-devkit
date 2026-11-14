import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
const packageMetadata = JSON.parse(readFileSync(packagePath, 'utf8'));
export const VERSION = packageMetadata.version;
