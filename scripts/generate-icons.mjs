// Generates the PWA raster icons from the favicon artwork — dependency-free
// (Node's built-in zlib only), so it runs anywhere without a headless browser
// or image library. Re-run with `node scripts/generate-icons.mjs` after editing
// the shapes below; the committed PNGs in public/ are its output.
//
// The art mirrors public/favicon.svg: a calendar outline on a paper background,
// drawn in a 32-unit viewBox and scaled up. Icons stay black-on-white (the app
// recolors only the live SVG favicon at runtime; installed icons are static).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PAPER = [0xff, 0xff, 0xff];
const INK = [0x00, 0x00, 0x00];

// Shapes in the 32x32 viewBox. Stroked paths are expanded to filled bars of the
// stroke width, centered on the path edge (stroke-width 2 → ±1), matching how a
// browser renders public/favicon.svg.
const SHAPES = [
  // Calendar body outline (rect x3 y6 w26 h22, stroke 2).
  { x: 2, y: 5, w: 28, h: 2 }, // top edge
  { x: 2, y: 27, w: 28, h: 2 }, // bottom edge
  { x: 2, y: 5, w: 2, h: 24 }, // left edge
  { x: 28, y: 5, w: 2, h: 24 }, // right edge
  // Header divider (line y12 x3..29, stroke 2).
  { x: 3, y: 11, w: 26, h: 2 },
  // Binder ticks (lines x10/x22 y3..9, stroke 2).
  { x: 9, y: 3, w: 2, h: 6 },
  { x: 21, y: 3, w: 2, h: 6 },
  // Marked days (filled squares).
  { x: 8, y: 16, w: 4, h: 4 },
  { x: 20, y: 20, w: 4, h: 4 },
];

// Render the viewBox art into an RGB pixel buffer. `inset` (0..1) shrinks the
// art toward the center for maskable icons, leaving a safe zone of paper around
// it so platform masks never clip the calendar.
function render(size, inset = 0) {
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) px.set(PAPER, i * 3);

  const pad = Math.round(size * inset);
  const scale = (size - 2 * pad) / 32;
  const fill = ([r, g, b], vx, vy, vw, vh) => {
    const x0 = Math.round(pad + vx * scale);
    const y0 = Math.round(pad + vy * scale);
    const x1 = Math.round(pad + (vx + vw) * scale);
    const y1 = Math.round(pad + (vy + vh) * scale);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        px.set([r, g, b], (y * size + x) * 3);
      }
    }
  };
  for (const s of SHAPES) fill(INK, s.x, s.y, s.w, s.h);
  return px;
}

// --- Minimal truecolor PNG encoder (RGB, 8-bit) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  // 10..12: compression, filter, interlace — all 0.
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const targets = [
  { file: 'pwa-192x192.png', size: 192, inset: 0 },
  { file: 'pwa-512x512.png', size: 512, inset: 0 },
  { file: 'pwa-512-maskable.png', size: 512, inset: 0.1 },
  { file: 'apple-touch-icon.png', size: 180, inset: 0.06 },
];
for (const { file, size, inset } of targets) {
  writeFileSync(join(outDir, file), encodePng(size, render(size, inset)));
  console.log(`wrote public/${file} (${size}x${size})`);
}
