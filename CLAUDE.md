# CLAUDE.md

Guidance for Claude when working in this repo. Keep it current as the codebase evolves.

## Project

`kalendes` — a Svelte 5 + TypeScript + Vite static PWA: a timeline view for iCal feeds.
Persistence is **localStorage-only** (no backend DB); config also round-trips via
share links. A Vercel serverless function (`api/ics.ts`) proxies feed fetches. Node 20.x.

## Commands

| Task | Command | Notes |
| --- | --- | --- |
| Dev server | `npm run dev` | http://localhost:5173 |
| Tests (once) | `npx vitest run` | bare `npm test`/`vitest` is **watch** mode — use `vitest run` for one-shot |
| Tests (watch) | `npm run test:watch` | |
| Typecheck | `npm run typecheck` | `svelte-check` |
| Build | `npm run build` | `vite build` |

**Before pushing, always run `npx vitest run` and `npm run typecheck`.** Vercel deploys via
`vite build`, which runs **neither** — so they are the only gate against type errors and
test regressions reaching `main`.

## Architecture map

Know where things live so you can go straight to the change:

- **State** — Svelte 5 runes (`$state` / `$derived` / `$effect`); centralized in
  `src/lib/state.svelte.ts`, with scoped `*.svelte.ts` reactive modules. No store library.
- **Types** — everything in `src/lib/types.ts`: types, const option arrays
  (`BLOCK_OPTIONS`, `CALENDAR_COLORS`, `FEED_CATEGORIES`, …), and `SCHEMA_VERSION`.
- **Persistence** — `src/lib/storage.ts` (config load/migrate/save + events cache with
  quota eviction; the cache also carries per-feed HTTP validators — evict/normalize them
  with the feed). Local/imported `.ics` lanes live in `src/lib/scratchpad.ts`.
- **Sharing** — `src/lib/share.ts` encodes/decodes config to/from share links. Payloads
  are deflate-compressed behind a `2.` prefix and encode/decode are **async**; links
  without the prefix (pre-compression format) are deliberately rejected — no import
  prompt, param stripped. `SHARE_URL_LIMIT` is enforced at both share buttons
  (settings + kiosk).
- **Parsing** — `src/lib/ics.ts` (fetch + worker orchestration) + `src/lib/ics-core.ts`
  (parse/expand) + `src/lib/ics.worker.ts` (Web Worker; `ical.js` + `ical-expander`).
  The recurrence iteration cap is derived from the parse window — `ical-expander` counts
  iterations from each series' **DTSTART**, not the window start, so a fixed cap silently
  truncates years-old daily series.
- **Layout / rules / time** — `src/lib/layout.ts` (lane assignment), `src/lib/rules.ts`
  (find/replace), `src/lib/format.ts` + `src/lib/time.ts` (dates/timezones).
  `src/lib/event-display.ts` holds shared display helpers (`formatEventDateInfo`,
  `linkifyText`, `dedupeDisplayEvents`) used by the modal + hover card.
- **Display pipeline** — `_displayByFeed` in `state.svelte.ts` (rules applied, per feed) is
  the shared source for every zoom. Horizontal zooms render per-feed lanes via
  `EventPill`; **1W is different**: `WeekGrid` merges all feeds into one `visibleEvents`
  surface (`WeekEvent` pills) — so anything "combine across feeds" (e.g. duplicate
  collapsing) belongs there, not in the shared pipeline.
- **UI** — components in `src/components/`; one global stylesheet `styles/global.css` using
  CSS custom properties for theming. The events **tray** in `StatusBar.svelte` *is* the
  agenda/list view (selected events as structured rows / TSV table, move/copy/delete
  across lanes, download) — don't add a separate list view. Singleton overlays
  (`EventModal`, `EventHoverCard`) are mounted once in `App.svelte` and driven by
  `ui.*` state, not per-pill.
- **Serverless** — `api/ics.ts` is an IP-filtered CORS proxy (10s timeout, 5MB cap).

## Data-model change checklist

Adding or changing a config / feed / rule field touches the same places every time. Update
**all** of them or user settings silently drop on load and share links break:

1. `src/lib/types.ts` — the type + any `*_OPTIONS` const array. Bump `SCHEMA_VERSION` when
   the shape changes.
