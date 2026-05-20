# /almanacs

A timeline view for your iCal feeds.

## What it does

Shows your calendars side-by-side as horizontal rows along a continuous timeline. Pinch-zoom from a single month out to two years. Built for spotting overlap and travel across multiple feeds at once. Black-on-paper, e-ink friendly. Reads any ICS feed (Google, iCloud, Outlook, Fastmail, Nextcloud).

## How it works

`/almanacs` is a static Svelte 5 + Vite app. It pulls iCal feeds through a tiny Vercel proxy (sandboxed CORS, cache-friendly), parses them with `ical.js`, and renders pills with a custom lane-assignment layout. Find-and-replace rules let you rename, recolour, and filter events. Each calendar carries a category (None / Holidays / Travel International / Travel Local). Settings, feeds, and rules live in `localStorage` and survive across devices via the share-link / paste-config flow. Offline-first: a service worker caches the shell and the last good feed responses. Events are cached locally for instant display on load, with background refresh.

## Settings

- **Appearance** — theme, language, date/time format, timezone
- **Boundaries** — past/future months visible; morning and evening time limits (hide timed events outside a chosen hour range)
- **Find & replace** — rename, recolour, or hide events by keyword
- **Calendars** — add, reorder, and configure ICS feeds
- **Refresh interval** — 30 min / 1 h / 4 h

## Credit

Dialectic Acheiropoieton of Heracles Papatheodorou and Claude.

MIT License.
