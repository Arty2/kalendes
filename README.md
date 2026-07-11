# /kalendes

A timeline view for your iCal feeds.

## What it does

Shows your calendars side-by-side as horizontal rows along a continuous timeline. Pinch-zoom from a single month out to two years, or drop into a **1-week hour grid** (1W) for a Google-Calendar-style day-by-day view across two timezones. Built for spotting overlap and travel across multiple feeds at once. Black-on-paper, e-ink friendly. Reads any ICS feed (Google, iCloud, Outlook, Fastmail, Nextcloud).

## How it works

`/kalendes` is a static Svelte 5 + Vite app. It pulls iCal feeds through a tiny Vercel proxy (sandboxed CORS, cache-friendly), parses them with `ical.js`, and renders pills with a custom lane-assignment layout. Find-and-replace rules let you rename, recolour, and filter events. Each calendar carries a category (None / Holidays / Travel International / Travel Local). Settings, feeds, and rules live in `localStorage` and survive across devices via the share-link / paste-config flow. Calendars can also be imported from `.ics` files into local, editable lanes (see [Import & export](#import--export)). Offline-first: a service worker caches the shell and the last good feed responses. Events are cached locally for instant display on load, with background refresh.

## Week view (1W)

The **1W** toolbar button (left of the zoom row) switches into a week grid: days as columns, hours down the side, all feeds merged onto one surface. It sits outside the pinch/wheel zoom progression and is toggled on its own — tap **1W** again to return to the previous zoom, or **double-tap** it to clear the day marker and jump back to today.

- **Two timezones side-by-side** — the frozen left gutter shows the hour axis for the two zones set in Settings (top/bottom), plus your local zone when it differs. Country codes label each in the header corner, and the live local time rides the now-line.
- **Day/night shading** — the working-hours window (Boundaries → morning/evening limits) is drawn per zone: the page colour marks where *both* zones are working (the overlap), a light tint where one is off, a darker tint where both are off. Dashed lines mark each zone's morning/evening edges; sun/moon glyphs sit in the gutter.
- **The day marker is shared across zooms** — set it by clicking a date header (in any view); switching between the timeline and 1W keeps it in view.
- **Navigation & editing** — arrow keys move a focus ring between events and days (Enter opens, Space selects); click an empty slot to draft a new event at that time; double-click an event to copy its details; a mouse hover shows a crosshair with the exact time. Pinch or Ctrl/⌘-scroll changes the row height. Horizontal scroll is bounded by the past/future-months setting.

## Settings

- **Appearance** — theme, language, date/time format, timezone, and the two timezones shown side-by-side in the 1W week view
- **Boundaries** — past/future months visible (also bounds how far the 1W week view scrolls); morning and evening time limits (hide timed events outside a chosen hour range, and drive the 1W day/night shading)
- **Find & replace** — rename, recolour, or hide events by keyword
- **Calendars** — add, reorder, and configure ICS feeds. You can also paste a Google Calendar **share** or **embed** link (e.g. `https://calendar.google.com/calendar/embed?src=…`) and it's converted to that calendar's ICS feed automatically — the calendar must be shared publicly, otherwise Google returns a 404 and the feed shows an error explaining how to enable public sharing.
- **Refresh interval** — 30 min / 1 h / 4 h

## Import & export

The Configuration section's **Import** button (and long-press to paste from the clipboard) accepts two kinds of input, auto-detected from the content:

- **A JSON config** — the format produced by **Export** — replaces your current calendars, rules, and settings. Use it to move a full setup between devices, alongside the share-link flow.
- **An `.ics` calendar file** — adds its events as a new **local lane**, named after the calendar (`X-WR-CALNAME`), the file, or the import date. A local lane behaves like the built-in **Draft**: its events are editable, stored in `localStorage`, and not synced to any URL. Recurring events are expanded to a static snapshot within the visible window at import time; no link to the source file is kept. Each `.ics` you import becomes its own lane, and any imported lane can be deleted.

In **Calendars**, each row carries a marker that distinguishes local lanes (Draft and imported `.ics`) from URL-backed feeds: an **unlink** glyph for local, not-synced lanes and a **link** glyph for linked URL feeds. Each local lane can be exported back to an `.ics` file from its row.

## Kiosk mode

For wall displays and shared screens. Long-press the gear icon (~3s) to set a 4-digit PIN; the icon becomes a padlock and the app locks into a read-only view — settings, calendar/filter editing, the events tray, and all downloads/exports are disabled, while browsing, search, and collapsing/expanding calendar rows still work. Long-press the padlock (~3s) to bring up the unlock modal; the correct PIN clears the lock. The PIN survives reloads (so the screen stays locked), and the **Copy link** button produces a share link that, when opened, prompts to import the setup and then lands locked.

## Developer & testing

The **Reset** button in Settings → Configuration normally takes two taps to reset everything to defaults. It also carries a hidden developer shortcut: **long-press it (~3s)** to reset to defaults *and* seed a demo dataset — a **Draft** lane of varied sample events (past/future all-day spans, timed meetings around today, overlaps across categories) plus a second imported test lane — then reload. A confirm dialog guards it, since it replaces your current calendars, rules, and settings. Handy for exercising the timeline, the 1W week grid, and the layout code without wiring up real feeds.

## Credit

Dialectic Acheiropoieton of Heracles Papatheodorou and Claude.

MIT License.
