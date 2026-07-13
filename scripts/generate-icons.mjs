// Generates the PWA raster icons from the favicon artwork — dependency-free
// (Node's built-in zlib only), so it runs anywhere without a headless browser
// or image library. Re-run with `node scripts/generate-icons.mjs` after editing
// the shapes below; the committed PNGs in public/ are its output.
//
// The art mirrors public/favicon.svg, inverted white-on-black: a rounded
// calendar outline with butt-capped binder ticks and a hand-drawn kai (ϗ)
// glyph traced into a polygon outline (src/lib/kai-outline.json, shared with
// the runtime favicon in App.svelte). Every shape is a fill polygon — the
// frame ring is an outer/inner rounded-rect pair combined even-odd — and
// rasterization is a scanline even-odd fill at 4x4 supersampling, unioned
// across shapes so the ticks may overlap the frame. Installed icons are
// static; the app recolors only the live SVG favicon at runtime.
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PLATE = [0x00, 0x00, 0x00]; // background
const ART = [0xff, 0xff, 0xff]; // calendar + glyph

// --- Fill geometry: polygons (arrays of [x, y]) in the 32-unit viewBox ---

function arc(cx, cy, r, a0, a1, steps = 8) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
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

const KAI = JSON.parse(
  readFileSync(new URL('../src/lib/kai-outline.json', import.meta.url), 'utf8'),
);

// Each group fills even-odd within itself; groups union together.
const GROUPS = [
  // Calendar frame: stroke-width 2 ring around rect x5 y5 w22 h22 rx2.5.
  [roundedRect(4, 4, 24, 24, 3.5), roundedRect(6, 6, 20, 20, 1.5)],
  // Binder ticks (butt caps): 2-wide bars at x11 / x21, y 2.5..6.5.
  [[[10, 2.5], [12, 2.5], [12, 6.5], [10, 6.5]]],
  [[[20, 2.5], [22, 2.5], [22, 6.5], [20, 6.5]]],
  // Traced kai glyph.
  [KAI],
];

// Render the viewBox art into an RGB pixel buffer. `inset` (0..1) shrinks the
// art toward the center for maskable icons, leaving a safe zone of plate
// around it so platform masks never clip the calendar.
const SS = 4; // supersamples per axis
function render(size, inset = 0) {
  const pad = size * inset;
  const scale = (size - 2 * pad) / 32;
  const N = size * SS;
  const cov = new Uint16Array(size * size);
  const row = new Uint8Array(N);
  for (let sy = 0; sy < N; sy++) {
    const vy = ((sy + 0.5) / SS - pad) / scale;
    row.fill(0);
    for (const group of GROUPS) {
      // Even-odd crossings of this group's edges with the scanline.
      const xs = [];
      for (const poly of group) {
        for (let i = 0; i < poly.length; i++) {
          const [x1, y1] = poly[i];
          const [x2, y2] = poly[(i + 1) % poly.length];
          if (y1 <= vy !== y2 <= vy) xs.push(x1 + ((vy - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, Math.ceil((xs[k] * scale + pad) * SS - 0.5));
        const b = Math.min(N - 1, Math.floor((xs[k + 1] * scale + pad) * SS - 0.5));
        for (let sx = a; sx <= b; sx++) row[sx] = 1;
      }
    }
    const py = (sy / SS) | 0;
    for (let sx = 0; sx < N; sx++) {
      if (row[sx]) cov[py * size + ((sx / SS) | 0)]++;
    }
  }
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const alpha = cov[i] / (SS * SS);
    for (let c = 0; c < 3; c++) {
      px[i * 3 + c] = Math.round(PLATE[c] + (ART[c] - PLATE[c]) * alpha);
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
