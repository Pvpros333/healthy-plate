// Generates the app icons (a plate on green) as PNGs with no dependencies: node scripts/make-icons.js
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function icon(size) {
  const green = [47, 125, 79], white = [255, 255, 255], leaf = [120, 190, 120], rim = [228, 236, 230];
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / size;
      // leaf: an ellipse rotated 45° in the plate's centre
      const u = (x - c + (y - c)) / Math.SQRT2 / size, v = (x - c - (y - c)) / Math.SQRT2 / size;
      const inLeaf = (u * u) / (0.17 * 0.17) + (v * v) / (0.08 * 0.08) <= 1;
      const px = inLeaf ? leaf : d < 0.25 ? white : d < 0.32 ? rim : green;
      raw.set(px, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [192, 512]) writeFileSync(resolve(import.meta.dirname, '..', 'icons', `icon-${s}.png`), icon(s));
console.log('icons written');
