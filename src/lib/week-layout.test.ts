import {
  createDragSpan,
  layoutTimedDays,
  layoutAllDay,
  capAllDay,
  allDayClipTest,
  dayFocusItems,
  locateFocusedUid,
  nearestDayWithEvents,
  type AllDayRow,
} from './week-layout';
import { zonedParts } from './format';
import { MS_PER_DAY } from './time';
import type { DisplayEvent, Timezone } from './types';

const TZ = 'Europe/Athens' as Timezone;
// Column 0 is 2026-03-02 (a Monday) in Athens.
const ANCHOR = Date.UTC(2026, 2, 2);
const DAYS = 7;

function colOf(d: Date): number {
  const p = zonedParts(d, TZ);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d) - ANCHOR) / MS_PER_DAY);
}
function utcColOf(d: Date): number {
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ANCHOR) / MS_PER_DAY);
}

function ev(uid: string, start: string, end: string, allDay = false, title = uid): DisplayEvent {
  return {
    uid, feedId: 'f', title, description: '', descriptionSnippet: '', location: '',
    start: new Date(start), end: new Date(end), allDay,
    displayTitle: title, displayDescription: '', displayDescriptionSnippet: '', displayLocation: '',
    styleVariant: 'none',
  } as DisplayEvent;
}

describe('layoutTimedDays', () => {
  it('places events by their start day in the display zone, in minutes', () => {
    // 22:30Z on Mar 2 is 00:30 on Mar 3 in Athens (UTC+2).
    const cols = layoutTimedDays([ev('late', '2026-03-02T22:30:00Z', '2026-03-02T23:30:00Z')], DAYS, colOf, TZ);
    expect(cols[0]).toEqual([]);
    expect(cols[1]![0]).toMatchObject({ startMin: 30, endMin: 90, continuesEnd: false });
  });

  it('clips an overnight event to midnight and flags that it continues', () => {
    const cols = layoutTimedDays([ev('night', '2026-03-02T20:00:00Z', '2026-03-03T02:00:00Z')], DAYS, colOf, TZ);
    expect(cols[0]![0]).toMatchObject({ startMin: 22 * 60, endMin: 1440, continuesEnd: true });
  });

  it('gives a multi-day event a block on every day it covers', () => {
    // 07:30 Mar 2 → 08:30 Mar 5, Athens.
    const cols = layoutTimedDays([ev('trip', '2026-03-02T05:30:00Z', '2026-03-05T06:30:00Z')], DAYS, colOf, TZ);
    expect(cols.slice(0, 5).map((c) => c.map((b) => [b.startMin, b.endMin, b.continuesStart, b.continuesEnd]))).toEqual([
      [[450, 1440, false, true]],
      [[0, 1440, true, true]],
      [[0, 1440, true, true]],
      [[0, 510, true, false]],
      [],
    ]);
  });

  it('nests a later-starting overlap over the earlier event, and splits close starts', () => {
    const cols = layoutTimedDays(
      [
        ev('workshop', '2026-03-04T09:30:00Z', '2026-03-04T10:30:00Z'),
        ev('lunch', '2026-03-04T10:00:00Z', '2026-03-04T11:00:00Z'),
        ev('call', '2026-03-04T10:10:00Z', '2026-03-04T10:40:00Z'),
      ],
      DAYS, colOf, TZ, 25,
    );
    expect(cols[2]!.map((b) => [b.ev.uid, b.indent, b.lane, b.laneCount])).toEqual([
      ['workshop', 0, 0, 1], ['lunch', 1, 0, 2], ['call', 1, 1, 2],
    ]);
  });

  it('does not flag an event ending exactly at midnight as continuing', () => {
    const cols = layoutTimedDays([ev('eod', '2026-03-02T20:00:00Z', '2026-03-02T22:00:00Z')], DAYS, colOf, TZ);
    expect(cols[0]![0]).toMatchObject({ endMin: 1440, continuesEnd: false });
  });

  it('packs overlapping events side by side and skips all-day and out-of-window ones', () => {
    const cols = layoutTimedDays(
      [
        ev('a', '2026-03-04T08:00:00Z', '2026-03-04T10:00:00Z'),
        ev('b', '2026-03-04T09:00:00Z', '2026-03-04T11:00:00Z'),
        ev('allday', '2026-03-04T00:00:00Z', '2026-03-05T00:00:00Z', true),
        ev('later', '2026-03-20T09:00:00Z', '2026-03-20T10:00:00Z'),
      ],
      DAYS, colOf, TZ,
    );
    expect(cols[2]!.map((b) => [b.ev.uid, b.lane, b.laneCount, b.indent])).toEqual([['a', 0, 2, 0], ['b', 1, 2, 0]]);
    expect(cols.flat()).toHaveLength(2);
  });
});

