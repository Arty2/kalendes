import { describe, it, expect } from 'vitest';
import {
  dateToPx,
  msToPx,
  pxToDate,
  assignLanes,
  rangeForToday,
  PX_PER_DAY,
  MIN_PILL_PX,
  MIN_VISUAL_PILL_PX,
  SAME_LANE_GAP_PX,
  MIN_PX_PER_DAY,
  MONTHS_IN_VIEWPORT,
  computePxPerDay,
  packLanes,
} from './layout';
import type { DisplayEvent, Zoom } from './types';

const epoch = new Date('2026-01-01T00:00:00Z');

function ev(uid: string, startIso: string, endIso: string): DisplayEvent {
  return {
    uid,
    feedId: 'f',
    title: uid,
    description: '',
    descriptionSnippet: '',
    location: '',
    start: new Date(startIso),
    end: new Date(endIso),
    allDay: false,
    displayTitle: uid,
    displayDescription: '',
    displayDescriptionSnippet: '',
    displayLocation: '',
    styleVariant: 'none',
    hidden: false,
    ruleCategory: null,
    ruleColor: null,
    ruleBlock: null,
  };
}

describe('dateToPx / pxToDate', () => {
  it('are inverses across all zoom levels', () => {
    const target = new Date('2026-07-15T00:00:00Z');
    for (const z of Object.keys(PX_PER_DAY) as (keyof typeof PX_PER_DAY)[]) {
      const px = dateToPx(target, epoch, PX_PER_DAY[z]);
      const back = pxToDate(px, epoch, PX_PER_DAY[z]);
      expect(back.getTime()).toBeCloseTo(target.getTime(), -2);
    }
  });

  it('produces zero at the epoch', () => {
    expect(dateToPx(epoch, epoch, 40)).toBe(0);
  });

  it('msToPx matches dateToPx for the same instant', () => {
    const target = new Date('2026-07-15T00:00:00Z');
    for (const z of Object.keys(PX_PER_DAY) as (keyof typeof PX_PER_DAY)[]) {
      expect(msToPx(target.getTime(), epoch, PX_PER_DAY[z])).toBe(
        dateToPx(target, epoch, PX_PER_DAY[z]),
      );
    }
  });
});

