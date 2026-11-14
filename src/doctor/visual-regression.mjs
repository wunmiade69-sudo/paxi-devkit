import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Visual regression requires a valid PNG image.');
  let offset = 8; let header = null; const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset); offset += 4;
    if (length > MAX_FILE_BYTES || offset + 8 + length > buffer.length) throw new Error('PNG contains an invalid or oversized chunk.');
    const type = buffer.toString('ascii', offset, offset + 4); offset += 4;
    const data = buffer.subarray(offset, offset + length); offset += length;
    offset += 4; // CRC is not security-sensitive here; PNG structure and bounded decode are validated below.
    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error('PNG has an invalid IHDR chunk.');
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9], compression: data[10], filter: data[11], interlace: data[12] };
    } else if (type === 'IDAT') imageData.push(data);
    else if (type === 'IEND') break;
  }
  if (!header || !imageData.length) throw new Error('PNG is missing image header or image data.');
  const { width, height, bitDepth, colorType, compression, filter, interlace } = header;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error(`PNG dimensions exceed the ${MAX_PIXELS.toLocaleString()}-pixel safety limit.`);
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new Error('Supported PNG format is 8-bit RGB/RGBA, non-interlaced. Convert palette, grayscale, 16-bit or interlaced images to standard RGB/RGBA PNG first.');
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const expected = height * (stride + 1);
  let raw;
  try { raw = inflateSync(Buffer.concat(imageData), { maxOutputLength: expected + 1 }); }
  catch (error) { throw new Error(`PNG image data could not be safely decoded: ${error.message}`); }
  if (raw.length !== expected) throw new Error('PNG decoded data length does not match its declared dimensions.');
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1); const mode = raw[rowOffset];
    if (mode > 4) throw new Error(`PNG uses an unsupported scanline filter (${mode}).`);
    const target = y * stride; const previous = y ? target - stride : -1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowOffset + 1 + x];
      const left = x >= channels ? pixels[target + x - channels] : 0;
      const up = previous >= 0 ? pixels[previous + x] : 0;
      const upperLeft = previous >= 0 && x >= channels ? pixels[previous + x - channels] : 0;
      let predictor = 0;
      if (mode === 1) predictor = left;
      else if (mode === 2) predictor = up;
      else if (mode === 3) predictor = Math.floor((left + up) / 2);
      else if (mode === 4) predictor = paeth(left, up, upperLeft);
      pixels[target + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels, sha256: createHash('sha256').update(buffer).digest('hex') };
}

export function comparePngBuffers(beforeBuffer, afterBuffer, { pixelThreshold = 16, maxChangedPercent = 0.5 } = {}) {
  if (!Number.isFinite(pixelThreshold) || pixelThreshold < 0 || pixelThreshold > 255) throw new Error('Pixel threshold must be between 0 and 255.');
  if (!Number.isFinite(maxChangedPercent) || maxChangedPercent < 0 || maxChangedPercent > 100) throw new Error('Maximum changed percentage must be between 0 and 100.');
  const before = decodePng(beforeBuffer); const after = decodePng(afterBuffer);
  if (before.width !== after.width || before.height !== after.height) {
    return { comparable: false, passed: false, reason: 'Image dimensions differ.', before: { width: before.width, height: before.height }, after: { width: after.width, height: after.height }, changedPixels: null, changedPercent: null, pixelThreshold, maxChangedPercent, baselineSha256: before.sha256, currentSha256: after.sha256 };
  }
  const count = before.width * before.height;
  let changedPixels = 0; let absoluteError = 0;
  let minX = before.width; let minY = before.height; let maxX = -1; let maxY = -1;
  for (let pixel = 0; pixel < count; pixel += 1) {
    const aOffset = pixel * before.channels; const bOffset = pixel * after.channels;
    let largest = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const a = channel >= before.channels ? 255 : before.pixels[aOffset + channel];
      const b = channel >= after.channels ? 255 : after.pixels[bOffset + channel];
      const difference = Math.abs(a - b);
      absoluteError += difference;
      if (difference > largest) largest = difference;
    }
    if (largest > pixelThreshold) {
      changedPixels += 1;
      const x = pixel % before.width; const y = Math.floor(pixel / before.width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  const changedPercent = count ? changedPixels / count * 100 : 0;
  const meanAbsoluteError = count ? absoluteError / (count * 4) : 0;
  return {
    comparable: true,
    passed: changedPercent <= maxChangedPercent,
    before: { width: before.width, height: before.height },
    after: { width: after.width, height: after.height },
    totalPixels: count,
    changedPixels,
    changedPercent: Number(changedPercent.toFixed(5)),
    meanAbsoluteError: Number(meanAbsoluteError.toFixed(4)),
    changedBounds: changedPixels ? { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    pixelThreshold,
    maxChangedPercent,
    baselineSha256: before.sha256,
    currentSha256: after.sha256
  };
}

export async function comparePngFiles(beforePath, afterPath, options = {}) {
  const readImage = async (filePath) => {
    const absolute = path.resolve(filePath); const info = await fs.lstat(absolute).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size < 33 || info.size > MAX_FILE_BYTES) throw new Error(`PNG evidence must be a regular non-symlink file between 33 bytes and ${MAX_FILE_BYTES} bytes: ${path.basename(absolute)}`);
    return fs.readFile(absolute);
  };
  const [before, after] = await Promise.all([readImage(beforePath), readImage(afterPath)]);
  return comparePngBuffers(before, after, options);
}
