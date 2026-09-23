# kalendes — improvement prompts

Ready-to-paste prompts for fresh sessions. Each is self-contained and follows the rules in
`CLAUDE.md` (data-model checklist, `Europe/Athens` tests, `npm run quick` before pushing,
one patch bump per session that ships user-facing changes).

## 1. Drag to reschedule local events

Add drag-to-reschedule for events in **local lanes** (Draft and imported `.ics`). Pills from
URL-backed feeds stay read-only.

- **Horizontal zooms (`EventPill.svelte` / `Timeline.svelte`):** dragging a pill's body moves
  the event by whole days. Dragging its left or right edge resizes all-day spans. Snap to days
  by reusing the day-under-pointer plus pixel-slop approach in `src/lib/marker-hold.ts`, not raw
  pixel thresholds.
- **1W (`WeekEvent.svelte` / `WeekGrid.svelte`):** dragging a timed event moves it across days
  and hours, snapping to 15 min. Dragging the bottom edge changes its duration. Dragging between
  the all-day strip and the hour grid switches the event between all-day and timed.
- It has to live alongside the existing gestures: tap opens the modal, long-press selects into
  the tray, the mouse hover preview is gated on `pointerType === 'mouse'`, and the temp-marker
  gestures should work as before. The drag starts only after a hold or past the slop, so
  scrolling and panning still work on touch.
- Show a ghost pill and a live time readout while dragging, using the accent "point in time"
  recipe. Esc cancels. Honour the `motion` and `haptics` settings.
- Save through the scratchpad API in `src/lib/scratchpad.ts` (`saveScratchpad`). Keep the DST
  handling correct: moving a timed event across a DST boundary should keep its wall-clock time.
  Add tests under `Europe/Athens`.
- Also add keyboard parity: with a local event focused, Alt+←/→ moves it by a day and Alt+↑/↓
  moves it by 15 min in 1W. Update the README shortcuts table.
- Put the pure snapping and date math in a new `src/lib/event-drag.ts` with colocated tests.
  Run `npm run quick` before pushing, and bump the patch version.

## 2. Central breakpoint store

Replace the duplicated `matchMedia` calls with a single reactive viewport module,
`src/lib/viewport.svelte.ts`. It should expose `isPortraitMobile`, `isLandscapeMobile`,
`isDesktop`, `prefersDark` and `prefersReducedMotion` as `$state` values, backed by one
listener per media query and SSR/test-safe when `matchMedia` is missing. Define the
breakpoints once, as exported constants: portrait ≤640 and landscape ≤900.

- Migrate these call sites: `TimeHeader.svelte:52`, `StatusBar.svelte:63`,
  `WeekGrid.svelte:73` and `:921`, `SettingsPanel.svelte:925–946`, `Toolbar.svelte:245`,
  `App.svelte:219/258/277/285/310`, `drag-reorder.svelte.ts:138`, and `main.ts:45` if it's
  safe before mount.
- There should be no visible behaviour change. Note that the `motion` setting overrides
  `prefers-reduced-motion`, and the scheme setting overrides `prefers-color-scheme`. Keep that
  resolution where it lives now, and only replace the raw media reads.
- Add a happy-dom test that fakes `matchMedia` change events. Update the "Desktop vs mobile"
  bullet in `CLAUDE.md` to point to the new module. Run `npm run quick`.

## 3. Feed health panel

In Settings → Calendars, add a per-feed health readout (collapsed by default, one line per feed
row) showing:

- the last successful fetch time
- whether the last refresh was a 304 (from the cached ETag/Last-Modified validators in
  `storage.ts`)
- the event count within the parse window
- the last error message and when it happened
- the time of the next scheduled refresh

If any of this isn't stored yet, keep it **session-only** display state rather than persisting
it. If it truly needs to persist, follow the data-model checklist in `CLAUDE.md`: `types.ts`,
`storage.ts` normalize/migrate, and deliberately keep it *out* of `share.ts`. Add a "Retry now"
action for a failing feed that bypasses the refresh throttle. Local lanes show only their event
count. Include tests for any new storage fields and a component test for the readout. Run
`npm run quick`.

## 4. Upcoming-event reminders

Add opt-in notifications before timed events.

- Add a per-feed setting, `remindMinutes`: off / 5 / 10 / 15 / 30 / 60. The default is off.
  Follow the full data-model checklist in `CLAUDE.md`, and decide whether it should round-trip
  through share links (probably yes, as the calendar's behaviour) and say which you chose.
- Ask for Notification permission only when the user first enables a reminder, never on load.
- Schedule from the main thread for events in the next 24h, and reschedule after each feed
  refresh, keeping in mind that a 304 keeps the cached events. Deduplicate by event UID plus
  start time so a refresh doesn't fire duplicates. Where the service worker is available, show
  the notification through `registration.showNotification`.
- Make clear in the UI that reminders only fire while the app or PWA is open, since there's no
  push backend. Don't add a server.
- Skip all-day events and anything hidden by rules. Also respect kiosk mode: no permission
  prompts while it's locked.
- Put the pure scheduling logic in a `src/lib/reminders.ts` with fake-timer tests under
  `Europe/Athens`, including a DST-crossing case. Run `npm run quick`.

## 5. Lightweight "view" share link

Add a second share mode, "Share this view", next to the existing Share button in both Settings
and kiosk. It should encode only the zoom, the date or temp-marker span (as the existing `#d=`
fragment) and a chosen subset of feeds (URL, name, colour, type), with no rules, PIN or view
preferences.

- Reuse the `2.` deflate format in `src/lib/share.ts` with a new discriminator, so old decoders
  reject it cleanly and new ones route it.
- Opening such a link should show the calendars **temporarily**, without importing them, with a
  banner offering "Add these calendars" (merge) or "Dismiss". Nothing touches localStorage
  unless the user accepts.
- Enforce `SHARE_URL_LIMIT` the same way the full share does. Add round-trip tests in
  `share.test.ts`. Update the README "Share links" section. Run `npm run quick`.

## 6. Local-lane export improvements

Local lanes can already be downloaded as `.ics`. Extend that:

- Add a "Copy .ics" action on each local lane row in Settings → Calendars, and in the tray for
  selected events, that puts the calendar text on the clipboard.
- Emit stable UIDs and a `SEQUENCE`/`LAST-MODIFIED` that bumps on edit, so re-importing into
  another calendar app updates events instead of duplicating them. Check how UIDs are generated
  in `scratchpad.ts` (`makeScratchpadEvent`) and don't regenerate existing ones. If you change
  the stored shape, follow the data-model checklist and migrate.
- Show a small "changed since last export" dot on a local lane that was edited after its last
  export (session or persisted, your call; justify it).
- Add tests for the UID and SEQUENCE stability and for the export text. Run `npm run quick`.
