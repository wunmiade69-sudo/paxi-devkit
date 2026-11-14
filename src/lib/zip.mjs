import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

function crc32Update(crc, buffer) {
  let value = crc;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
}

async function fileMetadata(file) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Windows bundle contains a non-regular file; refusing to archive: ${file}`);
  if (info.size > 0xffffffff) throw new Error(`File exceeds the ZIP32 size limit (4 GiB): ${file}`);
  let crc = 0xffffffff;
  for await (const chunk of createReadStream(file)) crc = crc32Update(crc, chunk);
  return { size: info.size, crc: (crc ^ 0xffffffff) >>> 0, mtime: info.mtime };
}

async function collectFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Windows bundle contains a symbolic link; refusing to archive: ${full}`);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile()) files.push(full);
      else throw new Error(`Windows bundle contains an unsupported filesystem entry: ${full}`);
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  if (!files.length) throw new Error('Windows build output is empty; no application files can be packaged.');
  if (files.length >= 0xffff) throw new Error('Windows build contains too many files for the ZIP32 format.');
  return files;
}

function dosDateTime(date) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = date.getDate() | ((date.getMonth() + 1) << 5) | ((year - 1980) << 9);
  return { time, day };
}

function localHeader(name, meta) {
  const header = Buffer.alloc(30);
  const { time, day } = dosDateTime(meta.mtime);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8); // STORE: streaming without high-memory compression buffers
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(day, 12);
  header.writeUInt32LE(meta.crc, 14);
  header.writeUInt32LE(meta.size, 18);
  header.writeUInt32LE(meta.size, 22);
  header.writeUInt16LE(name.length, 26);
  return header;
}

function centralHeader(name, meta, offset) {
  const header = Buffer.alloc(46);
  const { time, day } = dosDateTime(meta.mtime);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(day, 14);
  header.writeUInt32LE(meta.crc, 16);
  header.writeUInt32LE(meta.size, 20);
  header.writeUInt32LE(meta.size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(offset, 42);
  return header;
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

/** Create a deterministic-order, ZIP32, uncompressed archive without loading the bundle into RAM. */
export async function createZipFromDirectory(sourceDirectory, destination) {
  const source = path.resolve(sourceDirectory);
  const sourceInfo = await fs.lstat(source).catch(() => null);
  if (!sourceInfo?.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error(`Windows build output must be a regular directory: ${source}`);
  const target = path.resolve(destination);
  const targetInfo = await fs.lstat(target).catch(() => null);
  if (targetInfo?.isSymbolicLink() || (targetInfo && !targetInfo.isFile())) throw new Error(`Refusing to overwrite a non-regular ZIP destination: ${target}`);

  const rootName = path.basename(source).replace(/[\\/]/g, '_');
  const files = await collectFiles(source);
  const entries = [];
  for (const file of files) {
    const relative = path.relative(source, file).split(path.sep).join('/');
    const name = Buffer.from(`${rootName}/${relative}`, 'utf8');
    if (name.length > 0xffff) throw new Error(`ZIP entry path is too long: ${relative.slice(0, 100)}`);
    const meta = await fileMetadata(file);
    entries.push({ file, name, meta });
  }

  const central = [];
  let offset = 0;
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const output = createWriteStream(temp, { flags: 'wx', mode: 0o600 });
  try {
    for (const entry of entries) {
      if (offset > 0xffffffff || offset + 30 + entry.name.length + entry.meta.size > 0xffffffff) {
        throw new Error('Windows app bundle exceeds ZIP32 archive limits; split the distribution or use a ZIP64 archiver.');
      }
      const start = offset;
      const header = localHeader(entry.name, entry.meta);
      await writeChunk(output, header);
      await writeChunk(output, entry.name);
      offset += header.length + entry.name.length;
      for await (const chunk of createReadStream(entry.file)) {
        await writeChunk(output, chunk);
        offset += chunk.length;
      }
      central.push(centralHeader(entry.name, entry.meta, start), entry.name);
    }
    const centralBuffer = Buffer.concat(central);
    if (centralBuffer.length > 0xffffffff || offset + centralBuffer.length + 22 > 0xffffffff) {
      throw new Error('Windows app bundle exceeds ZIP32 central-directory limits.');
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12);
    end.writeUInt32LE(offset, 16);
    await writeChunk(output, centralBuffer);
    await writeChunk(output, end);
    output.end();
    await finished(output);
    await fs.rename(temp, target);
    return { file: target, entries: entries.length, sizeBytes: (await fs.stat(target)).size };
  } catch (error) {
    output.destroy();
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
