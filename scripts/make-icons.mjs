/**
 * Generates the PWA / apple-touch icons as PNG files.
 * Pure Node (zlib + Buffer) - no image dependencies.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'public', 'icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

export function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- design (512x512 grid) ---------------- */

const ACCENT_TOP = [43, 127, 255];
const ACCENT_BOTTOM = [11, 59, 143];
const WHITE = [255, 255, 255];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function over(base, color, alpha) {
  return alpha <= 0 ? base : mix(base, color, alpha);
}

function insideRoundedSquare(x, y, size, radius) {
  if (radius <= 0) return true;
  const rx = Math.min(Math.max(x, radius), size - radius);
  const ry = Math.min(Math.max(y, radius), size - radius);
  return (x - rx) ** 2 + (y - ry) ** 2 <= radius ** 2;
}

function insideCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function insideTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function samplePoint(x, y, shape) {
  const { centerX, centerY, pinRadius, tipY, cornerRadius, size } = shape;

  if (!insideRoundedSquare(x, y, size, cornerRadius)) return [0, 0, 0, 0];

  let rgb = mix(ACCENT_TOP, ACCENT_BOTTOM, Math.min(1, y / size) * 1.05);
  const highlight = Math.max(
    0,
    1 - Math.hypot(x - size * 0.3, y - size * 0.22) / (size * 0.85),
  );
  rgb = over(rgb, WHITE, highlight * 0.16);

  const inHead = insideCircle(x, y, centerX, centerY, pinRadius);
  const inTail = insideTriangle(
    x,
    y,
    [centerX - pinRadius * 0.72, centerY + pinRadius * 0.42],
    [centerX + pinRadius * 0.72, centerY + pinRadius * 0.42],
    [centerX, tipY],
  );
  if (inHead || inTail) {
    rgb = insideCircle(x, y, centerX, centerY, pinRadius * 0.44) ? ACCENT_BOTTOM : WHITE;
  }

  return [rgb[0], rgb[1], rgb[2], 255];
}

function renderIcon(size, { maskable = false } = {}) {
  const grid = 512;
  const shape = {
    size: grid,
    cornerRadius: maskable ? 0 : grid * 0.22,
    centerX: grid / 2,
    centerY: maskable ? grid * 0.42 : grid * 0.41,
    pinRadius: maskable ? grid * 0.17 : grid * 0.205,
    tipY: maskable ? grid * 0.78 : grid * 0.85,
  };

  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / grid;
  const samples = 3;
  const total = samples * samples;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let alphaSum = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / scale;
          const y = (py + (sy + 0.5) / samples) / scale;
          const [sr, sg, sb, sa] = samplePoint(x, y, shape);
          const weight = sa / 255;
          r += sr * weight;
          g += sg * weight;
          b += sb * weight;
          alphaSum += weight;
        }
      }
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(alphaSum > 0 ? r / alphaSum : 0);
      pixels[offset + 1] = Math.round(alphaSum > 0 ? g / alphaSum : 0);
      pixels[offset + 2] = Math.round(alphaSum > 0 ? b / alphaSum : 0);
      pixels[offset + 3] = Math.round((alphaSum / total) * 255);
    }
  }
  return encodePng(size, size, pixels);
}

mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: false }],
];

for (const [name, size, options] of targets) {
  const png = renderIcon(size, options);
  writeFileSync(resolve(outDir, name), png);

  // Self-check: signature, IHDR dimensions, IEND chunk.
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const okSignature = png.subarray(0, 8).equals(signature);
  const okWidth = png.readUInt32BE(16) === size;
  const okHeight = png.readUInt32BE(20) === size;
  const okEnd = png.subarray(png.length - 8, png.length - 4).toString('latin1') === 'IEND';
  if (!okSignature || !okWidth || !okHeight || !okEnd) {
    throw new Error(`PNG self-check failed for ${name}`);
  }
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
