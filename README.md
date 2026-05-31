# /almanacs

A timeline view for your iCal feeds.

## What it does

Shows your calendars side-by-side as horizontal rows along a continuous timeline. Pinch-zoom from a single month out to two years. Built for spotting overlap and travel across multiple feeds at once. Black-on-paper, e-ink friendly. Reads any ICS feed (Google, iCloud, Outlook, Fastmail, Nextcloud).

## How it works

`/almanacs` is a static Svelte 5 + Vite app. It pulls iCal feeds through a tiny Vercel proxy (sandboxed CORS, cache-friendly), parses them with `ical.js`, and renders pills with a custom lane-assignment layout. Find-and-replace rules let you rename, recolour, and filter events. Each calendar carries a category (None / Holidays / Travel International / Travel Local). Settings, feeds, and rules live in `localStorage` and survive across devices via the share-link / paste-config flow. Calendars can also be imported from `.ics` files into local, editable lanes (see [Import & export](#import--export)). Offline-first: a service worker caches the shell and the last good feed responses. Events are cached locally for instant display on load, with background refresh.

## Settings

- **Appearance** — theme, language, date/time format, timezone
- **Boundaries** — past/future months visible; morning and evening time limits (hide timed events outside a chosen hour range)
- **Find & replace** — rename, recolour, or hide events by keyword
- **Calendars** — add, reorder, and configure ICS feeds
- **Refresh interval** — 30 min / 1 h / 4 h

## Import & export

The Configuration section's **Import** button (and long-press to paste from the clipboard) accepts two kinds of input, auto-detected from the content:

- **A JSON config** — the format produced by **Export** — replaces your current calendars, rules, and settings. Use it to move a full setup between devices, alongside the share-link flow.
- **An `.ics` calendar file** — adds its events as a new **local lane**, named after the calendar (`X-WR-CALNAME`), the file, or the import date. A local lane behaves like the built-in **Draft**: its events are editable, stored in `localStorage`, and not synced to any URL. Recurring events are expanded to a static snapshot within the visible window at import time; no link to the source file is kept. Each `.ics` you import becomes its own lane, and any imported lane can be deleted.

Local lanes (Draft and imported `.ics`) are marked with a "not synced" badge to distinguish them from URL-backed feeds, and each can be exported back to an `.ics` file from its row in **Calendars**.

## Kiosk mode

For wall displays and shared screens. Long-press the gear icon (~3s) to set a 4-digit PIN; the icon becomes a padlock and the app locks into a read-only view — settings, calendar/filter editing, the events tray, and all downloads/exports are disabled, while browsing, search, and collapsing/expanding calendar rows still work. Long-press the padlock (~3s) to bring up the unlock modal; the correct PIN clears the lock. The PIN survives reloads (so the screen stays locked), and the **Copy link** button produces a share link that, when opened, prompts to import the setup and then lands locked.

## Credit

Dialectic Acheiropoieton of Heracles Papatheodorou and Claude.

MIT License.
