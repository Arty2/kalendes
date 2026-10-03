# Changelog

What kalendes gained, newest first, in a few words each. One section per minor
version, headed by the last version it shipped as: a patch rewrites its minor's
heading to the new number and adds its lines there, never a section of its own.
Features only — not fixes, not why, not how; that is the README's.
Easter eggs and hidden gestures stay hidden: not listed here. Three lines
to a release, six at the very most. Plain text and `code` spans only.

## 0.48.4 — 2026-10-03

- Imported `.ics` files keep their repeating events as repeating events.
- Drag down an empty 1W slot to add an event that long; on touch, hold, then drag.
- In 1W, overlapping events stack to keep their titles readable, and timed events spanning days show on each day.
- Event cards add the event's own timezone when it differs from yours: `20:00 — 21:00 JST · Tokyo, JP`.

## 0.47.5 — 2026-10-03

- Search finds events by their filtered names and in collapsed calendars, and narrows with `in:`, `loc:`, `after:`, `before:` and "quoted words".
- Type a date in search to go there; a marked span limits search to its days; select every match into the tray.
- Add an event in one line: `Lunch fri 13-14 @Taverna` fills in its date, time and place, highlighted until you change them.
- Cancelled events are struck through, and events shown as free never block a day.
- The status bar shows the event under way and its time left; tap it to open the event, and choose in Settings which events it shows.
- Hidden calendars stay out of share links; exports still keep them.

## 0.46.4 — 2026-10-03

- What's new: tap the status in the tray, or the version in Settings, to see what each release brought; it opens by itself once after an update.

## 0.45.0 — 2026-10-03

- Export is a full backup: local lanes and their events travel with your settings.
- Faster startup, and smoother scrolling and zooming on busy timelines.
- Long share links still share, with a warning that some apps cut them.
- Today's events stand out on the event card; thin global blocks band the whole timeline.

## 0.44.1 — 2026-10-02

- Drag a local event to reschedule it, or its edge to resize it, in every zoom and in 1W; `Alt` and the arrows do the same from the keyboard.
- Exported lanes keep their event IDs, so importing them again updates events instead of duplicating them.
- A share link cut short on the way opens an explanation instead of vanishing.

## 0.43.0 — 2026-09-24

- Each calendar shows while it is loading and when it last updated.

## 0.42.3 — 2026-09-24

- The day marker stretches into a span: hold its line and drag to mark several days, with a day count and the dates at its edges.
- The tray lists the marked days, and the span travels in the link.
- Holding the marker works with a mouse too; jumps land under the zoom buttons, leaving more of the future in view.

## 0.41.1 — 2026-07-30

- Travel is now part of a calendar's type; calendar and filter settings reworked, with headings that stay pinned.
- Events stay within the past and future months you chose.

## 0.40.0 — 2026-07-30

- An outline of the app shows from the first frame while it loads.

## 0.39.1 — 2026-07-29

- Filters mark matches without changing them by default; replacing the text is an option.
- Shorter share links.

## 0.38.0 — 2026-07-28

- Share links carry each calendar's and filter's style.

## 0.37.1 — 2026-07-23

- 1W: a TODAY marker with a day/night icon, and softer working-hours edges.
- Swipe the event card to page to the previous or next event.

## 0.36.0 — 2026-07-22

- Drag to reorder calendars and filters; an eye on each row hides it.
- A current-timezone column in 1W, and `Ctrl`/`⌘` `S` saves the open form.
- Tap a calendar's header to collapse it; swatches preview how a calendar blocks days.

## 0.35.0 — 2026-07-19

- Share links include local calendars, and a redesigned import dialog shows what is coming in.
- Single-key shortcuts in the style of Google Calendar.
- 1W: drag the day marker, page by week, drag to pan.
- A Grey calendar colour; dates show in your primary timezone.

## 0.34.2 — 2026-07-16

- Click and drag to pan the timeline; long-press search for the list of shortcuts.
- Retuned flavors, each with its own link colour, themed from the first frame.

## 0.33.1 — 2026-07-14

- Number keys jump between zooms; the arrows walk events and lanes.
- `Enter` triggers a dialog's main action, like copying from the event card.

## 0.32.0 — 2026-07-13

- On desktop the events tray slides in from the left.

## 0.31.1 — 2026-07-13

- Colour flavors, each in light and dark; the light/dark control is now Scheme.
- The event card shades dates by how recent they are and marks today's event.

## 0.30.0 — 2026-07-12

