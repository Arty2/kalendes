import {
  layoutTimedDays,
  layoutAllDay,
  allDayOverflowChips,
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
    expect(cols[2]!.map((b) => [b.ev.uid, b.lane, b.laneCount])).toEqual([['a', 0, 2], ['b', 1, 2]]);
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
});

describe('all-day overflow and clipping', () => {
  const row = (uid: string, from: number, span: number, lane: number): AllDayRow =>
    ({ ev: ev(uid, '2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z', true), from, span, lane });

  it('counts bars from the chip lane down, per day', () => {
    const rows = [row('a', 0, 2, 0), row('b', 1, 2, 2), row('c', 2, 1, 3)];
    expect(allDayOverflowChips(rows, DAYS, 3)).toEqual([{ col: 1, n: 1 }, { col: 2, n: 2 }]);
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

  it('skips empty days in either direction', () => {
    expect(nearestDayWithEvents(cols, 1, 1)).toBe(3);
    expect(nearestDayWithEvents(cols, 2, -1)).toBe(0);
    expect(nearestDayWithEvents(cols, 4, 1)).toBe(-1);
  });
});
