import {
  SNAP_MIN,
  applyDragChange,
  createDaySnap,
  dragMembers,
  formatDragReadout,
  isNoopChange,
  nudgeChange,
  rescheduled,
  shiftWallClock,
  snapMinutes,
  timedDaySpan,
  zonedWallToInstant,
  type EventTimes,
} from './event-drag';
import { zonedParts } from './format';
import type { DisplayEvent } from './types';

// The suite runs in Europe/Athens (tests/setup.ts). In 2026 Athens springs
// forward on Sun 29 March (03:00 → 04:00, +2 → +3) and falls back on Sun 25
// October (04:00 → 03:00, +3 → +2).
const ATHENS = 'Europe/Athens';
const D = 86_400_000;

function wall(date: Date, tz = ATHENS): string {
  const p = zonedParts(date, tz);
  const hh = String(Math.floor(p.minutes / 60)).padStart(2, '0');
  const mm = String(p.minutes % 60).padStart(2, '0');
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')} ${hh}:${mm}`;
}

function timed(startIso: string, endIso: string): EventTimes {
  return { start: new Date(startIso), end: new Date(endIso), allDay: false };
}

function allDay(startDay: string, days: number): EventTimes {
  const start = Date.parse(startDay + 'T00:00:00Z');
  return { start: new Date(start), end: new Date(start + days * D), allDay: true };
}

function display(over: Partial<DisplayEvent>): DisplayEvent {
  return {
    uid: 'u',
    feedId: 'scratchpad:default',
    title: 't',
    description: '',
    descriptionSnippet: '',
    location: '',
    start: new Date(0),
    end: new Date(D),
    allDay: true,
    displayTitle: 't',
    displayDescription: '',
    displayDescriptionSnippet: '',
    displayLocation: '',
    styleVariant: 'none',
    hidden: false,
    ruleCategory: null,
    ruleColor: null,
    ruleBlock: null,
    ...over,
  };
}