describe('assignLanes', () => {
  it('returns empty for empty input', () => {
    expect(assignLanes([], 40, epoch)).toEqual({ laneEvents: [], laneCount: 0 });
  });

  it('places non-overlapping events on lane 0', () => {
    const a = ev('a', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z');
    const b = ev('b', '2026-03-01T00:00:00Z', '2026-03-05T00:00:00Z');
    const { laneEvents, laneCount } = assignLanes([a, b], 40, epoch, 0);
    expect(laneCount).toBe(1);
    expect(laneEvents.every((e) => e.lane === 0)).toBe(true);
  });

  it('stacks overlapping events on separate lanes', () => {
    const a = ev('a', '2026-01-01T00:00:00Z', '2026-01-10T00:00:00Z');
    const b = ev('b', '2026-01-05T00:00:00Z', '2026-01-15T00:00:00Z');
    const { laneCount } = assignLanes([a, b], 40, epoch, 0);
    expect(laneCount).toBe(2);
  });

  it('min pill width can force overlap at small pxPerDay', () => {
    const a = ev('a', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    const b = ev('b', '2026-01-03T00:00:00Z', '2026-01-04T00:00:00Z');
    const { laneCount } = assignLanes([a, b], 1, epoch, MIN_PILL_PX);
    expect(laneCount).toBe(2);
  });

  it('renders pill width without applying min pill floor', () => {
    const a = ev('a', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    const { laneEvents } = assignLanes([a], 40, epoch);
    expect(laneEvents[0]!.widthPx).toBe(40);
  });

  it('reserves label width so long titles push a near neighbour to a new lane', () => {
    // Two events 8 days apart at ~13 px/day: 8 * 13 = 104px start gap, above the
    // 80px collision floor, so with short titles they share a lane.
    const short = () => {
      const a = { ...ev('a', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'), displayTitle: 'Hi' };
      const b = { ...ev('b', '2026-01-09T00:00:00Z', '2026-01-10T00:00:00Z'), displayTitle: 'Yo' };
      return assignLanes([a, b], 13, epoch, MIN_PILL_PX, false, 12).laneCount;
    };
    // Same geometry but a long title on the first event: its estimated label
    // width (> 200px) exceeds the 104px gap, forcing the second onto lane 1.
    const long = () => {
      const a = {
        ...ev('a', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
        displayTitle: 'Onassis AiR — Eva Papamargariti Rehearsal',
      };
      const b = { ...ev('b', '2026-01-09T00:00:00Z', '2026-01-10T00:00:00Z'), displayTitle: 'Yo' };
      return assignLanes([a, b], 13, epoch, MIN_PILL_PX, false, 12).laneCount;
    };
    expect(short()).toBe(1);
    expect(long()).toBe(2);
  });

  it('label-width reservation is off by default (fontEmPx = 0)', () => {
    const a = {
      ...ev('a', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
      displayTitle: 'A very long title that would otherwise reserve lots of width',
    };
    const b = { ...ev('b', '2026-01-09T00:00:00Z', '2026-01-10T00:00:00Z'), displayTitle: 'Yo' };
    expect(assignLanes([a, b], 13, epoch, MIN_PILL_PX).laneCount).toBe(1);
  });

  it('renders an iCal 2-day all-day event at exactly 2 * pxPerDay', () => {
    // DTSTART:20260115, DTEND:20260117 (exclusive) => pill width spans Jan 15-16
    const e = {
      ...ev('multiday', '2026-01-15T00:00:00Z', '2026-01-17T00:00:00Z'),
      allDay: true,
    };
    const { laneEvents } = assignLanes([e], 40, epoch);
    expect(laneEvents[0]!.widthPx).toBe(80);
  });
});

describe('assignLanes — fractional collision floor and same-lane clip', () => {
  // pxPerDay = 40 puts timed events on the fractional path (>= 30).
  const px = 40;

  it('stacks near-adjacent short meetings instead of overlapping their boxes', () => {
    // 15 min apart: the rendered 8px-min boxes would collide, so the collision
    // floor (MIN_VISUAL_PILL_PX + SAME_LANE_GAP_PX) forces a second lane.
    const a = ev('a', '2026-01-15T10:00:00Z', '2026-01-15T10:15:00Z');
    const b = ev('b', '2026-01-15T10:30:00Z', '2026-01-15T10:45:00Z');
    expect(assignLanes([a, b], px, epoch, 0).laneCount).toBe(2);
  });

  it('clips a day-wide rendered pill at its same-lane successor', () => {
    // 9h apart (15px at 40 px/day): far enough to share a lane, but each pill
    // renders a whole day wide (durationDays floors to 1), so the first must be
    // clipped at the second's left edge.
    const a = ev('a', '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z');
    const b = ev('b', '2026-01-15T18:00:00Z', '2026-01-15T18:30:00Z');
    const { laneEvents, laneCount } = assignLanes([a, b], px, epoch, 0);
    expect(laneCount).toBe(1);
    const [first, second] = [...laneEvents].sort((x, y) => x.leftPx - y.leftPx);
    expect(first!.leftPx + first!.widthPx).toBeLessThanOrEqual(second!.leftPx);
    expect(first!.widthPx).toBe(second!.leftPx - first!.leftPx - SAME_LANE_GAP_PX);
    expect(first!.widthPx).toBeGreaterThanOrEqual(MIN_VISUAL_PILL_PX);
  });

  it('keeps a lone timed event day-wide and without labelRoomPx', () => {
    const a = ev('a', '2026-01-15T10:00:00Z', '2026-01-15T11:00:00Z');
    const { laneEvents } = assignLanes([a], px, epoch, 0);
    expect(laneEvents[0]!.widthPx).toBe(px);
    expect(laneEvents[0]!.labelRoomPx).toBeUndefined();
  });

  it('still does not reserve label width on the fractional path — sets labelRoomPx instead', () => {
    const a = {
      ...ev('a', '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z'),
      displayTitle: 'A very long meeting title that would reserve lots of width',
    };
    const b = ev('b', '2026-01-15T18:00:00Z', '2026-01-15T18:30:00Z');
    const { laneEvents, laneCount } = assignLanes([a, b], px, epoch, 0, false, 12);
    expect(laneCount).toBe(1);
    const [first, second] = [...laneEvents].sort((x, y) => x.leftPx - y.leftPx);
    expect(first!.labelRoomPx).toBe(second!.leftPx - first!.leftPx);
    expect(second!.labelRoomPx).toBeUndefined();
  });

  it('clips a past pill against a future same-lane pill in nowMs mode', () => {
    // Past events are placed after future ones, so the clip pass must order by
    // leftPx rather than insertion order.
    const nowMs = new Date('2026-01-15T12:00:00Z').getTime();
    const past = ev('past', '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z');
    const future = ev('future', '2026-01-15T18:00:00Z', '2026-01-15T18:30:00Z');
    const { laneEvents, laneCount } = assignLanes(
      [past, future], px, epoch, 0, false, 0, nowMs,
    );
    expect(laneCount).toBe(1);
    const p = laneEvents.find((e) => e.uid === 'past')!;
    const f = laneEvents.find((e) => e.uid === 'future')!;
    expect(p.leftPx + p.widthPx).toBeLessThanOrEqual(f.leftPx);
    expect(p.labelRoomPx).toBe(f.leftPx - p.leftPx);
  });

  it('clips an evening pill so it no longer bleeds into the next day', () => {
    const evening = ev('evening', '2026-01-15T18:00:00Z', '2026-01-15T19:00:00Z');
    const nextDay = {
      ...ev('nextday', '2026-01-16T00:00:00Z', '2026-01-17T00:00:00Z'),
      allDay: true,
    };
    const { laneEvents, laneCount } = assignLanes([evening, nextDay], px, epoch, 0);
    expect(laneCount).toBe(1);
    const e = laneEvents.find((x) => x.uid === 'evening')!;
    const n = laneEvents.find((x) => x.uid === 'nextday')!;
    expect(e.leftPx + e.widthPx).toBeLessThanOrEqual(n.leftPx);
  });

  it('keeps the non-fractional path unchanged just below the fractional threshold', () => {
    // Same two meetings 9h apart: at 29 px/day (non-fractional) they snap to the
    // same day start and must stack; at 30 px/day (fractional) they share a lane.
    const mk = () => [
      ev('a', '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z'),
      ev('b', '2026-01-15T18:00:00Z', '2026-01-15T18:30:00Z'),
    ];
    expect(assignLanes(mk(), 29, epoch, 0).laneCount).toBe(2);
    expect(assignLanes(mk(), 30, epoch, 0).laneCount).toBe(1);
  });
});

describe('assignLanes — hidden-style pills are ghosts', () => {
  const laneOf = (laneEvents: { uid: string; lane: number }[], uid: string) =>
    laneEvents.find((e) => e.uid === uid)!.lane;
  const ghost = (uid: string, startIso: string, endIso: string) => ({
    ...ev(uid, startIso, endIso),
    styleVariant: 'hidden' as const,
  });

  it('shares a lane with an overlapping real event', () => {
    const real = ev('real', '2026-01-05T00:00:00Z', '2026-01-10T00:00:00Z');
    const g = ghost('g', '2026-01-07T00:00:00Z', '2026-01-12T00:00:00Z');
    const { laneEvents, laneCount } = assignLanes([real, g], 40, epoch, 0);
    expect(laneCount).toBe(1);
    expect(laneOf(laneEvents, 'real')).toBe(0);
    expect(laneOf(laneEvents, 'g')).toBe(0);
  });

  it('does not block a later overlapping real event', () => {
    const g = ghost('g', '2026-01-05T00:00:00Z', '2026-01-12T00:00:00Z');
    const real = ev('real', '2026-01-07T00:00:00Z', '2026-01-10T00:00:00Z');
    const { laneEvents, laneCount } = assignLanes([g, real], 40, epoch, 0);
    expect(laneCount).toBe(1);
    expect(laneOf(laneEvents, 'real')).toBe(0);
  });

  it('two overlapping ghosts share lane 0', () => {
    const g1 = ghost('g1', '2026-01-05T00:00:00Z', '2026-01-10T00:00:00Z');
    const g2 = ghost('g2', '2026-01-07T00:00:00Z', '2026-01-12T00:00:00Z');
    const { laneEvents, laneCount } = assignLanes([g1, g2], 40, epoch, 0);
    expect(laneCount).toBe(1);
    expect(laneEvents.every((e) => e.lane === 0)).toBe(true);
  });

  it('past ghost overlapping a future real pill stays on one lane (nowMs)', () => {
    const nowMs = new Date('2026-01-08T00:00:00Z').getTime();
    const g = ghost('g', '2026-01-05T00:00:00Z', '2026-01-07T00:00:00Z');
    const real = ev('real', '2026-01-06T00:00:00Z', '2026-01-10T00:00:00Z');
    const { laneEvents, laneCount } = assignLanes([g, real], 40, epoch, 0, false, 0, nowMs);
    expect(laneCount).toBe(1);
    expect(laneEvents.every((e) => e.lane === 0)).toBe(true);
  });

  it('does not clip a real pill or set its labelRoomPx', () => {
    // Timed events at 40 px/day: the ghost follows the real pill in lane 0 but
    // must not shrink it or bound its label.
    const real = ev('real', '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z');
    const g = ghost('g', '2026-01-15T18:00:00Z', '2026-01-15T18:30:00Z');
    const { laneEvents } = assignLanes([real, g], 40, epoch, 0);
    const r = laneEvents.find((e) => e.uid === 'real')!;
    expect(r.widthPx).toBe(40); // day-wide render kept, not clipped at the ghost
    expect(r.labelRoomPx).toBeUndefined();
  });
});

describe('assignLanes — same-title lane affinity', () => {
  const laneOf = (laneEvents: { uid: string; lane: number }[], uid: string) =>
    laneEvents.find((e) => e.uid === uid)!.lane;
  const sync = (uid: string, startIso: string, endIso: string) => ({
    ...ev(uid, startIso, endIso),
    displayTitle: 'Weekly Sync',
  });

  it('groups same-title events onto the lane the title was first placed on', () => {
    // The blocker pushes the first Sync to lane 1; the later Sync would land on
    // the free lane 0 under plain first-fit but follows its title to lane 1.
    const blocker = ev('blocker', '2026-01-05T00:00:00Z', '2026-01-08T00:00:00Z');
    const s1 = sync('s1', '2026-01-06T00:00:00Z', '2026-01-07T00:00:00Z');
    const s2 = sync('s2', '2026-01-20T00:00:00Z', '2026-01-21T00:00:00Z');
    const { laneEvents, laneCount } = assignLanes([blocker, s1, s2], 40, epoch, 0);
    expect(laneCount).toBe(2);
    expect(laneOf(laneEvents, 's1')).toBe(1);
    expect(laneOf(laneEvents, 's2')).toBe(1);
  });

  it('falls back to first-fit for a blocked instance, then returns to the remembered lane', () => {
    const s1 = sync('s1', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'); // lane 0
    const blocker = ev('blocker', '2026-01-03T00:00:00Z', '2026-01-10T00:00:00Z'); // lane 0
    const s2 = sync('s2', '2026-01-04T00:00:00Z', '2026-01-05T00:00:00Z'); // lane 0 blocked → 1
    const s3 = sync('s3', '2026-01-20T00:00:00Z', '2026-01-21T00:00:00Z'); // back to lane 0
    const { laneEvents } = assignLanes([s1, blocker, s2, s3], 40, epoch, 0);
    expect(laneOf(laneEvents, 's1')).toBe(0);
    expect(laneOf(laneEvents, 's2')).toBe(1);
    expect(laneOf(laneEvents, 's3')).toBe(0);
  });

  it('lines past instances up under the lane future instances claimed (nowMs)', () => {
    // Future events place first: the competitor takes lane 0, the future Sync
    // lane 1. The past Sync would reuse lane 0 under compact packing but joins
    // its title's lane instead.
    const nowMs = new Date('2026-02-01T00:00:00Z').getTime();
    const competitor = ev('x', '2026-03-01T00:00:00Z', '2026-03-10T00:00:00Z');
    const sFuture = sync('sf', '2026-03-05T00:00:00Z', '2026-03-12T00:00:00Z');
    const sPast = sync('sp', '2026-01-05T00:00:00Z', '2026-01-06T00:00:00Z');
    const { laneEvents, laneCount } = assignLanes(
      [competitor, sFuture, sPast], 40, epoch, 0, false, 0, nowMs,
    );
    expect(laneCount).toBe(2);
    expect(laneOf(laneEvents, 'sf')).toBe(1);
    expect(laneOf(laneEvents, 'sp')).toBe(1);
  });
});

describe('assignLanes — current/future on top, past below (nowMs)', () => {
  const nowMs = new Date('2026-02-01T00:00:00Z').getTime();
  const laneOf = (laneEvents: { uid: string; lane: number }[], uid: string) =>
    laneEvents.find((e) => e.uid === uid)!.lane;

  it('keeps rows compact: a non-overlapping past + future share the top lane', () => {
    const past = ev('past', '2026-01-05T00:00:00Z', '2026-01-06T00:00:00Z');
    const future = ev('future', '2026-03-01T00:00:00Z', '2026-03-05T00:00:00Z');
    const { laneEvents, laneCount } = assignLanes(
      [past, future], 40, epoch, 0, false, 0, nowMs,
    );
    expect(laneCount).toBe(1);
    expect(laneEvents.every((e) => e.lane === 0)).toBe(true);
  });

  it('puts the current/future pill on top when it collides with a past pill', () => {
    // At 1 px/day the 80px min-pill footprints of adjacent-day pills overlap, so
    // the two must stack — the future one should take the top lane.
    const past = ev('past', '2026-01-30T00:00:00Z', '2026-01-31T00:00:00Z'); // ends before now
    const future = ev('future', '2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z'); // starts at now
    const { laneEvents, laneCount } = assignLanes(
      [past, future], 1, epoch, MIN_PILL_PX, false, 0, nowMs,
    );
    expect(laneCount).toBe(2);
    expect(laneOf(laneEvents, 'future')).toBe(0);
    expect(laneOf(laneEvents, 'past')).toBe(1);
  });

  it('keeps non-overlapping future events on the top lane', () => {
    const a = ev('a', '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z');
    const b = ev('b', '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z');
    const { laneEvents, laneCount } = assignLanes([a, b], 40, epoch, 0, false, 0, nowMs);
    expect(laneCount).toBe(1);
    expect(laneEvents.every((e) => e.lane === 0)).toBe(true);
  });

  it('fills from lane 0 when every event is past', () => {
    const a = ev('a', '2026-01-05T00:00:00Z', '2026-01-06T00:00:00Z');
    const b = ev('b', '2026-01-20T00:00:00Z', '2026-01-21T00:00:00Z');
    const { laneEvents, laneCount } = assignLanes([a, b], 40, epoch, 0, false, 0, nowMs);
    expect(laneCount).toBe(1);
    expect(laneEvents.every((e) => e.lane === 0)).toBe(true);
  });

  it('does not inflate height: past events reuse lanes that future events left free', () => {
    // Two overlapping future events (Mar) need 2 lanes; two overlapping past
    // events (Jan) also need 2 — but since past ⟂ future in time they reuse the
    // same 2 lanes rather than stacking to 4.
    const f1 = ev('f1', '2026-03-01T00:00:00Z', '2026-03-10T00:00:00Z');
    const f2 = ev('f2', '2026-03-05T00:00:00Z', '2026-03-15T00:00:00Z'); // overlaps f1
    const p1 = ev('p1', '2026-01-01T00:00:00Z', '2026-01-10T00:00:00Z');
    const p2 = ev('p2', '2026-01-05T00:00:00Z', '2026-01-15T00:00:00Z'); // overlaps p1
    const { laneCount } = assignLanes([f1, f2, p1, p2], 40, epoch, 0, false, 0, nowMs);
    expect(laneCount).toBe(2);
  });

  it('without nowMs, past and future share the top lane as before', () => {
    const past = ev('past', '2026-01-05T00:00:00Z', '2026-01-06T00:00:00Z');
    const future = ev('future', '2026-03-01T00:00:00Z', '2026-03-05T00:00:00Z');
    const { laneCount } = assignLanes([past, future], 40, epoch, 0);
    expect(laneCount).toBe(1);
  });
});

describe('rangeForToday', () => {
  const today = new Date(Date.UTC(2026, 4, 4));

  it('uses default 12/24 month bounds when none given', () => {
    const { start, end } = rangeForToday(today);
    expect(start.getUTCFullYear()).toBe(2025);
    expect(start.getUTCMonth()).toBe(4);
    expect(end.getUTCFullYear()).toBe(2028);
    expect(end.getUTCMonth()).toBe(4);
  });

  it('honors custom bounds', () => {
    const { start, end } = rangeForToday(today, { pastMonths: 6, futureMonths: 6 });
    expect(start.getUTCFullYear()).toBe(2025);
    expect(start.getUTCMonth()).toBe(10);
    expect(end.getUTCFullYear()).toBe(2026);
    expect(end.getUTCMonth()).toBe(10);
  });

  it('clamps to zero past or future months', () => {
    const { start, end } = rangeForToday(today, { pastMonths: 0, futureMonths: 0 });
    expect(start.getTime()).toBe(today.getTime());
    expect(end.getTime()).toBe(today.getTime());
  });
});

describe('computePxPerDay', () => {
  it('fits the promised month span across the viewport', () => {
    // 1200 px wide / (3 months * 30.437 days) ≈ 13.13 px/day for quarter zoom
    const px = computePxPerDay('quarter', 1200);
    expect(px).toBeGreaterThan(13);
    expect(px).toBeLessThan(13.5);
  });

  it('clamps to MIN_PX_PER_DAY on narrow viewports for the widest zoom', () => {
    expect(computePxPerDay('2-year', 400)).toBe(MIN_PX_PER_DAY);
  });

  it('fits a full year across a narrow portrait phone without flooring', () => {
    // 390 px / 365.25 days ≈ 1.07 px/day — below MIN_PX_PER_DAY, but year must
    // fit the whole span so all 12 months are visible at once.
    const px = computePxPerDay('year', 390);
    expect(px).toBeLessThan(MIN_PX_PER_DAY);
    expect(px * 365.25).toBeCloseTo(390, 5);
  });

  it('fits two years across a landscape-width viewport without flooring', () => {
    // 844 px / 730.5 days ≈ 1.16 px/day — below MIN_PX_PER_DAY, but a viewport
    // wider than the portrait breakpoint should fit the whole 2-year span.
    const px = computePxPerDay('2-year', 844);
    expect(px).toBeLessThan(MIN_PX_PER_DAY);
    expect(px * 730.5).toBeCloseTo(844, 5);
  });

  it('keeps 2-year floored (scrollable) on a narrow portrait phone', () => {
    expect(computePxPerDay('2-year', 390)).toBe(MIN_PX_PER_DAY);
  });

  it('lets month zoom shrink with the viewport — no zoom-specific floor', () => {
    // 320 px wide / 30.437 days ≈ 10.5 px/day. Month zoom adds a 2px
    // breathing-room bonus on top so day cells stay legible — landing
    // around 12.5 px/day. The viewport floor (MIN_PX_PER_DAY) must not
    // kick in.
    const px = computePxPerDay('month', 320);
    expect(px).toBeGreaterThan(12);
    expect(px).toBeLessThan(13);
  });

  it('produces monotonically decreasing px/day for wider zoom spans', () => {
    const zooms: Zoom[] = ['month', 'quarter', 'half-year', 'year', '2-year'];
    const widths = zooms.map((z) => computePxPerDay(z, 1920));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeLessThanOrEqual(widths[i - 1]!);
    }
  });

  it('falls back to the static PX_PER_DAY map when viewport width is zero', () => {
    for (const z of Object.keys(MONTHS_IN_VIEWPORT) as Zoom[]) {
      expect(computePxPerDay(z, 0)).toBe(PX_PER_DAY[z]);
    }
  });
});

describe('packLanes', () => {
  it('returns no lanes for an empty set', () => {
    expect(packLanes([])).toEqual({ packed: [], laneCount: 0 });
  });

  it('keeps non-overlapping intervals in a single lane', () => {
    const { packed, laneCount } = packLanes([
      { startMin: 540, endMin: 600 }, // 09:00–10:00
      { startMin: 600, endMin: 660 }, // 10:00–11:00 (back-to-back reuses the lane)
      { startMin: 720, endMin: 780 }, // 12:00–13:00
    ]);
    expect(laneCount).toBe(1);
    expect(packed.every((p) => p.lane === 0)).toBe(true);
  });

  it('splits overlapping intervals into side-by-side lanes', () => {
    const { packed, laneCount } = packLanes([
      { startMin: 540, endMin: 660 }, // 09:00–11:00
      { startMin: 570, endMin: 630 }, // 09:30–10:30 overlaps → lane 1
      { startMin: 600, endMin: 720 }, // 10:00–12:00 overlaps both → lane 2
    ]);
    expect(laneCount).toBe(3);
    expect(packed.map((p) => p.lane)).toEqual([0, 1, 2]);
  });

  it('reuses a freed lane once an earlier interval has ended', () => {
    const { packed, laneCount } = packLanes([
      { startMin: 0, endMin: 60 }, // 00:00–01:00 lane 0
      { startMin: 30, endMin: 90 }, // 00:30–01:30 overlaps → lane 1
      { startMin: 60, endMin: 120 }, // 01:00–02:00 lane 0 is free again
    ]);
    expect(laneCount).toBe(2);
    expect(packed.map((p) => p.lane)).toEqual([0, 1, 0]);
  });

  it('sorts by start (then end) before packing', () => {
    const { packed } = packLanes([
      { startMin: 120, endMin: 180 },
      { startMin: 0, endMin: 60 },
    ]);
    expect(packed.map((p) => p.item.startMin)).toEqual([0, 120]);
  });
});
