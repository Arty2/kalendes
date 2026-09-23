# Toolchain upgrade — instructions for a fresh session

> **Status (0.0.71):** steps 1–4 done. Step 5 was skipped: `svelte-check` 4.7.6 declares
> `typescript ^5 || ^6` and reaches TS 7 only through its experimental
> `--tsgo-experimental-api` flag, so the repo stays on 5.9. `npm audit` still shows 5 findings
> (3 high, 2 moderate), all exact pins inside `@vercel/node@13.0.2` (undici 5.28.4,
> path-to-regexp 6.1.0, ajv 8.6.3); the latest release can't clear them. Step 1 also found
> that Rolldown bundles a second ical.js unless the `icalExpanderInterop` plugin handles
> ical-expander's `require` (see CLAUDE.md → Parsing).

The dev/build/test toolchain is several majors behind. The remaining `npm audit` findings
(one critical in `vitest`, highs in `vite` and `@vercel/node`'s transitive `undici` /
`path-to-regexp`) can only be cleared by these majors. None of this ships to users —
it's dev, CI and build tooling — but newer Vite/Vitest also build and test faster.

Written 2026-09-23, from `npm outdated` at `0.0.70`:

| Package | Now | Target | Notes |
| --- | --- | --- | --- |
| `vite` | 5.4 | 8.x | Vite 8 bundles with **Rolldown**, not Rollup — see § Hot spots |
| `@sveltejs/vite-plugin-svelte` | 4.0 | 7.x | peer `vite ^8`, `svelte ^5.46.4`; node `^20.19 \|\| ^22.12 \|\| >=24` |
| `vitest` | 2.1 | 5.x | peer `vite ^6.4 \|\| ^7 \|\| ^8` — so it moves **with** Vite |
| `jsdom` | 25 | 30 | only the 10 `@vitest-environment jsdom` test files use it |
| `@vercel/node` | 5.10 | latest | **types only** (`import type` in `api/*.ts`) |
| `typescript` | 5.9 | 7.x | optional, last — see step 5 |
| `@testing-library/svelte`, `svelte-check`, `@types/node` | minor | latest | ride along |

`vite-plugin-pwa` 1.x already accepts Vite 8 — no bump needed.

## Ground rules

- Branch from `main`; one upgrade step per commit, each one green before the next.
- **Record a baseline first**, on the untouched tree: `npm run quick` timing, `npm run
  build` timing, and `gzip -9c dist/assets/*.js | wc -c` per chunk. Every commit message
  reports before → after for whatever it moved.
- Config and lockfile changes only. If a step needs changes to app source (components,
  `src/lib`) beyond a mechanical API rename, **stop and report** instead of rewriting it.
- `npm run quick` passing is necessary, not sufficient — see § Verifying a step.

## Order

1. **Vite 8 + `@sveltejs/vite-plugin-svelte` 7 + Vitest 5 together** (their peer ranges
   interlock; splitting them just produces an unresolvable tree). Follow each project's
   migration guide for the skipped majors (Vite 6, 7, 8; Vitest 3, 4, 5) — read the
   "breaking changes" sections, don't guess.
2. **jsdom 30.**
3. **`@vercel/node` latest.** Only its types are used, so this is a devDependency bump;
   `vercel.json` separately pins the *function runtime* (`@vercel/node@5.8.26`) — leave
   that alone unless a Vercel preview deploy is checked, and keep CLAUDE.md's Project
   paragraph in sync if it does change.
4. **Minor ride-alongs** (`@testing-library/svelte`, `svelte-check`, `@types/node` within
   the Node 24 line).
5. **TypeScript 7 — optional.** It's the native (Go) compiler. Only take it if
   `svelte-check` officially supports it; otherwise stay on 5.9 and say so.

Finish with `npm audit` and report what, if anything, is left and why.

## Hot spots in this repo's config

- **The ical.js interop fix.** `package.json` `overrides` makes `ical-expander` (CJS,
  `require('ical.js')`) use the app's ESM-only, default-export-only ical.js 2, and
  `vite.config.ts` → `build.commonjsOptions.requireReturnsDefault` unwraps that require
  for **Rollup**. Under Rolldown that option may be ignored or unnecessary. If
  production breaks, the symptom is `q.parse is not a function` (minified name varies) in
  the worker and **no feed renders — while unit tests and `vite dev` still pass**. Remove
  the option only if the production check below passes without it; otherwise replace it
  with Rolldown's equivalent and update the comment and CLAUDE.md's Parsing bullet.
- **`build.rollupOptions.output.manualChunks`** (`ical`, `fuse`) — check how Vite 8
  wants chunk grouping expressed; the result must still be one `ical` chunk shared by the
  worker and the main-thread fallback, and a separate `fuse` chunk.
- **The ICS Web Worker** (`src/lib/ics.worker.ts`, loaded via Vite's worker import) — the
  worker bundle must still contain exactly one ical.js: `grep -c ComponentParser
  dist/assets/*.js` should print 1 for the `ical` chunk and 1 for `ics.worker`.
- **`svelteTesting()`** from `@testing-library/svelte/vite` and `svelte({ compilerOptions:
  { hmr: !process.env.VITEST } })` — confirm both still apply under the new plugin.
- **Vitest config** lives in `vite.config.ts` → `test` (`environment: 'node'`,
  `globals: true`, `setupFiles: ['./tests/setup.ts']`, which pins `TZ=Europe/Athens`).
  Keep the per-file `// @vitest-environment jsdom` docblocks working; if a Vitest major
  changed how globals or environments are declared, migrate the config, not the tests.
- **`vite-plugin-pwa`** — the build must still emit `dist/sw.js` and the manifest.

## Verifying a step

1. `npm run quick` — 0 type errors, all tests pass (524 at the time of writing).
2. `npm run build` — no new warnings; compare chunk sizes against the baseline.
3. **Production build in a real browser, with a real parse.** The seeded feeds can't be
   fetched in the sandbox, so route the proxy to a local feed. `vite preview` serves
   `dist/`; Playwright is global (`/opt/node22/lib/node_modules/playwright`, Chromium at
   `/opt/pw-browsers/chromium`):

   ```js
   // node smoke.cjs <port>   (feed.ics: any calendar with a TZID'd RRULE series + EXDATE,
   //                          a RECURRENCE-ID override, an all-day and a floating event)
   const { chromium } = require('/opt/node22/lib/node_modules/playwright');
   const ics = require('fs').readFileSync('feed.ics', 'utf8');
   (async () => {
     const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
     const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
     const errs = [];
     p.on('pageerror', (e) => errs.push(e.message));
     await p.route('**/api/ics**', (r) => r.fulfill({ status: 200, contentType: 'text/calendar', body: ics }));
     await p.goto(`http://localhost:${process.argv[2]}/?z=1y`);
     await p.waitForTimeout(4000);
     const pills = await p.$$eval('[class*=pill]', (els) => els.length);
     console.log({ pills, errs });
     await b.close();
   })();
   ```

   Run it against a build of the **baseline** tree (a `git worktree` of `main` with its
   own `npm ci`) and the upgraded tree: same pill count, no page errors.
4. The same script against `npm run dev` — dev resolves CommonJS differently from the
   production build, so it can pass or fail independently.

## Done means

All steps committed with before → after numbers, the checks above green, CLAUDE.md
updated anywhere it names a version or a config key that moved, the patch version bumped
once (`npm version patch --no-git-tag-version`, and CLAUDE.md's Version line), and a
draft PR whose Verified section says exactly what was driven in the browser.