describe('zonedWallToInstant', () => {
  it('converts an ordinary wall time in the zone', () => {
    // Athens is +3 in summer.
    expect(zonedWallToInstant(2026, 6, 10, 10 * 60, ATHENS).toISOString()).toBe('2026-06-10T07:00:00.000Z');
    // …and +2 in winter.
    expect(zonedWallToInstant(2026, 1, 10, 10 * 60, ATHENS).toISOString()).toBe('2026-01-10T08:00:00.000Z');
  });

  it('normalises overflowing days and minutes', () => {
    expect(wall(zonedWallToInstant(2026, 1, 31, 25 * 60, ATHENS))).toBe('2026-02-01 01:00');
  });

  it('lands just past a spring-forward gap for a wall time that does not exist', () => {
    // 03:30 on 29 March 2026 never happens in Athens.
    const t = zonedWallToInstant(2026, 3, 29, 3 * 60 + 30, ATHENS);
    expect(wall(t)).toBe('2026-03-29 04:30');
  });

  it('picks a real instant for the repeated fall-back hour', () => {
    const t = zonedWallToInstant(2026, 10, 25, 3 * 60 + 30, ATHENS);
    expect(wall(t)).toBe('2026-10-25 03:30');
  });

  it('works for UTC and the device zone', () => {
    expect(zonedWallToInstant(2026, 3, 29, 90, 'UTC').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(wall(zonedWallToInstant(2026, 3, 30, 600, 'local'))).toBe('2026-03-30 10:00');
  });
});

describe('shiftWallClock', () => {
  it('keeps the wall-clock time when a day shift crosses spring-forward', () => {
    const before = new Date('2026-03-28T08:00:00Z'); // Sat 10:00 Athens (+2)
    const after = shiftWallClock(before, 2, 0, ATHENS);
    expect(wall(after)).toBe('2026-03-30 10:00');
    // Only 47 real hours elapsed, not 48.
    expect(after.getTime() - before.getTime()).toBe(47 * 3_600_000);
  });

  it('keeps the wall-clock time when a day shift crosses fall-back', () => {
    const before = new Date('2026-10-24T07:00:00Z'); // Sat 10:00 Athens (+3)
    const after = shiftWallClock(before, 1, 0, ATHENS);
    expect(wall(after)).toBe('2026-10-25 10:00');
    expect(after.getTime() - before.getTime()).toBe(25 * 3_600_000);
  });

  it('carries seconds through untouched', () => {
    const before = new Date('2026-06-10T07:00:30.500Z');
    expect(shiftWallClock(before, 0, 15, ATHENS).toISOString()).toBe('2026-06-10T07:15:30.500Z');
  });
});

describe('applyDragChange', () => {
  it('shifts an all-day span by whole UTC days, regardless of zone', () => {
    const t = applyDragChange(allDay('2026-03-28', 3), { kind: 'shift', days: 2, minutes: 0 }, ATHENS);
    expect(t).toEqual(allDay('2026-03-30', 3));
  });

  it('moves a timed event by days and minutes on the wall clock', () => {
    const ev = timed('2026-03-27T08:00:00Z', '2026-03-27T09:00:00Z'); // Fri 10:00–11:00
    const t = applyDragChange(ev, { kind: 'shift', days: 3, minutes: 45 }, ATHENS);
    expect(wall(t.start)).toBe('2026-03-30 10:45');
    expect(wall(t.end)).toBe('2026-03-30 11:45');
    expect(t.allDay).toBe(false);
  });

  it('resizes an all-day span from either edge, never below one day', () => {
    const ev = allDay('2026-05-04', 3); // 4–6 May
    expect(applyDragChange(ev, { kind: 'resize-days', edge: 'end', days: 2 }, ATHENS)).toEqual(allDay('2026-05-04', 5));
    expect(applyDragChange(ev, { kind: 'resize-days', edge: 'start', days: -1 }, ATHENS)).toEqual(allDay('2026-05-03', 4));
    expect(applyDragChange(ev, { kind: 'resize-days', edge: 'end', days: -9 }, ATHENS)).toEqual(allDay('2026-05-04', 1));
    expect(applyDragChange(ev, { kind: 'resize-days', edge: 'start', days: 9 }, ATHENS)).toEqual(allDay('2026-05-06', 1));
  });

  it('resizes a timed end, never shorter than a snap step', () => {
    const ev = timed('2026-06-10T07:00:00Z', '2026-06-10T08:00:00Z');
    const longer = applyDragChange(ev, { kind: 'resize-end', minutes: 30 }, ATHENS);
    expect(wall(longer.end)).toBe('2026-06-10 11:30');
    expect(longer.start).toEqual(ev.start);
    const collapsed = applyDragChange(ev, { kind: 'resize-end', minutes: -300 }, ATHENS);
    expect(collapsed.end.getTime() - collapsed.start.getTime()).toBe(SNAP_MIN * 60_000);
  });

  it('ignores resize kinds that do not fit the event', () => {
    const ad = allDay('2026-05-04', 1);
    expect(applyDragChange(ad, { kind: 'resize-end', minutes: 30 }, ATHENS)).toEqual(ad);
    const tm = timed('2026-06-10T07:00:00Z', '2026-06-10T08:00:00Z');
    expect(applyDragChange(tm, { kind: 'resize-days', edge: 'end', days: 1 }, ATHENS)).toEqual(tm);
  });

  it('turns a timed event into an all-day one on the drop day', () => {
    const ev = timed('2026-06-10T07:00:00Z', '2026-06-10T08:00:00Z');
    const dayMs = Date.UTC(2026, 5, 12);
    expect(applyDragChange(ev, { kind: 'to-all-day', dayMs, days: 1 }, ATHENS)).toEqual(allDay('2026-06-12', 1));
  });

  it('turns an all-day event into a timed one at the drop slot, across DST', () => {
    const ev = allDay('2026-03-28', 1);
    const t = applyDragChange(
      ev,
      { kind: 'to-timed', dayMs: Date.UTC(2026, 2, 29), startMin: 9 * 60 + 15, durationMin: 60 },
      ATHENS,
    );
    expect(t.allDay).toBe(false);
    expect(wall(t.start)).toBe('2026-03-29 09:15');
    expect(wall(t.end)).toBe('2026-03-29 10:15');
  });
});

describe('isNoopChange', () => {
  it('flags only changes that leave the event where it was', () => {
    expect(isNoopChange({ kind: 'shift', days: 0, minutes: 0 })).toBe(true);
    expect(isNoopChange({ kind: 'shift', days: 0, minutes: 15 })).toBe(false);
    expect(isNoopChange({ kind: 'resize-days', edge: 'end', days: 0 })).toBe(true);
    expect(isNoopChange({ kind: 'resize-end', minutes: 0 })).toBe(true);
    expect(isNoopChange({ kind: 'to-all-day', dayMs: 0, days: 1 })).toBe(false);
  });
});

describe('snapMinutes', () => {
  it('rounds to the nearest 15 minutes', () => {
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(-8)).toBe(-15);
    expect(snapMinutes(52, 30)).toBe(60);
  });
});

