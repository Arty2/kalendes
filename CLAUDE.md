# CLAUDE.md

Guidance for Claude when working in this repo. Keep it current as the codebase evolves.

## Project

`kalendes` — a Svelte 5 + TypeScript + Vite static PWA: a timeline view for iCal feeds.
Persistence is **localStorage-only** (no backend DB); config also round-trips via
share links. A Vercel serverless function (`api/ics.ts`) proxies feed fetches. Node 24.x
(enabled in the Vercel project settings; the function runtime is pinned to `@vercel/node@5`
in `vercel.json`).

**Version:** `package.json` is the one copy (see [Versioning](#versioning)).

## Commands

| Task | Command | Notes |
| --- | --- | --- |
| Dev server | `npm run dev` | http://localhost:5173 |
| Gates + types + tests | `npm run quick` | the pre-push check; ~10s |
| Gates | `npm run gates` | `scripts/gates.sh`: version agrees everywhere, `CHANGELOG.md` heads with it and fits |
| Tests (once) | `npm test` | `vitest run`; pass a path to run one file |
| Tests (watch) | `npm run test:watch` | |
| Typecheck | `npm run typecheck` | `svelte-check` |
| Build | `npm run build` | `vite build` |
| Bundle check | `npm run check:bundle` | after a build: gzip size per chunk, one ical.js each in `ical` / `ics.worker` |

**Before pushing, always run `npm run quick`.** Vercel deploys via `vite build`, which runs
**neither** svelte-check nor vitest — so CI (`.github/workflows/ci.yml`) and this are the
only gate against type errors and test regressions reaching `main`.

**Keeping sessions and CI cheap:**
- `.claude/hooks/session-start.sh` runs `npm ci` before a web session's first turn, and
  `.claude/settings.json` pre-approves the commands above plus read-only git/shell — extend
  both when new commands become routine. `package-lock.json` is deny-listed for reads (it's
  ~300KB of tokens and never the answer); edit it only through `npm`. `dist/` is deny-listed
  too (minified bundles) — inspect a build with `npm run check:bundle`, not by reading it.
- Run the one test file you're touching (`npx vitest run src/lib/foo.test.ts`) while
  iterating; `npm run quick` once before pushing.
- Vitest defaults to the `node` environment. A test needing `document`, `window`,
  `localStorage` or a component mount opts in with `// @vitest-environment happy-dom` as
  its first line — DOM setup was more than half the suite's wall time when it was global.
  happy-dom replaced jsdom (full suite ~7.3 s → ~5.4 s). Where they differ, match
  happy-dom: e.g. stub `localStorage.setItem` on the instance, not `Storage.prototype`.
- CI and Vercel both skip commits touching only `*.md` / `docs/**` (`paths-ignore` in
  `ci.yml`, `ignoreCommand` in `vercel.json`); a newer push cancels an in-flight CI run.

## Versioning

`package.json` is the source of truth (Vite bakes it into the UI as `__APP_VERSION__`); keep
`package-lock.json` in step through npm (`npm version <patch|minor> --no-git-tag-version`, or
`npm install --package-lock-only` after a hand edit — never edit the lockfile itself), and head
`CHANGELOG.md` with it, in a user's words: a patch rewrites its minor's heading to the new
number and today's date, never adds a section. Patch for a fix, minor for a feature, and the
leading zero never moves.

**The session's first bump is sized by the largest change in it** — one feature among five
fixes is still a minor; set it when the work starts landing. **After that, every further push
that changes the app bumps the patch** (`0.8.0` → `0.8.1` → …), pull request or not: the
version is also a development tool. The tray and Settings show it, so a patch bump is how you
tell whether a preview deploy, an installed PWA or a phone's cache is running the latest push
or a stale build, and it lets the user name the exact build a bug report is about. A reviewer
may also have read the last one. Pushes that change only docs or tooling (nothing the app
runs) don't bump, and a session with no user-facing change doesn't bump at all.

`CHANGELOG.md` is for the person using the product; git is the history. Features only — not
fixes, not why, not how (a fix that gives the user something new to rely on is written as
that behaviour). **Easter eggs and hidden gestures stay out** — the timeline music sweep and
anything else the README doesn't document; the app shows this file to every user. A line is a group of related changes, a few words long; three lines to a
release, six at most. Plain text and `code` spans. `npm run gates` (first step of
`npm run quick` and of CI) checks the version agrees everywhere, the top heading matches it,
and each release fits. CI skips `*.md`-only commits, so a changelog-only edit is gated by
`npm run quick` alone.

The app shows it: `src/lib/changelog.ts` bundles `CHANGELOG.md` (`?raw`) and **parses** it —
headings by the gate's regex, bullets as text with `code` runs, wrapped bullets joined — and
`WhatsNewModal` lists it. Tapping the tray's status chip — whether it reads the version or ONLINE/OFFLINE
— opens it and flashes the version for 3s, as at startup; the version in Settings'
footer opens it too. The chip opens it on the **click**, not `pointerup`: on touch the click after a tap
would land on the new backdrop and close it at once. It also opens once by itself when the
latest release's *lines* change (`releaseSignature`, stored under
`calendar-timeline:whats-new-seen`), so a patch that only renames the heading doesn't reopen it.
A first run marks the current release read.

## Architecture map

Know where things live so you can go straight to the change:

- **State** — Svelte 5 runes (`$state` / `$derived` / `$effect`); centralized in
  `src/lib/state.svelte.ts`, with scoped `*.svelte.ts` reactive modules. No store library.
- **Types** — everything in `src/lib/types.ts`: types, const option arrays
  (`BLOCK_OPTIONS`, `CALENDAR_COLORS`, `FEED_CATEGORIES`, …), and `SCHEMA_VERSION`.
- **Persistence** — `src/lib/storage.ts` (config load/migrate/save + events cache with
  quota eviction; the cache also carries per-feed HTTP validators — evict/normalize them
  with the feed). Local/imported `.ics` lanes live in `src/lib/scratchpad.ts`. A local
  event's `uid` **is** its exported iCal UID — never regenerate it (a stored entry without one
  gets a uid once, written straight back); edits go through `reviseEvent`, which bumps the
  optional `sequence` / `lastModified` (→ `SEQUENCE` / `LAST-MODIFIED`), and lane writes in
  `state.svelte.ts` go through `persistLane`, which also sets the session-only
  `laneExport.dirty` flag behind Settings' "changed since last export" dot. Share links drop
  uids (a decoded lane is a new copy), so the revision stays out of `share.ts`. A config
  **export file is a full backup**: `exportConfig(config, events.byFeed)` adds a `lanes` key
  (feed id → the stored lane format, `serializeScratchEvents`, uids and revisions intact)
  and import restores it via `importLanes` + `restoreLocalLanes` — never ship an export
  path that drops local events. Files without `lanes` (older exports) import config-only.
