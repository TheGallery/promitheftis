// Renders public/favicon.svg to the PNG icons using only Node built-ins.
// The mark is plain rectangles on a 16x16 grid, so each one is filled directly.
// Run: node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const svg = readFileSync('public/favicon.svg', 'utf8');

const rects = [];
for (const [, fill, d] of svg.matchAll(/<path fill="(#[0-9a-f]{6})" d="([^"]+)"/g)) {
  for (const [, x, y, w, h] of d.matchAll(/M(\d+) (\d+)h(-?\d+)v(-?\d+)h-?\d+z/g)) {
    rects.push({ fill, x: +x, y: +y, w: +w, h: +h });
  }
}

function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// size: output edge in px; scale: px per grid cell; plate: background colour or null for transparent.
function png(size, scale, plate) {
  const offset = Math.floor((size - 16 * scale) / 2);
  const px = Buffer.alloc(size * size * 4);
  if (plate) {
    const [r, g, b] = rgb(plate);
    for (let i = 0; i < size * size; i++) px.set([r, g, b, 255], i * 4);
  }
  for (const { fill, x, y, w, h } of rects) {
    const [r, g, b] = rgb(fill);
    for (let py = offset + y * scale; py < offset + (y + h) * scale; py++) {
      for (let pxx = offset + x * scale; pxx < offset + (x + w) * scale; pxx++) {
        px.set([r, g, b, 255], (py * size + pxx) * 4);
      }
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/favicon-32.png', png(32, 2, null));
writeFileSync('public/apple-touch-icon.png', png(180, 9, '#0e1512'));
