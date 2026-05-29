import { describe, it, expect } from 'vitest';
import {
  dateToPx,
  msToPx,
  pxToDate,
  assignLanes,
  rangeForToday,
  PX_PER_DAY,
  MIN_PILL_PX,
  MIN_PX_PER_DAY,
  MONTHS_IN_VIEWPORT,
  computePxPerDay,
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
