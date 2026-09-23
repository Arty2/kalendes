// Pure date math and snapping behind drag-to-reschedule (and its Alt+arrow
// keyboard twin). Local-lane events only: URL feeds are refetched and would
// overwrite any edit, so nothing here ever touches them.
//
// A gesture is reduced to a `DragChange` — "shift by N days and M minutes",
// "resize the end", "turn into an all-day event on day D" — and applied to each
// underlying event with `applyDragChange`. Expressing it as a delta rather than
// a target time is what lets one drag move a whole merged run (every member
// shifts by the same days) and keeps timed moves DST-correct: the shift happens
// on the wall clock of the display zone, so a 10:00 event dragged across a DST
// boundary still starts at 10:00.

import { MS_PER_DAY } from './time';
import { formatDayAbbrev, formatRange, formatTime, zonedDateProxy, zonedParts } from './format';
import type { DateFormat, DisplayEvent, Locale, ParsedEvent, TimeFormat, Timezone } from './types';

/** Timed moves and resizes snap to this many minutes. */
export const SNAP_MIN = 15;
const MS_PER_MIN = 60_000;

export type EventTimes = { start: Date; end: Date; allDay: boolean };

export type DragChange =
  // Move by whole days (all-day and timed alike) plus, for timed events, minutes.
  | { kind: 'shift'; days: number; minutes: number }
  // Drag an all-day span's first or last day.
  | { kind: 'resize-days'; edge: 'start' | 'end'; days: number }
  // Drag a timed event's end (1W bottom edge).
  | { kind: 'resize-end'; minutes: number }
  // Dropped on the 1W all-day strip: an all-day event on `dayMs` (UTC midnight).
  | { kind: 'to-all-day'; dayMs: number; days: number }
  // Dropped on the 1W hour grid: a timed event on `dayMs` at `startMin`.
  | { kind: 'to-timed'; dayMs: number; startMin: number; durationMin: number };

export function isLocalFeedId(feedId: string): boolean {
  return feedId.startsWith('scratchpad:');
}

/**
 * The stored events a pill stands in for, or null when it can't be dragged. A
 * merged consecutive-day run and a 1W duplicate group carry their members; a
 * plain pill is just itself. Every member has to live in a local lane — moving
 * half of a duplicate group would split it across a feed that can't be edited.
 */
export function dragMembers(ev: DisplayEvent): DisplayEvent[] | null {
  const members =
    ev.spanMembers && ev.spanMembers.length > 1
      ? ev.spanMembers
      : ev.dupMembers && ev.dupMembers.length > 1
        ? ev.dupMembers
        : [ev];
  return members.every((m) => isLocalFeedId(m.feedId)) ? members : null;
}

/** Whether `change` alters anything at all (a drag released where it began). */
export function isNoopChange(change: DragChange): boolean {
  switch (change.kind) {
    case 'shift':
      return change.days === 0 && change.minutes === 0;
    case 'resize-days':
      return change.days === 0;
    case 'resize-end':
      return change.minutes === 0;
    default:
      return false;
  }
}

export function snapMinutes(min: number, step = SNAP_MIN): number {
  return Math.round(min / step) * step;
}

/**
 * The instant at which the wall clock in `tz` reads y-m-d + `minutes` past
 * midnight. `d` and `minutes` may overflow (Date.UTC normalises them), which is
 * how day/minute shifts are expressed. For a wall time that doesn't exist (the
 * hour skipped at a spring-forward) this lands just after the gap; for one that
 * occurs twice (fall-back) it picks the first.
 */
export function zonedWallToInstant(
  y: number,
  m: number,
  d: number,
  minutes: number,
  tz: Timezone,
): Date {
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  // The zone's offset at instant t, in ms (wall - utc), at minute resolution.
  const offsetAt = (t: number): number => {
    const p = zonedParts(new Date(t), tz);
    return Date.UTC(p.y, p.m - 1, p.d, 0, p.minutes) - Math.floor(t / MS_PER_MIN) * MS_PER_MIN;
  };
  // Two passes: the first guess uses the offset at the wall time read as UTC,
  // the second corrects it with the offset at the resulting instant, which only
  // differs within a few hours of a transition.
  const first = wall - offsetAt(wall);
  const second = wall - offsetAt(first);
  if (second === first) return new Date(first);
  // Straddling a transition: prefer whichever candidate reads back as the
  // requested wall time; in a spring-forward gap neither does, so take the later.
  const readsBack = (t: number): boolean => t + offsetAt(t) === wall;
  if (readsBack(first)) return new Date(first);
  if (readsBack(second)) return new Date(second);
  return new Date(Math.max(first, second));
}

/** Shift an instant's wall clock in `tz` by whole days and minutes. */
export function shiftWallClock(date: Date, days: number, minutes: number, tz: Timezone): Date {
  const p = zonedParts(date, tz);
  // zonedParts is minute-resolution; carry the seconds/ms over unchanged.
  const sub = date.getTime() - Math.floor(date.getTime() / MS_PER_MIN) * MS_PER_MIN;
  return new Date(zonedWallToInstant(p.y, p.m, p.d + days, p.minutes + minutes, tz).getTime() + sub);
}

/** The UTC-midnight anchor of the calendar day `date` falls on in `tz`. */
export function zonedDayMs(date: Date, tz: Timezone): number {
  const p = zonedParts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d);
}

/** Minutes past midnight of `date`'s wall clock in `tz`. */
export function zonedMinutes(date: Date, tz: Timezone): number {
  return zonedParts(date, tz).minutes;
}