describe('createDaySnap', () => {
  it('ignores a wobble across a day boundary inside the slop', () => {
    const snap = createDaySnap(10);
    snap.start(100, 50);
    // Over the next day, but only 4px from where the day was taken.
    expect(snap.update(200, 54)).toBe(100);
    // A deliberate move past the slop switches.
    expect(snap.update(200, 70)).toBe(200);
    // And a 1px wobble back doesn't flip it again.
    expect(snap.update(100, 69)).toBe(200);
    expect(snap.day).toBe(200);
  });
});

describe('dragMembers', () => {
  it('returns the pill itself for a plain local event', () => {
    const ev = display({});
    expect(dragMembers(ev)).toEqual([ev]);
  });

  it('refuses URL-feed events', () => {
    expect(dragMembers(display({ feedId: 'feed-1' }))).toBeNull();
  });

  it('moves every member of a merged run', () => {
    const a = display({ uid: 'a' });
    const b = display({ uid: 'b' });
    expect(dragMembers(display({ uid: 'a', spanDays: 2, spanMembers: [a, b] }))).toEqual([a, b]);
  });

  it('refuses a duplicate group that reaches into a URL feed', () => {
    const a = display({ uid: 'a' });
    const b = display({ uid: 'b', feedId: 'feed-1' });
    expect(dragMembers(display({ uid: 'a', dupCount: 2, dupMembers: [a, b] }))).toBeNull();
  });
});

describe('nudgeChange', () => {
  it('maps arrows to a day or a snap step', () => {
    expect(nudgeChange('left', false)).toEqual({ kind: 'shift', days: -1, minutes: 0 });
    expect(nudgeChange('right', true)).toEqual({ kind: 'shift', days: 1, minutes: 0 });
    expect(nudgeChange('up', false)).toEqual({ kind: 'shift', days: 0, minutes: -SNAP_MIN });
    expect(nudgeChange('down', false)).toEqual({ kind: 'shift', days: 0, minutes: SNAP_MIN });
    expect(nudgeChange('up', true)).toBeNull();
  });
});

describe('rescheduled', () => {
  it('keeps every other field of the stored event', () => {
    const ev = { ...display({ uid: 'x', title: 'Trip', location: 'Crete' }), ...allDay('2026-05-04', 2) };
    const out = rescheduled(ev, { kind: 'shift', days: 1, minutes: 0 }, ATHENS);
    expect(out).toMatchObject({ uid: 'x', title: 'Trip', location: 'Crete', allDay: true });
    expect(out.start.toISOString()).toBe('2026-05-05T00:00:00.000Z');
  });
});

describe('timedDaySpan', () => {
  it('counts the zone days a timed event touches, end exclusive', () => {
    expect(timedDaySpan(timed('2026-06-10T07:00:00Z', '2026-06-10T08:00:00Z'), ATHENS)).toBe(1);
    // 22:00 → 02:00 next day in Athens.
    expect(timedDaySpan(timed('2026-06-10T19:00:00Z', '2026-06-10T23:00:00Z'), ATHENS)).toBe(2);
    // Ends exactly at midnight: still one day.
    expect(timedDaySpan(timed('2026-06-10T19:00:00Z', '2026-06-10T21:00:00Z'), ATHENS)).toBe(1);
  });
});

describe('formatDragReadout', () => {
  const opts = { timezone: ATHENS, dateFormat: 'YYYY-MM-DD', timeFormat: '24h', locale: 'en' } as const;
  it('reads out an all-day landing', () => {
    expect(formatDragReadout(allDay('2026-05-04', 1), opts)).toBe('MON 2026-05-04');
    expect(formatDragReadout(allDay('2026-05-04', 3), opts)).toBe('MON 2026-05-04—06');
  });
  it('adds the clock range for a timed landing, in the display zone', () => {
    expect(formatDragReadout(timed('2026-05-06T07:15:00Z', '2026-05-06T08:15:00Z'), opts)).toBe(
      'WED 2026-05-06 · 10:15—11:15',
    );
  });
});
