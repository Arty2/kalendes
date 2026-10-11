// Summarises a production build in dist/ (or the directory given as the first
// argument, e.g. a `vite build --outDir` elsewhere) without anyone reading the
// bundles: gzip -9 size per JS chunk, and how many copies of ical.js each one
// carries.
// Run `npm run build` first. dist/ is deny-listed for reads in
// .claude/settings.json (minified bundles are huge and never the answer);
// this prints only the numbers the checks need, and is pre-approved there.
//
// Fails when the ical.js interop in vite.config.ts regresses: the `ical`
// chunk and the `ics.worker` bundle must each hold exactly one ical.js
// (counted by its `ComponentParser` class) — two means ical-expander's
// `require('ical.js')` pulled in the separate CJS build — or when the PWA
// service worker / manifest go missing. It can't see the other failure mode —
// one copy wired to the wrong export (`q.parse is not a function`) — so a
// feed still has to parse in a real browser; see docs/toolchain-upgrade.md.
import { gzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dist = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const assets = join(dist, 'assets');
if (!existsSync(assets)) {
  console.error(`No ${assets} — run \`npm run build\` first.`);
  process.exit(1);
}

const problems = [];
const rows = readdirSync(assets)
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((file) => {
    const code = readFileSync(join(assets, file));
    const parsers = code.toString('utf8').split('ComponentParser').length - 1;
    return { file, gzip: gzipSync(code, { level: 9 }).length, parsers };
  });

for (const prefix of ['ical-', 'ics.worker-']) {
  const matches = rows.filter((r) => r.file.startsWith(prefix));
  if (matches.length !== 1) problems.push(`expected one ${prefix}*.js chunk, found ${matches.length}`);
  for (const r of matches) {
    if (r.parsers !== 1) problems.push(`${r.file} holds ${r.parsers} copies of ical.js (want 1)`);
  }
}
for (const r of rows) {
  if (r.parsers > 0 && !r.file.startsWith('ical-') && !r.file.startsWith('ics.worker-')) {
    problems.push(`${r.file} also holds ical.js`);
  }
}
for (const file of ['sw.js', 'manifest.webmanifest']) {
  if (!existsSync(join(dist, file))) problems.push(`${file} is missing`);
}

const width = Math.max(...rows.map((r) => r.file.length));
for (const r of rows) {
  console.log(`${r.file.padEnd(width)}  ${String(r.gzip).padStart(7)} B gzip  ical.js ×${r.parsers}`);
}
console.log(`${'total'.padEnd(width)}  ${String(rows.reduce((n, r) => n + r.gzip, 0)).padStart(7)} B gzip`);

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log('✓ one ical.js in the ical chunk and in the worker; sw.js + manifest present');