describe('layoutAllDay', () => {
  const metrics = { fontEmPx: 13, dayW: 1000 };

  it('spans the UTC days covered and clamps to the window', () => {
    const { rows } = layoutAllDay(
      [
        ev('trip', '2026-03-03T00:00:00Z', '2026-03-06T00:00:00Z', true),
        ev('before', '2026-02-27T00:00:00Z', '2026-03-03T00:00:00Z', true),
      ],
      DAYS, utcColOf, metrics,
    );
    const byUid = Object.fromEntries(rows.map((r) => [r.ev.uid, r]));
    expect(byUid.trip).toMatchObject({ from: 1, span: 3 });
    expect(byUid.before).toMatchObject({ from: 0, span: 1 });
  });

  it('pushes the next bar down a lane when a long title needs the room', () => {
    const narrow = { fontEmPx: 13, dayW: 40 };
    const { rows, laneCount } = layoutAllDay(
      [
        ev('long', '2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z', true, 'A rather long all-day title'),
        ev('next', '2026-03-03T00:00:00Z', '2026-03-04T00:00:00Z', true),
      ],
      DAYS, utcColOf, narrow,
    );
    expect(laneCount).toBe(2);
    expect(rows.find((r) => r.ev.uid === 'next')!.lane).toBe(1);
  });

  it('floats single days above longer bars, longest at the bottom', () => {
    const { rows, laneCount } = layoutAllDay(
      [
        ev('week', '2026-03-02T00:00:00Z', '2026-03-09T00:00:00Z', true),
        ev('trip', '2026-03-03T00:00:00Z', '2026-03-06T00:00:00Z', true),
        ev('tue', '2026-03-03T00:00:00Z', '2026-03-04T00:00:00Z', true),
        ev('sat', '2026-03-07T00:00:00Z', '2026-03-08T00:00:00Z', true),
      ],
      DAYS, utcColOf, { fontEmPx: 13, dayW: 1000 },
    );
    const lane = Object.fromEntries(rows.map((r) => [r.ev.uid, r.lane]));
    expect(lane).toEqual({ tue: 0, sat: 0, trip: 1, week: 2 });
    expect(laneCount).toBe(3);
  });

  it('lets a longer bar rise into a lane free over its days', () => {
    const { rows } = layoutAllDay(
      [
        ev('mon', '2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z', true),
        ev('trip', '2026-03-04T00:00:00Z', '2026-03-07T00:00:00Z', true),
      ],
      DAYS, utcColOf, { fontEmPx: 13, dayW: 1000 },
    );
    expect(rows.find((r) => r.ev.uid === 'trip')!.lane).toBe(0);
  });
});

describe('all-day overflow and clipping', () => {
  const row = (uid: string, from: number, span: number, lane: number): AllDayRow =>
    ({ ev: ev(uid, '2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z', true), from, span, lane });

  it('shows a crowded-out bar on the days it has to itself, and counts the rest', () => {
    // b spans days 1–3 in the shared lane; c also needs day 2.
    const rows = [row('a', 0, 2, 0), row('b', 1, 3, 2), row('c', 2, 1, 3)];
    const { shown, chips } = capAllDay(rows, DAYS, 3);
    expect(chips).toEqual([{ col: 2, n: 2 }]);
    expect(shown.map((r) => [r.ev.uid, r.from, r.span, r.lane, !!r.cutStart, !!r.cutEnd])).toEqual([
      ['a', 0, 2, 0, false, false], ['b', 1, 1, 2, false, true], ['b', 3, 1, 2, true, false],
    ]);
  });

  it('clips a title only when the next day in its lane is taken', () => {
    const a = row('a', 0, 2, 0);
    const b = row('b', 2, 1, 0);
    const c = row('c', 0, 1, 1);
    const clipped = allDayClipTest([a, b, c]);
    expect(clipped(a)).toBe(true);
    expect(clipped(b)).toBe(false);
    expect(clipped(c)).toBe(false);
  });
});

describe('week focus walk', () => {
  const cols = layoutTimedDays(
    [
      ev('mon-late', '2026-03-02T15:00:00Z', '2026-03-02T16:00:00Z'),
      ev('mon-early', '2026-03-02T07:00:00Z', '2026-03-02T08:00:00Z'),
      ev('thu', '2026-03-05T09:00:00Z', '2026-03-05T10:00:00Z'),
    ],
    DAYS, colOf, TZ,
  );

  it('orders a day by start time and finds a focused uid', () => {
    expect(dayFocusItems(cols[0]).map((i) => i.uid)).toEqual(['mon-early', 'mon-late']);
    expect(locateFocusedUid(cols, 'mon-late')).toEqual({ col: 0, idx: 1 });
    expect(locateFocusedUid(cols, 'missing')).toBeNull();
    expect(locateFocusedUid(cols, null)).toBeNull();
  });

  it('keeps a multi-day event focused on the day it was focused on', () => {
    const multi = layoutTimedDays([ev('trip', '2026-03-02T18:00:00Z', '2026-03-04T08:00:00Z')], DAYS, colOf, TZ);
    expect(locateFocusedUid(multi, 'trip')).toEqual({ col: 0, idx: 0 });
    expect(locateFocusedUid(multi, 'trip', 1)).toEqual({ col: 1, idx: 0 });
    expect(locateFocusedUid(multi, 'trip', 5)).toEqual({ col: 0, idx: 0 });
  });

  it('skips empty days in either direction', () => {
    expect(nearestDayWithEvents(cols, 1, 1)).toBe(3);
    expect(nearestDayWithEvents(cols, 2, -1)).toBe(0);
    expect(nearestDayWithEvents(cols, 4, 1)).toBe(-1);
  });
});

describe('createDragSpan', () => {
  it('covers the pressed slot to the pointer, either way', () => {
    expect(createDragSpan(9 * 60 + 7, 9 * 60 + 8, 15)).toEqual({ startMin: 540, endMin: 555 });
    expect(createDragSpan(9 * 60 + 7, 10 * 60 + 20, 15)).toEqual({ startMin: 540, endMin: 615 });
    expect(createDragSpan(9 * 60 + 7, 8 * 60 + 10, 15)).toEqual({ startMin: 495, endMin: 555 });
  });
  it('stays within the day', () => {
    expect(createDragSpan(1439, 1500, 15)).toEqual({ startMin: 1425, endMin: 1440 });
    expect(createDragSpan(10, -40, 15)).toEqual({ startMin: 0, endMin: 15 });
  });
});