/**
 * Where `ev` lands after `change`. Clamps so the result is never empty or
 * inverted: an all-day span keeps at least one day, a timed event SNAP_MIN.
 */
export function applyDragChange(ev: EventTimes, change: DragChange, tz: Timezone): EventTimes {
  switch (change.kind) {
    case 'shift': {
      if (ev.allDay) {
        // All-day values are UTC midnights and zone-agnostic: plain day math.
        const d = change.days * MS_PER_DAY;
        return { start: new Date(ev.start.getTime() + d), end: new Date(ev.end.getTime() + d), allDay: true };
      }
      return {
        start: shiftWallClock(ev.start, change.days, change.minutes, tz),
        end: shiftWallClock(ev.end, change.days, change.minutes, tz),
        allDay: false,
      };
    }
    case 'resize-days': {
      if (!ev.allDay) return { ...ev };
      const d = change.days * MS_PER_DAY;
      if (change.edge === 'start') {
        const start = Math.min(ev.start.getTime() + d, ev.end.getTime() - MS_PER_DAY);
        return { start: new Date(start), end: ev.end, allDay: true };
      }
      const end = Math.max(ev.end.getTime() + d, ev.start.getTime() + MS_PER_DAY);
      return { start: ev.start, end: new Date(end), allDay: true };
    }
    case 'resize-end': {
      if (ev.allDay) return { ...ev };
      const moved = shiftWallClock(ev.end, 0, change.minutes, tz).getTime();
      const end = Math.max(moved, ev.start.getTime() + SNAP_MIN * MS_PER_MIN);
      return { start: ev.start, end: new Date(end), allDay: false };
    }
    case 'to-all-day': {
      const days = Math.max(1, change.days);
      return {
        start: new Date(change.dayMs),
        end: new Date(change.dayMs + days * MS_PER_DAY),
        allDay: true,
      };
    }
    case 'to-timed': {
      const day = new Date(change.dayMs);
      const start = zonedWallToInstant(
        day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), change.startMin, tz,
      );
      const end = zonedWallToInstant(
        day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(),
        change.startMin + Math.max(SNAP_MIN, change.durationMin), tz,
      );
      return { start, end, allDay: false };
    }
  }
}

/** How many calendar days (in `tz`) a timed event touches — its all-day width. */
export function timedDaySpan(ev: EventTimes, tz: Timezone): number {
  if (ev.allDay) return Math.max(1, Math.round((ev.end.getTime() - ev.start.getTime()) / MS_PER_DAY));
  const first = zonedDayMs(ev.start, tz);
  // The end is exclusive: an event ending exactly at midnight doesn't touch that day.
  const last = zonedDayMs(new Date(ev.end.getTime() - 1), tz);
  return Math.max(1, Math.round((last - first) / MS_PER_DAY) + 1);
}

export type DaySnap = {
  /** Begin tracking at `day` (UTC-midnight ms) under viewport `x`. */
  start(day: number, x: number): void;
  /** The snapped day for a pointer now over `day` at `x`. */
  update(day: number, x: number): number;
  readonly day: number;
};

/**
 * Day snapping with the same hysteresis as the marker hold (marker-hold.ts —
 * callers pass its HOLD_SLOP_PX; not imported here, since state.svelte.ts
 * imports this module and marker-hold pulls in haptics → state):
 * the snapped day only changes once the pointer is over a different day AND has
 * travelled past a pixel slop from where the current day was taken. Without the
 * slop a pointer resting on a day boundary flips the ghost back and forth on
 * every 1px wobble.
 */
export function createDaySnap(slopPx: number): DaySnap {
  let current = 0;
  let atX = 0;
  return {
    start(day, x) {
      current = day;
      atX = x;
    },
    update(day, x) {
      if (day !== current && Math.abs(x - atX) >= slopPx) {
        current = day;
        atX = x;
      }
      return current;
    },
    get day() {
      return current;
    },
  };
}

/** Keyboard nudge (Alt+arrows): the change for one press. */
export function nudgeChange(key: 'left' | 'right' | 'up' | 'down', allDay: boolean): DragChange | null {
  if (key === 'left' || key === 'right') {
    return { kind: 'shift', days: key === 'left' ? -1 : 1, minutes: 0 };
  }
  // Up/down moves by SNAP_MIN; an all-day event has no time of day to nudge.
  if (allDay) return null;
  return { kind: 'shift', days: 0, minutes: key === 'up' ? -SNAP_MIN : SNAP_MIN };
}

/** Re-time `ev` (a stored event) with the result of `change`, keeping every other field. */
export function rescheduled<T extends ParsedEvent>(ev: T, change: DragChange, tz: Timezone): T {
  const t = applyDragChange(ev, change, tz);
  return { ...ev, start: t.start, end: t.end, allDay: t.allDay };
}

/**
 * The live readout beside the ghost: the landing day(s), plus the clock range
 * for a timed event — `WED 2026-05-06 · 10:15—11:15`.
 */
export function formatDragReadout(
  t: EventTimes,
  opts: { timezone: Timezone; dateFormat: DateFormat; timeFormat: TimeFormat; locale: Locale },
): string {
  const start = t.allDay ? t.start : zonedDateProxy(t.start, opts.timezone);
  const end = t.allDay ? t.end : zonedDateProxy(t.end, opts.timezone);
  const days = formatRange(start, end, opts.dateFormat, opts.locale, '—');
  const day = formatDayAbbrev(start, opts.locale) + ' ' + days;
  if (t.allDay) return day;
  return (
    day + ' · ' + formatTime(t.start, opts.timeFormat, opts.timezone) + '—' +
    formatTime(t.end, opts.timeFormat, opts.timezone)
  );
}