- Previous/next arrows on the event card, and weekday names on its dates.
- Clearer settings labels that show what Auto resolved to.

## 0.29.0 — 2026-07-12

- Drag across the zoom buttons to scrub between zooms; on small screens the edge zooms tuck into slivers.

## 0.28.0 — 2026-07-11

- The app is now kalendes, with a new ϗ icon.

## 0.27.0 — 2026-07-11

- Share opens your device's share sheet.
- The event editor checks what you enter; timezones read 1st and 2nd.

## 0.26.0 — 2026-07-10

- Same-title events share a lane, and adjacent timed events no longer overlap.
- Settings preview changes live in the card you are editing; a primary and a secondary timezone.

## 0.25.0 — 2026-07-07

- Repeats on consecutive days merge into one bar, in every zoom and in 1W's all-day row.
- Current and upcoming events sit on top, past ones below.
- An Outline style for calendars and filters.

## 0.24.0 — 2026-07-04

- Feeds download again only when they have changed, and share links are compressed.
- Each calendar type has its own icon, and events can carry a travel tag.
- `Space` toggles 1W; settings remember which sections were open; `webcal://` links work.

## 0.23.0 — 2026-07-02

- Hovering an event previews it; duplicates across calendars collapse in 1W.

## 0.22.0 — 2026-07-02

- 1W: a week grid with hours down the side, two timezones and day/night shading.
- Click an empty slot in 1W to add an event there.

## 0.21.0 — 2026-06-28

- Block setting: a calendar or filter can hatch its days, in its own lane or across the timeline.
- Filters gain the same options as calendars.

## 0.20.0 — 2026-06-28

- `Ctrl` and scroll zooms; redesigned timeline headers.
- A border weight setting, a DST override, and one timezone picker everywhere.

## 0.19.1 — 2026-06-08

- Spacing setting: comfortable or condensed.
- Delete, move and copy confirm with a second tap and offer an undo countdown.

## 0.18.0 — 2026-06-06

- Paste a Google Calendar share or embed link and it becomes a feed.

## 0.17.1 — 2026-06-02

- Import `.ics` files as local lanes, move events between them, and export them back.
- Works offline and installs as an app.
- Long-press Reset to load demo data.

## 0.16.1 — 2026-05-31

- The today marker holds its place across zooms and rotation.

## 0.15.0 — 2026-05-30

- Haptics setting: vibration, sound, or both.

## 0.14.1 — 2026-05-29

- Kiosk mode: lock the app behind a 4-digit PIN for shared screens.
- Collapsible settings groups; a reload opens on today.

## 0.13.0 — 2026-05-28

- Reduced-motion and font-size settings; hold the gear to flip between light and dark.
- One download menu per calendar; feeds are read in the background, so scrolling stays smooth.

## 0.12.2 — 2026-05-27

- Turn any calendar on or off; calendars that are off aren't fetched.
- Minute-precise day/night limits; collapsed rows show styled event dots.

## 0.11.0 — 2026-05-26

- The now-line bends for each timezone, with a sun or moon for day and night.

## 0.10.1 — 2026-05-22

- New event styles, Hidden among them; past events fade.
- Filters mark matched events with a dot; the Draft lane can be renamed and edited.

## 0.9.0 — 2026-05-20

- A Draft lane for your own events, added with a date picker.
- Reset and delete ask for a second tap.

## 0.8.0 — 2026-05-19

- Long-press to select several events and export them as `.ics`.

## 0.7.0 — 2026-05-18

- Week-start setting: Monday or Sunday.
- The tray shows the app version on launch.

## 0.6.1 — 2026-05-17

- The event card's source view shows the raw iCal, with filter matches highlighted.

## 0.5.0 — 2026-05-16

- An events tray: upcoming events in copyable columns, with a raw view.
- Filter the tray by type, travel and location.

## 0.4.0 — 2026-05-15

- Events load from the last visit for an instant start, then refresh in the background.
- An event detail card; morning and evening limits hide events outside your hours.

## 0.3.0 — 2026-05-13

- Zoom smoothly between levels, and drag the day marker.
- Year rows, compact collapsed rows and style swatches.

## 0.2.1 — 2026-05-11

- Find-and-replace rules rename, recolour and hide events.
- Light and dark themes, Greek and English, search and keyboard navigation.
- Share links, a status-bar tray, and an installable app.
- Zoom out to two years; per-calendar timezones with day/night shading.
- Place a day marker anywhere.

## 0.1.0 — 2026-05-01

- A horizontal timeline of iCal feeds, starting with Greek public holidays.
