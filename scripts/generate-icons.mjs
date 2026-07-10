// Generates the PWA raster icons from the favicon artwork — dependency-free
// (Node's built-in zlib only), so it runs anywhere without a headless browser
// or image library. Re-run with `node scripts/generate-icons.mjs` after editing
// the shapes below; the committed PNGs in public/ are its output.
//
// The art mirrors public/favicon.svg: a rounded calendar outline with binder
// ticks and a stroked ϗ (kai) glyph, uniform 2-unit line weight in a 32-unit
// viewBox. Every stroke is flattened to a polyline and rasterized as a distance
// field — a pixel is ink when its distance to the nearest segment is within
// stroke-width/2 — which gives the round caps/joins and anti-aliasing of the
// SVG's stroke-linecap/linejoin="round" for free. Icons stay black-on-white
// (the app recolors only the live SVG favicon at runtime; installed icons are
// static).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PAPER = [0xff, 0xff, 0xff];
const INK = [0x00, 0x00, 0x00];
const HALF_STROKE = 1; // stroke-width 2 in the 32-unit viewBox

// --- Stroke geometry, flattened to polylines (arrays of [x, y] points) ---

function arc(cx, cy, r, a0, a1, steps = 8) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// Quadratic Bézier from p0 to p1 with control c, excluding p0 (for chaining).
function quad(p0, c, p1, steps = 16) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([
      u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
      u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
    ]);
  }
  return pts;
}

function roundedRect(x, y, w, h, r) {
  const T = -Math.PI / 2;
  return [
    [x + r, y],
    [x + w - r, y],
    ...arc(x + w - r, y + r, r, T, 0),
    [x + w, y + h - r],
    ...arc(x + w - r, y + h - r, r, 0, -T),
    [x + r, y + h],
    ...arc(x + r, y + h - r, r, -T, Math.PI),
    [x, y + r],
    ...arc(x + r, y + r, r, Math.PI, Math.PI - T),
  ];
}

// Same drawing as public/favicon.svg — keep the two in sync.
const STROKES = [
  // Calendar frame (rect x5 y5 w22 h22 rx2.5).
  roundedRect(5, 5, 22, 22, 2.5),
  // Header divider.
  [[5, 11], [27, 11]],
  // Binder ticks.
  [[11, 3], [11, 7]],
  [[21, 3], [21, 7]],
  // ϗ — stem, upper arm, leg flowing into the descending curl tail.
  [[11, 13.5], [11, 22.5]],
  [[21, 13.5], ...quad([21, 13.5], [16.3, 15.5], [11, 18.2])],
  [
    [11, 18.2],
    ...quad([11, 18.2], [15.8, 18.5], [18.2, 20.6]),
    ...quad([18.2, 20.6], [20.9, 22.9], [20.3, 24.2]),
    ...quad([20.3, 24.2], [19.7, 25.3], [18.3, 24.7]),
  ],
];

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const qx = px - (ax + t * dx);
  const qy = py - (ay + t * dy);
  return Math.sqrt(qx * qx + qy * qy);
}

// Render the viewBox art into an RGB pixel buffer. `inset` (0..1) shrinks the
// art toward the center for maskable icons, leaving a safe zone of paper around
// it so platform masks never clip the calendar.
function render(size, inset = 0) {
  const px = Buffer.alloc(size * size * 3);
  const pad = size * inset;
  const scale = (size - 2 * pad) / 32;
  const aa = 1 / scale; // one output pixel, in viewBox units
  for (let y = 0; y < size; y++) {
    const vy = (y + 0.5 - pad) / scale;
    for (let x = 0; x < size; x++) {
      const vx = (x + 0.5 - pad) / scale;
      let d = Infinity;
      for (const poly of STROKES) {
        for (let i = 0; i < poly.length - 1; i++) {
          const sd = segmentDistance(vx, vy, poly[i], poly[i + 1]);
          if (sd < d) d = sd;
        }
      }
      const alpha = Math.max(0, Math.min(1, (HALF_STROKE - d) / aa + 0.5));
      const idx = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) {
        px[idx + c] = Math.round(PAPER[c] + (INK[c] - PAPER[c]) * alpha);
      }
    }
  }
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
