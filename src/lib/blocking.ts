import type { Block, CalendarFeed, DisplayEvent, StyleVariant } from './types';
import { MS_PER_DAY } from './time';

// Day-blocking hatch helpers, shared by the horizontal timeline (per-feed rows +
// header band) and the 1W week grid (per-day columns). Kept as pure functions so
// both surfaces classify blocking identically.

// Resolve an event's effective style the same way EventPill does, so the
// row/header hatch matches what each pill renders as.
export function effectiveStyle(ev: DisplayEvent, feed: CalendarFeed): StyleVariant {
  if (ev.styleVariant !== 'none') return ev.styleVariant;
  if (feed.style) return feed.style;
  return 'none';
}

// Resolve an event's effective Block (the day-hatch scope), with a matching
// rule's block taking precedence over the calendar's own block — the same
// precedence rules use for style/color. A rule's 'off' (No block) is an
// explicit override that forces the event non-blocking even over a
// Global/Local calendar; 'off' is otherwise equivalent to 'none'.
export function effectiveBlock(ev: DisplayEvent, feed: CalendarFeed): Block {
  if (ev.ruleBlock && ev.ruleBlock !== 'none') {
    return ev.ruleBlock === 'off' ? 'none' : ev.ruleBlock;
  }
  const feedBlock = feed.block ?? 'none';
  return feedBlock === 'off' ? 'none' : feedBlock;
}

// Hatch density by effective style: prominent styles get the heavy hatch,
// tentative ones the discreet hatch, and struck/hidden contribute nothing.
export function hatchDensity(ev: DisplayEvent, feed: CalendarFeed): 'thick' | 'thin' | 'none' {
  const s = effectiveStyle(ev, feed);
  if (s === 'striked' || s === 'hidden') return 'none';
  if (s === 'dashed' || s === 'muted') return 'thin';
  return 'thick';
}

// Hatch density for a settings style-swatch (a feed or rule, no event): the same
// style→density rule as hatchDensity, but only when day-blocking is actually on
// ('global'/'local'). 'none'/'off' → no hatch. Used to preview a calendar/filter's
// blocking in its swatch margin.
export function swatchHatch(block: Block, style: StyleVariant | undefined): 'thick' | 'thin' | 'none' {
  if (block !== 'global' && block !== 'local') return 'none';
  if (style === 'striked' || style === 'hidden') return 'none';
  if (style === 'dashed' || style === 'muted') return 'thin';
  return 'thick';
}

// Stable UTC "Y-M-D" key (no zero-padding) for a calendar day.
export function dayKeyOf(d: Date): string {
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}

// The UTC day-keys an event spans (inclusive). All-day events treat an exact
// midnight end as the previous day's last moment.
export function eventDayKeys(ev: DisplayEvent): string[] {
  const keys: string[] = [];
  const start = ev.start;
  const lastMs = ev.allDay ? Math.max(start.getTime(), ev.end.getTime() - 1) : ev.end.getTime();
  let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(
    new Date(lastMs).getUTCFullYear(),
    new Date(lastMs).getUTCMonth(),
    new Date(lastMs).getUTCDate(),
  );
  while (cursor <= last) {
    keys.push(dayKeyOf(new Date(cursor)));
    cursor += MS_PER_DAY;
  }
  return keys;
}