- **Repeating local events** — `src/lib/recurrence.ts`. A local lane stores a series **once**
  (`rrule`, `exdates`, `tzid` on `ParsedEvent`; first occurrence as start/end) and
  `_displayByFeed` expands it over the window (`expandLaneEvents`, cached per lane array).
  Occurrence uids are `series#r<startMs>` with `seriesUid` set — never stored. Every lane
  action resolves them in `state.svelte.ts`: edit / editor delete / move / copy act on the
  series, tray delete adds an EXDATE, a drag detaches that occurrence as a one-off (merged
  runs of a series aren't draggable). Timed series repeat on `tzid`'s wall clock. `.ics`
  import goes through `ics-lane.ts` (main thread, on demand): supported RRULEs stay series,
  RECURRENCE-ID overrides become one-offs + EXDATEs, anything finer than days falls back
  to ics-core's fixed copies. Export writes `DTSTART;TZID=` + `RRULE` / `EXDATE`. The
  editor has **no repeat picker** for now (shelved; it only keeps an edited series' rule) —
  `buildRRule` / `presetOf` / `describeRRule` stay in `recurrence.ts`, tested, for when it returns.
- **URL state lives in the fragment** — nothing the app writes to its address goes in the
  query, which browsers send to the server (and so to its logs, and to link-preview
  fetchers): view settings (`#z= loc= df= t=`; `df` is the date format, since `d` is the
  marker), the marker (`#d=`) and a share payload (`#s=`) all sit after the `#`, merged by
  `updateLocation` in `src/lib/url.ts` (never assign `location.hash` wholesale — it drops
  the other keys). Legacy `?z=&loc=&d=&t=` / `?s=` links are read once, then the query keys
  are dropped. A link opened into a running tab is a fragment navigation (no reload): the
  browser fires `popstate`, then `hashchange`. App tags every history entry it has seen
  (`tagHistoryEntry`), so a new **untagged** entry (`isLinkEntry`) is a link, not
  Back/Forward; whichever event comes first runs `openLinkEntry` — share payload, view keys,
  marker (plus `cal:scroll-to-date` there) — and tags it. Never let `popstate`'s
  rewrite-to-present (`syncLocationToView`) run on an untagged entry: it would clobber the
  link before it's read. Our own writes use `replaceState`, which fires neither. PWA
  manifest shortcuts use `/#z=…` too.
- **Sharing** — `src/lib/share.ts` encodes/decodes config to/from share links (`#s=…`,
  plus the marker but **not** the sharer's view keys, which would override the
  recipient's; the marker is passed in — `markerValue(ui.tempMarkerMs, …)` — so the link
  built ahead of the tap tracks it). Payloads are deflate-compressed behind a `2.` prefix and encode/decode are **async**; links
  without the prefix (pre-compression format) are deliberately rejected — no import
  prompt, param stripped. `SHARE_URL_LIMIT` is enforced at both share buttons
  (settings + kiosk): each builds its URL reactively ahead of the tap — building at tap
  time would also cost Safari the user activation `navigator.share` needs. Over the limit
  the button still shares the link, with a tooltip warning that some apps cut long links;
  Export (a full backup, local lanes included) is the lossless route — don't add a
  share-as-file fallback. Decode is forgiving of transit
  damage (`cleanSharePayload` drops whitespace/punctuation that can't be base64url — mail
  wraps, auto-linked trailing `).`), caps the inflated JSON at 1MB. A link **cut short** is
  salvaged, not refused: deflate itself reports the missing end (no checksum needed),
  `inflateRaw` keeps what inflated (bytes glued on after deflate's end also error, but leave
  whole JSON: not a cut), `closeTruncatedJson` closes it at the last value a
  delimiter confirmed and marks each object it closed (`CUT_MARK`); decode drops marked
  feeds/rules/events but keeps a marked lane with the events that arrived (`ev`, and so
  `lf`, are encoded last for this; the kiosk PIN and view go first, ahead of `f` and `r`), and returns `truncated: true` — the import dialog says so and
  never auto-imports it. A link with nothing whole in it opens `ErrorModal` rather
  than vanishing. The
  import dialog keys its lists by index: shared calendars may repeat a name. **What a link
  does is decided in one place**: App decodes it (`openSharedLink`, which drops a decode a
  newer link has overtaken) and hands it to `openShareImport` in
  `src/lib/share-import.svelte.ts`, which asks the pure `decideShareImport` (`share.ts`,
  `ShareImportDecision` in `types.ts`) once with the device's state and refuses with an
  `ErrorModal`, imports at once, or sets `ui.shareImport` for the dialog.
  `ShareImportModal` decides nothing — it shows the link and calls `applyShareImport`,
  which asks again (the device may have locked meanwhile). The import actions
  (Replace / Merge) live in that module too. The table: a kiosk link where PINs can't be
  checked is refused; a locked kiosk refuses every link — a link must not swap what a kiosk
  shows or its PIN (a link opened into its running tab applies none of its view keys or
  marker either — `openLinkEntry`) — **except on a display with no pointer** (`viewport.noPointer`,
  `(any-pointer: none)`: signage), where every whole link imports itself as Replace, lock or
  not, since nobody can answer a dialog and opening a link there already takes control of
  the device (a cut one is refused; the next link clears that note). There Replace also
  swaps the Draft's events instead of appending, so a re-sent link doesn't stack them, and
  Replace everywhere clears the stored events of the imported lanes it drops. Elsewhere only
  a fresh install imports by itself, never a kiosk lock or a cut link.
  Test it with Chromium's `--blink-settings=availablePointerTypes=1,primaryPointerType=1`
  (CDP's media emulation doesn't reach `any-pointer`). Note
  `pushLog` entries aren't rendered anywhere — don't rely on them for user feedback. Local-event timestamps are stored **coarse** — start as a
  minute-resolution delta from the previous event, end as a minute duration. Feed URLs
  are stored **scheme-less** (a leading `https://` is dropped and re-added on decode;
  decode is scheme-tolerant, so `http://`/`webcal://`/already-`https://` URLs are left
  intact). `2.` is the baseline format — the decoder carries **no** pre-`2.` legacy
  branches.
- **Parsing** — `src/lib/ics.ts` (fetch + worker orchestration) + `src/lib/ics-core.ts`
  (parse/expand) + `src/lib/ics.worker.ts` (Web Worker; `ical.js` + `ical-expander`).
  The recurrence iteration cap is derived from the parse window — `ical-expander` counts
  iterations from each series' **DTSTART**, not the window start, so a fixed cap silently
  truncates years-old daily series.
  `ical-expander` declares `ical.js@^1`; an npm `overrides` entry in `package.json` points it
  at the app's ical.js 2 so only one parser ships, and the `icalExpanderInterop` plugin in
  `vite.config.ts` (registered in `plugins` **and** `worker.plugins`) answers its
  `require('ical.js')` with the ESM build's default export. Without it Rolldown follows
  ical.js's `require` export condition and silently bundles a second (ES5 CJS) parser;
  aimed at the ESM file with no unwrap, every feed fails with `q.parse is not a function`.
  Tests and `vite dev` can't catch either — after touching the override, the bundler or
  `vite.config.ts`, check a **production build**: `npm run check:bundle` (one ical.js in the
  `ical` chunk and in `ics.worker`), and a feed parses both in the worker and in the
  main-thread fallback.
- **1W layout** — `src/lib/week-layout.ts` holds WeekGrid's pure layout (timed-block
  packing, all-day lanes, overflow chips, focus walk). Timed events get a block on every
  day they cover; an overlap that starts `nestGapMin` or more after another **nests** over
  it (indented, opaque, `TimedBlock.indent`), closer starts share the width via
  `packLanes`. Day columns stack left over right (inline `z-index`, contained by
  `.wg-days`' `isolation`), so a narrow block's overflowing title paints over the next day
  instead of under it. 1W opens fitted once per page load: until the user zooms it
  (`bumpHourScale`), `config.weekHourScale` tracks `fitHourScale` (24 rows fill the view).
  All-day bars place shortest first (`layoutAllDay`): single days float
to the top lanes, the longest bars settle at the bottom. Timed events wholly scrolled out of
view count into `+N` chips per day (`offscreenCounts` in `WeekGrid`, fed by the scroll
handler's once-per-frame `scrollTopPx` / `scrollLeftPx`). The all-day cap (`capAllDay`) shows a crowded-out bar on days it has alone,
  with a dashed square cut edge; `forEachBlockedDay` in
  `blocking.ts` is the one scan both views build their day hatch from. Its day keys follow
  each view's grid: the horizontal timeline's day columns sit at UTC midnights (events
  placed by raw instant), so it keys on UTC days; 1W passes `tzTop`, so a timed event
  hatches the zoned day column it's drawn in. All-day events key on UTC days in both. **Scope and density
  are independent axes:** Block (global/local) decides *where* a day hatches, style
  (thick/thin) only *how heavily* — a thin global block (e.g. a muted rule with Global
  block) is still a full-timeline band (`timelineHatch`'s `thinBand`), never just its lane.
- **Search & typed dates** — `src/lib/date-words.ts` is the one parser for typed dates/times
  (`matchDate`, `matchTime`, `parseDateQuery`; today is passed in as a UTC midnight —
  search passes `today.value`, the display zone's day). Search's day bounds (`after:`
  `before:`, a marked span) go through `dayStartMs`, so a timed event is judged against the
  zone's midnight. `search-query.ts` builds the search operators (`in:` `loc:` `after:` `before:`
  `"…"`) on it, `quick-add.ts` the add-event title quick entry. `search-state.svelte.ts`
  owns matching: hidden feeds out, collapsed in, a marker span ≥2 days scopes it. Fuse
  indexes the display text, plus raw text only where a rule changed it (`toDoc` in
  `search.ts`; every field twice doubled build and search time), and the index is keyed on
  the candidate set — operators, span, past toggle — so typing fuzzy text reuses it. `next-event.ts` picks the status bar's now/next event.
- **STATUS** — `ParsedEvent.cancelled`: reads `striked` in `decorate` unless a rule
  styles it, and skips the feed's block in `effectiveBlock`. `TRANSP` ("show as free") is
  **deliberately not read**: holiday feeds mark their days transparent, which stopped them
  blocking (it was tried and removed).
  Reading a new VEVENT property means bumping `PARSER_REV` in `ics.ts`, or 304s and
  unchanged bodies keep serving cached events without it.
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
  CSS custom properties for theming. Settings sub-parts live in `src/components/settings/`
  (`ConfigActions` = import/export/reset/share). Component styles are scoped, and
  `RulesEditor` reuses class names like `.field` / `.segmented` with its own CSS — so a
  section moved out of `SettingsPanel` takes its CSS along rather than making the panel's
  form styles `:global`. The events **tray** in `StatusBar.svelte` *is* the
  agenda/list view (selected events as structured rows / TSV table, move/copy/delete
  across lanes, download) — don't add a separate list view. Singleton overlays
  (`EventModal`, `EventHoverCard`) are mounted once in `App.svelte` and driven by
  `ui.*` state, not per-pill. **Code-split:** settings, the dialogs (event, add-event,
  share-import, kiosk PIN, shortcuts, what's new) and `WeekGrid` load through `Lazy.svelte` +
  `src/lib/lazy-components.ts` — mounted the first time their `ui.*` trigger turns true,
  then kept mounted (they gate themselves), and idle-prefetched after startup. Don't
  import them statically, and keep `ics-core` (ical.js) out of main-thread static imports
  — the worker has its own copy; `EventModal`/`ConfigActions` `import()` it on demand.
- **Feed ids** — a remote feed's events carry its **config** id (`feed.id`, passed to
  `fetchAndParseFeed` as `feedId`; `loadEventsCache` restamps old caches), not
  `feedIdFor(source)`: the seeded feeds have readable ids and an edited URL keeps its id,
  so look a feed up by `ev.feedId === feed.id`, and give a new feed `uniqueFeedId(feedIdFor(…))`
  (the hash may be held). When an id's source changes (URL edit, import, reset, share
  replace) call `forgetFeedData` / `forgetChangedFeeds` (`feed-loader.svelte.ts`): it cancels
  the in-flight request and drops events, validators, raw text, zone and error, persisted
  cache included; a refresh whose source changed meanwhile discards its answer. A new source
  reloads through App's load effect; nothing that edits `config.feeds` calls a refresh itself
  (the dialogs no longer take an `onRefresh` prop) — doing both fetches every feed twice.
- **Feed transport** — `src/lib/feed-transport.ts` (`fetchFeed`) decides how a feed's bytes
  arrive, by `config.feedFetch` (Settings → Fetch calendars); `fetchAndParseFeed` /
  `fetchFeedText` **require** `mode`, so no caller can fall back to a route the user didn't
  choose. In **every** mode: secret feeds use the `X-Feed-Id` header, public Google holiday feeds
  (`isPublicHolidayFeed`) use `?url=` so the edge can share them, and a private-network host
  throws `PrivateNetworkFeed` before any request: a shared link must not make the browser
  poke the recipient's LAN, nor hand the address to a proxy that refuses it anyway.
  `isPrivateHost` (`src/lib/private-host.ts`) mirrors the proxy's address ranges exactly
  (IPv4 inside IPv6 included; `api/ics.test.ts` checks the two agree on literals) and adds
  local-only names (`localhost`, `.local`, `.lan`, `.internal`, `.home.arpa`, single-label).
  `http://` and unparsable addresses are refused up front in every mode too (neither route
  loads them); `followsFetchMode` says which feeds a mode change reloads (App passes those
  ids to `loadAllFeeds(range, only)` — a limited pass doesn't reset the refresh throttle). Auto reads with
  `redirect: 'manual'`, so a public URL can't redirect the browser inward (an opaque
  redirect is a refusal: Auto hands it to the proxy, which re-checks every hop). Direct has
  no proxy to hand it to, so it follows redirects (`'follow'`) — the page can't see a
  target before going — and refuses an answer that **landed** on a private host
  (`landedPrivate`: `response.redirected` + `isPrivateHost(response.url)`). The up-front
  check and the proxy's per-hop checks hold in every mode. A public name resolving to a
  private address is beyond a page's reach. Everything else rides the
  `X-Feed-Url` header.
  `'auto'` (default): the browser fetches the host (`credentials: 'omit'`, no referrer, **no
  custom headers** — a conditional header would force a CORS preflight, so validators only
  ride the proxy route; `cache: 'no-cache'` lets the browser revalidate instead). A 200 is
  judged by the **proxy's own rule** (calendar / plain / no type, else the body must start
  `BEGIN:VCALENDAR` — judged on the first chunk, a rejected body cancelled there; the text
  read for an accepted one is handed on as `FeedResponse.text`). A URL with userinfo is
  never read directly (fetch() refuses it). A host's
  own error (404, 429, 5xx…) is the feed's answer, as in Direct — not retried through the
  server. Only a refusal (`REFUSING_STATUSES` 401/403/…, a redirect, a non-calendar 200) or
  no answer (TypeError — a CORS block, or a dead connection — or a header wait over
  `DIRECT_TIMEOUT_MS`) falls back to the proxy, and the host is marked
  (`calendar-timeline:feed-hosts`, `{ until, misses }`): a refusal at once, for
  `BLOCKED_RETRY_MS`, whatever the proxy then gets; no answer **only once the proxy got the
  feed** (a dead connection fails both), for `UNREACHABLE_RETRY_MS` the first time and a
  week once it repeats within a day of the last mark running out (`MISS_STREAK_MS`) — one hiccup mustn't send a calendar through the server for a week.
  The marks are held in memory after the first read; a write re-reads storage and changes
  only its own host (`updateMemory`), so tabs don't overwrite each other. A direct
  success clears the mark (in Direct mode too). `KNOWN_BLOCKED` skips Google / Outlook /
  iCloud up front. `'direct'`: no fallback and no header timeout — a refused or
  non-candidate read throws `DirectFetchUnavailable` (its message is the feed's error);
  marked hosts are asked again; redirects followed (above). `'proxy'`: always the proxy. Abort: the header wait holds a
  listener on the caller's signal only until headers arrive; a direct body read watches the
  signal itself (`readFeedText(fetched, signal)` → `readCapped`, which also applies the
  proxy's 5MB cap; proxy bodies are read plainly, already capped). A change of mode reloads
  the feeds (App's load effect tracks it). Config import/reset keeps the device's
  `feedFetch`, as it keeps `kioskPin`: a file must not quietly loosen a privacy choice
  (Reset restores the default). The error card and a failing row's tooltip say "last
  loaded …" (`formatUpdatedAgo`'s verb), not "updated". `feedFetch` is a device preference: it stays out of share
  links.
- **Serverless** — `api/ics.ts` is an IP-filtered feed proxy **for the app's own origin
  only**: no CORS headers, no preflight (OPTIONS → 405), and `isCrossSite` answers 403 to a
  request the browser marks as another site's (`Sec-Fetch-Site` other than `same-origin` /
  `none`, else an `Origin` naming another host) before any upstream fetch. Clients sending
  neither header (scripts) pass — the rate limiter is all that holds them. Every answer
  carries `nosniff` + `CSP: sandbox` (a feed body is foreign bytes on the app's origin); a
  3xx with no `Location` is a 502 (10s timeout covering the body
  read too, 5MB cap; IPv6 checks judge any IPv4 embedded in it — mapped, NAT64, 6to4), tested
  in `api/ics.test.ts`. The app sends the feed URL percent-encoded in **`X-Feed-Url`**, never
  in the query (request lines land in access logs, and a secret iCal address is a
  credential); `?url=` is still read for older installs. Only a public holiday feed asked
  for by `?url=` is shared-cacheable (`public, s-maxage=600`; `isPublicHolidayFeed` is
  duplicated here rather than imported from app code — an ESM import into the function is
  only proven by a Vercel build — and `api/ics.test.ts` checks the two agree). Other feeds answer `no-store` with `Vary: X-Feed-Url, X-Feed-Id` (they all share one path).
  A secret feed's id rides `X-Feed-Id` (it is the feed's only credential, so not the request
  line); a legacy `?id=` request still works and answers `private, no-cache`. Logs carry
  an error code (`errorCode`), never a message — Node's network errors name the host. The
  service worker keeps **no** feed cache (`ics-feeds` is deleted on activate in `sw-bridge.js`; the app's events
  cache covers offline). Pages send `Referrer-Policy: no-referrer` (`vercel.json` + a meta
  tag);
  `safeFetch` follows redirects by hand (max 5), re-checking every hop (https, no private
  IPs) and dropping conditional headers after the first; upstream requests go through
  `node:http(s)` (`pinnedFetch`) with `guardedLookup`, which judges the addresses the socket
  actually dials (a pre-check alone loses to DNS rebinding) — the one DNS check per hop; up
  front only IP literals are judged (`isPrivateLiteral`, brackets stripped: sockets dial a
  literal without a lookup), and a refused dial (`EHOSTNOTALLOWED`) answers 400. It sends a User-Agent and
  `Accept-Encoding` and decodes the body itself (the 5MB cap counts decoded bytes), as fetch
  did. A secret feed's configured URL is the one unguarded hop (operator-set, may be
  `http://` or internal; its redirects are guarded), on its own keep-alive pool — a reused
  socket skips the lookup. Tests swap `upstream.fetch`; nothing lists the ids. The rate
  limiter is per serverless instance and bounded (a burst brake, not a global quota), keyed
  on `pickClientIp` (the platform's `x-real-ip` over a spoofable `x-forwarded-for`).

## Data-model change checklist

Adding or changing a config / feed / rule field touches the same places every time. Update
**all** of them or user settings silently drop on load and share links break:

1. `src/lib/types.ts` — the type + any `*_OPTIONS` const array. Bump `SCHEMA_VERSION` only
   when `migrate()` can't read the old shape as is (a rename or restructure): an added
   field with a default doesn't bump it (`traySide`, `subLanes`, `feedFetch`), since a
   higher version makes new exports refuse to import into older apps.
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
- **TypeScript stays on 5.9** on purpose: `svelte-check` (4.7.6) declares `typescript ^5 || ^6`
  and reaches TS 7 only through its experimental `--tsgo-experimental-api` flag. Revisit when
  svelte-check supports TS 7 without the flag.
- **Tests** are colocated `*.test.ts`. Vitest globals are on (no imports for
  `describe`/`it`/`expect`/`vi`); use `@testing-library/svelte` for components and fake
  timers for time-dependent UI.
- **Timezone:** the suite runs in `Europe/Athens` on purpose (`tests/setup.ts`) — bugs that
  pass in UTC fail there. Never assume UTC; treat date-only iCal values as
  timezone-agnostic. TZ/DST is a recurring bug class here.
  `today.value` (`today.svelte.ts`) is the **display zone's** calendar day as a UTC
  midnight (App feeds it `config.timezone` via `setTodayZone`), never the UTC date — that
  left the app on yesterday until 03:00 in Athens. Compare a timed event's instants against
  `todayStartMs(false)` / `dayStartMs(day, false)` (the moment that day begins in the
  zone), an all-day event's against the UTC midnight (`allDay = true`).
- **Feed refresh is conditional:** `fetchAndParseFeed` revalidates with stored
  ETag/Last-Modified when the parse range is unchanged; a **304 keeps the cached events
  and skips the worker parse entirely**, so don't assume a refresh repopulates anything
  per-event. Servers that send no validators (or ignore them) are covered by
  `bodyHash` in `FeedValidators`: a SHA-256 of the body with `DTSTAMP` lines dropped
  (Google re-stamps every VEVENT per request), and an identical body under the same range
  returns `kind: 'unchanged'` — events and their array identity kept, no parse, no
  re-render. The raw feed text behind the event modal's source view is session-only —
  after a 304-only reload `EventModal` refetches it on demand. Focus/reconnect refreshes
  are throttled to the refresh interval. The refresh itself lives in
  `src/lib/feed-loader.svelte.ts`: a call mid-refresh joins it and queues one follow-up
  pass, and `ui.loadingFeeds` marks feeds in flight. Each feed gets `FEED_FETCH_TIMEOUT_MS`
  for download **and** parse (one abort signal through `fetchAndParseFeed`): a stuck worker
  parse terminates the shared worker (`resetWorker`) and the main-thread fallback never
  starts once time is up — one hung feed would otherwise hold every later refresh. The load `$effect` in `App.svelte`
  depends only on the range and `remoteFeedsKey` (a string of the visible remote feeds' ids
  and sources) and calls `loadAllFeeds` untracked, so a local lane, a rename or an import of
  the same calendars refetches nothing. `loadAllFeeds` still reads `events` via `untrack` and
  the sources up front (`feed-loader.svelte.test.ts`), for any caller that tracks it.
  Cancelling a feed (`forgetFeedData`) aborts with `FeedCancelled`, which only drops that
  request in the parse worker — a timeout resets the worker, a cancel must not.
- **Performance:** reuse `Intl` formatters (don't construct per-event), gate the Fuse
  search index behind an active query, and skip the O(n²) `assignLanes()` for collapsed
  feeds. **Never write custom properties or attributes on `:root` in a path that then
  measures layout** (or ahead of another effect that does): it invalidates style for the
  whole document, and the next `offsetWidth` / `getBoundingClientRect` forces a full
  style + layout pass over every timeline row — that interleaving once cost ~400 ms of
  startup on a busy timeline. Read first, write after, write only on change, and scope
  vars to the element that consumes them. Row/Timeline virtualization renders **nothing**
  until the scroll window is measured (Timeline measures on mount, before first paint);
  the old render-everything fallback built every pill of the range at startup. The window
  moves in **half-viewport steps** (`windowBase` in `Timeline.svelte`), never per scrolled
  pixel — per-pixel tracking re-filtered every row and churned pills each frame (~3× the
  scroll work). A zoom change sets the window's `scrollLeft` to the destination **before**
  `zoom.value` (`setZoomPreservingCenter`): scrolling only after Svelte's flush rendered a
  whole timeline of wrong pills first. **Keep `position: sticky` (and other
  layer-promoting CSS) off per-pill elements:** every sticky element is composited and
  re-layerized on each scroll frame, and drags the pills it overlaps into layers — sticky on
  every pill label meant ~1,500 layers and a main-thread repaint per scrolled frame. Only
  pills with room for the label to slide pin it (`pinLabel` in `EventPill`). Judge scroll
  changes by **frame times with several busy lanes** (rAF intervals while gliding
  `scrollLeft`, plus the layer count via CDP `LayerTree`), not by total busy time on one
  lane — that is how a change that cut total work still felt worse.
- **Row height** in the horizontal zooms is `rowHeights` in `Timeline.svelte`, separate
  from the lane layout (`rowLanes`): a row stands at the lanes its current/future events
  need (`forwardLaneCount` from `assignLanes`, which places them first, on top), and that
  height **never changes from the present into the future**. Only once the view is scrolled
  back past where today rests (`viewingPast`: today right of the focus anchor) does a row
  grow for past events on lower lanes in the rendered window (`rowLaneLimits`); until then
  `Row` doesn't draw those pills (`laneLimit`), since a row's paint isn't clipped and they
  would spill into the next row.
- **Grid rules:** vertical rules cross horizontal ones, never the reverse. Timeline draws
  the day / month rules behind the rows (z0, under the pills), and each sticky row header
  redraws them (`.hdr-day-line` / `.hdr-month-line`) reaching one `--border-w` past its top
  and bottom, so they paint over the row's top border and the header's bottom border
  without new elements or layers. A focused row's inked rules keep the faint day line
  inside the header. The header's weekend tint and hatch reach over its bottom border
  too (not its top: the body band already tints the row's top border), so a rule reads
  the same inside a weekend as outside it.
- **Sub-lanes by location** (`CalendarFeed.subLanes: 'location'`, the calendar's Lanes
  setting): `assignLocationLanes` in `layout.ts` runs `assignLanes` once per location
  (`locationKey` of `displayLocation`) and stacks the results as `LocationBand`s, so the
  row-height rule above still holds. Standing bands: no-location first, then by soonest
  next event; past events that overflow their band and past-only locations go below
  `forwardLaneCount`, most recent first, split at gaps over `PAST_BAND_SPLIT_GAP_PX` into
  pieces that share lanes when their spans (titles' reserved width included) don't meet.
  `Row` draws standing labels in a sticky, zero-size layer and each past piece's label at
  its first pill. `mergedVisibleFor` merges consecutive days per location for such a feed
  (`mergeConsecutiveDays(…, byLocation)`), so a run across places stays one bar per band.
  Horizontal zooms only — 1W stays merged.
- **App updates:** vite-plugin-pwa in `prompt` mode (`registerSW` in `main.ts`): a new
  service worker installs and waits (status dot pulsing amber, `watchSwUpdates`), its
  `onNeedRefresh` sets `swStatus.updateReady`, and an `App.svelte` effect applies it
  (`applyAppUpdate` → skip waiting + reload) only while neither Settings nor the event
  editor (`ui.addEventOpen`, new or edit) is open. The temp marker survives the reload in
  the URL (`#d=`), so the timeline reopens on it.
  **Pages from before prompt mode (≤ 0.51.9) never post SKIP_WAITING**, so a new worker
  would wait behind them forever (the dot stuck amber; it happened). `public/sw-bridge.js`
  (`workbox.importScripts`) pings every window on install; current pages answer
  (`main.ts`), and if any stays silent the worker skips waiting by itself. A current page
  that missed the ping (frozen tab) sees the `controllerchange` and reloads at the same
  safe moment (`markControllerChanged`). Keep the bridge as long as old installs may be out
  there, and test update paths against a real build of the *old* version, not just the new. Browsers only look for a new worker on a page load, so
  `scheduleSwUpdateChecks` (`sw-status.svelte.ts`) also calls `reg.update()` when the tab
  becomes visible (at most every 5 min) and once a day while open, skipped offline.
- **Accessibility:** honour `prefers-reduced-motion` (the `motion` setting) and the
  `haptics` setting.
- **Pointer hover is mouse-only:** gate `pointerenter`/`pointerleave` handlers on
  `e.pointerType === 'mouse'` so touch keeps tap / long-press (the hover preview and the 1W
  crosshair both do this). Hover intent is debounced through `ui.hoverEvent` +
  `openHoverPreview`/`closeHoverPreviewSoon` in `state.svelte.ts` — a persistent singleton
  that swaps content between pills rather than closing/reopening, so it never flashes.
- **Today line in the header:** Timeline's `.today-line` SVG sits at z4 — under the
  sticky header (z5), over lane titles and pills — and `TimeHeader` draws the line's run
  through the header itself (`.now-line-head`, so it follows the header on vertical
  scroll), in front of a paper patch with the `--clock-halo` (`.now-gap`) bridging the
  day/night icon and the time — full tier height and `clip-path`-clipped to it, so the
  halo never spills into the month row.
- **"Point in time" marker recipe:** accent colour + a paper halo — `color: var(--accent-color);
  filter: var(--clock-halo)` (no solid background box). Reuse it for anything that marks a
  time on the grid (now-line label, 1W hover crosshair time). The halo follows the *glyphs*,
  not the box — padding doesn't widen it, so a label can still be overprinted by whatever
  sits under it (1W's sticky band label is the standing example).
- **Temp marker is a span, not a point:** `ui.tempMarkerMs` is the start day and
  `ui.tempMarkerEndMs` an optional *inclusive* last day (UTC midnight both). Never write
  either field directly — go through `setTempMarkerDay` / `setTempMarkerRange` /
  `clearTempMarker` in `state.svelte.ts`, and read the resolved span via `markerRange()`
  (`{ startMs, endMs, days }`), which tolerates an end left behind by a stray write.
  Gestures: tap empty space anywhere — timeline body, header band, 1W hour grid, 1W all-day
  strip — to place it, drag an edge to move/resize, hold the start line and keep dragging
  to pull a duration out, double-tap either edge to clear. A double-tap clears on its
  `pointerup` through `clearTempMarkerByTap`, and every tap-to-place click handler bails on
  `isTrailingClearClick()`: on touch the tap's synthesized click lands on the grid under
  the just-removed line and would place the marker straight back (mouse doesn't show it).
  The hold lives in `src/lib/marker-hold.ts` (`createDayHold`), shared by `Timeline` and
  `WeekGrid` so the gesture can't drift between them. It is measured against the **day**
  under the pointer plus a pixel slop, never against raw pixels: the old "cancel the hold
  after 4px" rule was a touch assumption that made the gesture unreachable with a mouse or
  trackpad. Crossing deliberately into another day **restarts** the hold rather than killing
  it, so a pause anywhere along a drag still pulls a duration out — and the slop matters
  because the start line is drawn *on* a day boundary, where a 1px wobble flips days. Arm
  from `ui.tempMarkerMs` read at fire time, never from a day captured at pointerdown.
  The span drives the tray's window (exactly `[start … last day + 1)`; a single-day marker
  keeps the default month) and round-trips through `#d=YYYY-MM-DD..YYYY-MM-DD`.
  Its readout is split across the edges, locale-aware, from `format.ts`: the day count
  (`formatDayCount` — `12D`, `12Η` in Greek) left of the **start** edge, `formatSpanEdgeLabel`
  (`WED — SUN · 2026-05-01 — 12`) right of the **end** edge, in every zoom including 1W. The
  start edge carries a plain date only for a single-day marker. A duration resized down to
  one day reads as a single-day marker everywhere (`markerIsSpan()` gates the count, range
  label, tray window and the drawn end line); its end edge stays mounted, invisible, so the
  resize drag keeps its pointer capture.
  In the tray a duration marker titles the list with `formatSpanLabel` (`12D · 2026-05-01 —
  12`), drops the leading Today/date section, and clips every week heading to the marked days
  (`5D · MAY 1–3, 2026 (W18)`, via `intersectDaySpan` in `time.ts`) — selection mode is never
  clipped, since selected events may sit outside the span.
- **Drag to reschedule (local lanes only):** three layers. `src/lib/event-drag-gesture.ts`
  (`createPointerDrag`) decides *when* a drag starts/moves/ends/cancels, shared by
  `EventPill` and `WeekEvent`; the view that owns the geometry (`Row.svelte` for the
  horizontal zooms, `WeekGrid.svelte` for 1W) supplies the `DragSource` that maps the pointer
  to a `DragChange`, draws the ghost, and commits via `rescheduleLocalEvents` in
  `state.svelte.ts`; `src/lib/event-drag.ts` holds the pure math. A change is a **delta**
  applied per member (`dragMembers` — a merged run or 1W duplicate group moves whole) on the
  display zone's **wall clock** (`shiftWallClock` / `zonedWallToInstant`), which is what keeps
  a 10:00 event at 10:00 across DST. Gesture rules: a mouse/pen drags once past
  `HOLD_SLOP_PX`; a touch drags only after the long-press has armed it (an unheld swipe stays a
  scroll, and `blockTouchScroll` stops native panning once armed); pointer capture is taken at
  **pointerdown** (a 6px resize edge is left behind by the first move otherwise). A draggable
  pill's long-press selects on **release**, not at the hold: selecting opens the tray, which on
  a wide screen is a side panel that reflows the view under a finger about to drag.
  Alt+←/→ (and Alt+↑/↓ in 1W) apply the same changes from the keyboard. Every reschedule
  pushes an **undo** entry (`src/lib/undo.svelte.ts`): each touched lane's array before and
  after — lanes are replaced, never mutated, so this is free — and `undoLastChange` restores
  `before` only while the lane is still `after` (any other write makes it stale and it
  refuses); any other `persistLane` write to a lane clears the history (`invalidateUndoFor`).
  The tray handle shows the change with UNDO (the multi-select actions' slot) and has **no
  timer** — `StatusBar` dismisses it on a tap elsewhere (a pan or drag past the slop doesn't
  count) or a key other than undo / Alt+arrow; dismissing keeps the history for Ctrl/⌘+Z,
  which does the same outside text fields.
- **Focus anchor, not dead centre:** every horizontal-timeline scroll (load, jump-to-today,
  today↔marker toggle, zoom/resize preservation, search hits, row nav arrows) parks the
  focused date at `focusAnchorOffset()` from `layout.ts`, via `scrollToAnchor` /
  `anchorOffset` in `Timeline.svelte`: mid-way through the gap between the toolbar's 1W
  and 1M buttons (`layout.weekGapMid`, measured by `Toolbar.svelte`) at every width, so
  the marker rests on a line the chrome already draws and most of the width shows the
  future. Until the gap is measured a scrollport ≥900px uses the zoom nav's right edge
  (`layout.zoomNavRight`, which SearchToolbar also sets inline as `--toolbar-6m-right` on
  its field) and a narrower one dead centre.
  Writers and the readers that invert them must use the **same** helper or dates jump on
  zoom and resize. Two deliberate exceptions: the music sweep's playhead stays centred (its
  contract is a marker mid-screen), and 1W left-aligns its target column instead, 2px in
  from the gutter (`WEEK_ANCHOR_NUDGE_PX`), with seven columns fit to the day area less 4px
  (`WEEK_FIT_INSET_PX`) so 2px of the eighth day shows.
- **Emoji in event titles** draw in monochrome Noto Emoji — titles only (pill, 1W block/bar,
  hover card, event card, tray row, editor title input), via `--title-font`; every other
  field keeps the platform emoji. `styles/title-emoji.css` (imported in `main.ts`) declares
  it as `Title Emoji` from `@fontsource-variable/noto-emoji`'s files, generated from the
  package's `index.css` **minus** the text glyphs it also carries (digits, `#`, `*`, ©, ®,
  ™), so it can lead the stack and win over text faces that have an emoji's glyph too.
  Chrome still sends an emoji-presentation sequence (`✈️` = U+2708 U+FE0F) to the colour
  font whatever the stack says, so title render sites go through `titleGlyphs`
  (`event-display.ts`), which drops U+FE0F for display only. Its woff2 subsets load on
  demand and are runtime-cached by the service worker, not precached.
- **Kiosk PIN** (`src/lib/kiosk-pin.ts`): `config.kioskPin` and share links (`kh`) hold a
  PBKDF2 hash (`p1.<len>.<iter>.<salt>.<hash>`), never the digits; set and unlock go through
  `hashPin` / `verifyPin` (async, ~0.3s). PINs are 4 digits (a lock against casual use: the link's data isn't encrypted). Plain digits (the old
  4-digit `k` / stored PIN) are not read at all: no such links or locks are out there, and
  dropping one fails open. Iterations are capped on read, so a crafted link can't hang an
  unlock. Web Crypto exists only on secure pages: without it (`canCheckPins`) setting a PIN
  fails with a message and a kiosk link is refused whole (`decideShareImport`'s
  `insecure`) — never imported unlocked, never a lock that can't be opened. `kh` is
  the payload's first key, so a link cut short either still carries it or decodes to
  nothing; a link missing its start doesn't inflate at all (tests cover every cut). `isKiosk()` is still just `kioskPin != null`.
  A locked kiosk returns home `KIOSK_IDLE_MS` after the last input (`watchIdle` in
  `src/lib/kiosk-idle.ts`, `returnKioskHome` in `App.svelte`), once per idle spell and never
  before a first input (signage keeps what a link set). Home — zoom, marker, collapsed rows —
  is a `KioskHome` read when the lock begins, kept in sessionStorage keyed by the PIN hash so
  a reload doesn't adopt a visitor's `#z=`; an imported link clears it and bumps
  `ui.kioskHomeRev`, so a re-sent link with the same PIN sets a new home. Input is `USER_INPUT_EVENTS` (`src/lib/user-input.ts`, shared
  with Timeline's idle recentering) — not `scroll`, since the app scrolls itself. Every
  "back to today" goes through `goToToday` (`state.svelte.ts`).
- **Content-Security-Policy** lives in `vercel.json` (with `nosniff`): scripts from `'self'`
  plus `index.html`'s inline theme script **by hash** — edit that script and update the hash
  (`tests/csp.test.ts` fails until you do); `connect-src https:` because Auto/Direct read
  calendar hosts from the page; `frame-ancestors 'none'`. Check a change against a
  production build served with those headers — `vite dev` doesn't send them.
- **Layers and motion** are tokens on `:root` (`global.css`): `--z-chrome` < `--z-tray` <
  `--z-bar` / `--z-panel` < `--z-dialog` < `--z-popover` < `--z-flourish` for whatever floats
  over the app (native `<dialog>`s sit in the top layer above them all; stacking inside one
  component keeps small local numbers), and `--dur-ui` (150ms: dialogs, panels, slides,
  fades), `--dur-quick` (80ms: anything following the pointer), `--dur-pulse` (1.2s loading
  pulses) for timing. Use them rather than new literals; a JS timer that waits out a
  transition says so (the tray's `fullyExpanded`). `--dur-ui` is also declared on
  `::backdrop`, like `--backdrop-dim`.
- **Dialog backdrops** share `--backdrop-dim` (`global.css`, also declared on `::backdrop`,
  which doesn't inherit `:root` vars before Chrome 122 / Safari 17.4) and a literal
  `backdrop-filter: blur(2px)`. Write **only** the unprefixed `backdrop-filter`: the build's
  CSS minifier adds `-webkit-` itself, and a hand-written pair collapsed to the prefixed form
  alone, which Chrome and Firefox ignore — the blur silently never applied there.
- **Timeline header heights** (`--time-header-h`, `--time-header-date-h`) scale with the
  root font size (`max(px, calc(px / 14 * 1rem))`), so larger text keeps to its rows.
- **Appearance modes:** `config.palette` / `config.scheme` may hold a *mode* rather than a value —
  `'auto'` (both axes) and `'shake'` (both axes, resolving to a random roll held in
  `ui.shakePalette` / `ui.shakeScheme`). Neither may reach `data-palette` / `data-scheme`; go
  through `displayPalette()` / `displayScheme(prefersDark)` in `state.svelte.ts`, passing
  `viewport.prefersDark`. The roll is session-only — the *mode* is what persists — and is
  re-rolled by `rollShake()` on launch, on arming, and on a device shake (`src/lib/shake.ts`,
  wired in `App.svelte`). Flavor's `'auto'` resolves to `DEFAULT_PALETTE_FLAVOR`, so changing
  the default flavor is a one-line edit in `types.ts`. Adding a flavor means extending
  `PALETTE_FLAVORS`, not `PALETTES` (which is the wider validation list, modes included).
- **Theme tokens:** the three base flavor tokens are `--ink-color` / `--paper-color` /
  `--accent-color` (plus `--link-color`); derived tokens keep their names (`--ink-faint`,
  `--ink-muted`, `--paper-2`). Buttons signal hover/focus by tinting the text/icon
  (`--accent-color` on hover, `--link-color` on focus) — no background fills; persistent
  pressed/selected/expanded states keep their inverted `--ink-color` fill.
- **Browser support** is Vite 8's default build baseline — Chrome/Edge 111, Firefox 114,
  Safari 16.4 (no `build.target` in `vite.config.ts`). Deliberate: modern browsers only, so
  modern syntax and CSS need no fallbacks; don't lower it.
  Features the latest Firefox / Safari / Chrome all ship are fine even past that floor —
  e.g. CSS `:has()` (Firefox 121): use it where it's the clearest tool.
- **Desktop vs mobile** (and the OS dark / reduced-motion preferences) comes from one
  reactive store, `viewport` in `src/lib/viewport.svelte.ts`: `isPortraitMobile` (≤640),
  `isLandscapeMobile` (≤900), `isDesktop` (neither), `prefersDark`, `prefersReducedMotion`,
  one listener per query. Read it — never call `matchMedia` in a component. It holds the raw
  device facts only; the `scheme` / `spacing` / `traySide` settings that override
  them are resolved at their use sites (`App.svelte`, the settings labels). `motion` resolves
  in `src/lib/motion.ts` (`reducedMotion`, `smoothBehavior`): every programmatic smooth scroll
  takes its behavior from `smoothBehavior()` — a literal `'smooth'` overrides the
  reduced-motion CSS.
- **Verifying UI without live feeds:** the sandbox proxy can't fetch the seeded holiday
  feeds (they 404 to HTML — ignore those console errors). Drive the app with the global
  Playwright (`require` from `/opt/node22/lib/node_modules`, browser at
  `/opt/pw-browsers/chromium`) and seed events by writing
  `localStorage['calendar-timeline:scratchpad']` (see `SerializedScratchEvent`) then setting
  the Draft feed's `hidden: false` in `calendar-timeline:config` and reloading.
- **Style:** no ESLint/Prettier config — match surrounding code (2-space indent, camelCase
  for funcs/vars, PascalCase for types/components, UPPER_SNAKE for constants).
- **Commits:** imperative, feature-focused subject lines (matching existing history).