2. `src/lib/storage.ts` — `defaultConfig()`, the relevant `normalizeFeed()` /
   `normalizeRule()` / `normalize*()`, and `migrate()` with a **backward-compatible
   default** for configs saved before the field existed (follow the existing legacy
   migrations, e.g. `holidays→global` / `observances→local`, `parsed.haptics ?? parsed.baptism`).
3. `src/lib/share.ts` — encode/decode so the field round-trips through share links.
4. Seeded feeds / `DEFAULT_RULES` in `storage.ts` if the default install should reflect it.
5. Add/extend a colocated `*.test.ts` covering the migration (old config → expected shape).

**Display-only fields** (recomputed each render, never persisted) skip this entirely — e.g.
`DisplayEvent.dupCount`. Add them to the `DisplayEvent` type only, keep them out of
`storage.ts` / `share.ts`, and don't bump `SCHEMA_VERSION`.

## Conventions & gotchas

- **TypeScript strict** (`noUnusedLocals` / `noUnusedParameters`). Prefer discriminated
  unions; keep all types in `types.ts`.
- **Tests** are colocated `*.test.ts`. Vitest globals are on (no imports for
  `describe`/`it`/`expect`/`vi`); use `@testing-library/svelte` for components and fake
  timers for time-dependent UI.
- **Timezone:** the suite runs in `Europe/Athens` on purpose (`tests/setup.ts`) — bugs that
  pass in UTC fail there. Never assume UTC; treat date-only iCal values as
  timezone-agnostic. TZ/DST is a recurring bug class here.
- **Feed refresh is conditional:** `fetchAndParseFeed` revalidates with stored
  ETag/Last-Modified when the parse range is unchanged; a **304 keeps the cached events
  and skips the worker parse entirely**, so don't assume a refresh repopulates anything
  per-event. The raw feed text behind the event modal's source view is session-only —
  after a 304-only reload `EventModal` refetches it on demand. Focus/reconnect refreshes
  are throttled to the refresh interval; the load `$effect` in `App.svelte` reads `events`
  via `untrack` — keep it that way or it loops on its own writes.
- **Performance:** reuse `Intl` formatters (don't construct per-event), gate the Fuse
  search index behind an active query, and skip the O(n²) `assignLanes()` for collapsed
  feeds.
- **Accessibility:** honour `prefers-reduced-motion` (the `motion` setting) and the
  `haptics` setting.
- **Pointer hover is mouse-only:** gate `pointerenter`/`pointerleave` handlers on
  `e.pointerType === 'mouse'` so touch keeps tap / long-press (the hover preview and the 1W
  crosshair both do this). Hover intent is debounced through `ui.hoverEvent` +
  `openHoverPreview`/`closeHoverPreviewSoon` in `state.svelte.ts` — a persistent singleton
  that swaps content between pills rather than closing/reopening, so it never flashes.
- **"Point in time" marker recipe:** accent colour + a paper halo — `color: var(--accent-color);
  filter: var(--clock-halo)` (no solid background box). Reuse it for anything that marks a
  time on the grid (now-line label, 1W hover crosshair time).
- **Theme tokens:** the three base flavor tokens are `--ink-color` / `--paper-color` /
  `--accent-color` (plus `--link-color`); derived tokens keep their names (`--ink-faint`,
  `--ink-muted`, `--paper-2`). Buttons signal hover/focus by tinting the text/icon
  (`--accent-color` on hover, `--link-color` on focus) — no background fills; persistent
  pressed/selected/expanded states keep their inverted `--ink-color` fill.
- **Desktop vs mobile** has no central store — components re-declare `matchMedia` with the
  shared breakpoints (portrait ≤640, landscape ≤900; desktop = neither). See
  `TimeHeader.svelte` / `WeekGrid.svelte`.
- **Verifying UI without live feeds:** the sandbox proxy can't fetch the seeded holiday
  feeds (they 404 to HTML — ignore those console errors). Drive the app with the global
  Playwright (`require` from `/opt/node22/lib/node_modules`, browser at
  `/opt/pw-browsers/chromium`) and seed events by writing
  `localStorage['calendar-timeline:scratchpad']` (see `SerializedScratchEvent`) then setting
  the Draft feed's `hidden: false` in `calendar-timeline:config` and reloading.
- **Style:** no ESLint/Prettier config — match surrounding code (2-space indent, camelCase
  for funcs/vars, PascalCase for types/components, UPPER_SNAKE for constants).
- **Commits:** imperative, feature-focused subject lines (matching existing history).
