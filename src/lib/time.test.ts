import { describe, it, expect } from 'vitest';
import {
  stepToBoundary,
  MARKER_STEP,
  drillZoom,
  isoWeekNumber,
  ticksBetween,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  HEADER_TIERS,
  intersectDaySpan,
} from './time';

describe('isoWeekNumber', () => {
  it('returns W01 for 2024-01-01 (Monday)', () => {
    expect(isoWeekNumber(new Date('2024-01-01T00:00:00Z'))).toBe(1);
  });
  it('returns W01 for 2025-12-30 (week of W01 2026)', () => {
    expect(isoWeekNumber(new Date('2025-12-30T00:00:00Z'))).toBe(1);
  });
  // The temp-marker readout and the header week band both call isoWeekNumber
  // directly (no weekStart offset), so they must agree for ANY day of the week —
  // this is what previously regressed from mid-week (Fri/Sat/Sun) onward.
  it('is constant across every day of an ISO week (Mon 2026-07-13 … Sun 2026-07-19)', () => {
    const monday = Date.UTC(2026, 6, 13); // W29 2026
    const nums = Array.from({ length: 7 }, (_, i) =>
      isoWeekNumber(new Date(monday + i * 86_400_000)),
    );
    expect(nums).toEqual([29, 29, 29, 29, 29, 29, 29]);
  });
  it('gives the same week for a mid-week Friday/Saturday/Sunday as its Monday', () => {
    const monday = new Date('2026-07-13T00:00:00Z');
    for (const iso of ['2026-07-17', '2026-07-18', '2026-07-19']) {
      expect(isoWeekNumber(new Date(iso + 'T00:00:00Z'))).toBe(isoWeekNumber(monday));
    }
  });
});

describe('ticksBetween', () => {
  const from = new Date('2026-01-15T00:00:00Z');
  const to = new Date('2026-04-15T00:00:00Z');

  it('emits monthly ticks aligned to month start', () => {
    const ticks = ticksBetween(from, to, 'month');
    expect(ticks.length).toBe(4);
    expect(ticks[0]!.getTime()).toBe(startOfMonth(from).getTime());
  });

  it('emits a single quarter tick across one quarter', () => {
    const ticks = ticksBetween(from, to, 'quarter');
    expect(ticks.length).toBe(2);
    expect(ticks[0]!.getTime()).toBe(startOfQuarter(from).getTime());
  });

  it('emits a single year tick within one year', () => {
    const ticks = ticksBetween(from, to, 'year');
    expect(ticks.length).toBe(1);
    expect(ticks[0]!.getTime()).toBe(startOfYear(from).getTime());
  });

});

describe('intersectDaySpan', () => {
  // The tray clips each week heading to the temp marker's span. Weeks below are
  // Mon-started; the marker runs Wed 2026-08-05 → Sun 2026-08-16 inclusive.
  const markerStart = Date.UTC(2026, 7, 5);
  const markerEnd = Date.UTC(2026, 7, 16);
  const week = (day: number): [number, number] => [Date.UTC(2026, 7, day), Date.UTC(2026, 7, day + 6)];

  it('clips a week the marker opens inside', () => {
    const [ws, we] = week(3);
    expect(intersectDaySpan(ws, we, markerStart, markerEnd)).toEqual({
      startMs: Date.UTC(2026, 7, 5),
      endMs: Date.UTC(2026, 7, 9),
      days: 5,
    });
  });

  it('keeps a week that sits entirely inside the marker', () => {
    const [ws, we] = week(10);
    expect(intersectDaySpan(ws, we, markerStart, markerEnd)).toEqual({
      startMs: Date.UTC(2026, 7, 10),
      endMs: Date.UTC(2026, 7, 16),
      days: 7,
    });
  });

  it('clips a week the marker ends inside', () => {
    const [ws, we] = week(10);
    const shortEnd = Date.UTC(2026, 7, 12);
    expect(intersectDaySpan(ws, we, markerStart, shortEnd)).toEqual({
      startMs: Date.UTC(2026, 7, 10),
      endMs: shortEnd,
      days: 3,
    });
  });

  it('counts a single shared day as 1', () => {
    const [ws, we] = week(10);
    expect(intersectDaySpan(ws, we, Date.UTC(2026, 7, 16), Date.UTC(2026, 7, 20))?.days).toBe(1);
  });

  it('returns null when the spans do not touch', () => {
    const [ws, we] = week(17);
    expect(intersectDaySpan(ws, we, markerStart, markerEnd)).toBe(null);
  });

  it('is order-independent', () => {
    const [ws, we] = week(3);
    expect(intersectDaySpan(markerStart, markerEnd, ws, we)).toEqual(
      intersectDaySpan(ws, we, markerStart, markerEnd),
    );
  });
});

describe('HEADER_TIERS', () => {
  it('month zoom is quarter-year + month, omitting the week tier', () => {
    expect(HEADER_TIERS.month).toEqual(['quarter-year', 'month']);
  });

  it('quarter and half-year zooms carry quarter-year, month and week tiers', () => {
    for (const z of ['quarter', 'half-year'] as const) {
      expect(HEADER_TIERS[z]).toEqual(['quarter-year', 'month', 'week']);
    }
  });

  it('year and 2-year zooms keep the year, quarter, month tiers', () => {
    for (const z of ['year', '2-year'] as const) {
      expect(HEADER_TIERS[z]).toEqual(['year', 'quarter', 'month']);
    }
  });

  it('defines a (placeholder) entry for the week zoom (WeekGrid renders it)', () => {
    expect(HEADER_TIERS.week).toBeDefined();
  });
});

describe('stepToBoundary', () => {
  const d = (s: string): number => Date.parse(s + 'T00:00:00Z');
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

  it('steps a day either way', () => {
    expect(iso(stepToBoundary(d('2026-11-05'), 'day', 1))).toBe('2026-11-06');
    expect(iso(stepToBoundary(d('2026-11-05'), 'day', -1))).toBe('2026-11-04');
  });

  it('goes back to the start of the current week before the one before it', () => {
    // 2026-11-05 is a Thursday.
    expect(iso(stepToBoundary(d('2026-11-05'), 'week', -1))).toBe('2026-11-02');
    expect(iso(stepToBoundary(d('2026-11-02'), 'week', -1))).toBe('2026-10-26');
    expect(iso(stepToBoundary(d('2026-11-05'), 'week', 1))).toBe('2026-11-09');
  });

  it('follows the week start setting', () => {
    expect(iso(stepToBoundary(d('2026-11-05'), 'week', -1, 'sunday'))).toBe('2026-11-01');
    expect(iso(stepToBoundary(d('2026-11-01'), 'week', 1, 'sunday'))).toBe('2026-11-08');
  });

  it('steps months and quarters across year ends', () => {
    expect(iso(stepToBoundary(d('2026-12-15'), 'month', 1))).toBe('2027-01-01');
    expect(iso(stepToBoundary(d('2027-01-01'), 'month', -1))).toBe('2026-12-01');
    expect(iso(stepToBoundary(d('2026-11-05'), 'quarter', -1))).toBe('2026-10-01');
    expect(iso(stepToBoundary(d('2026-10-01'), 'quarter', -1))).toBe('2026-07-01');
    expect(iso(stepToBoundary(d('2026-11-05'), 'quarter', 1))).toBe('2027-01-01');
  });
});

describe('MARKER_STEP', () => {
  it('steps by a day in 1W, a week in 1M, a month in 3M/6M, a quarter in 1Y/2Y', () => {
    expect(MARKER_STEP).toEqual({
      week: 'day',
      month: 'week',
      quarter: 'month',
      'half-year': 'month',
      year: 'quarter',
      '2-year': 'quarter',
    });
  });
});

describe('drillZoom', () => {
  it('opens 1W from a week number in 1M/3M/6M and from a 1M day', () => {
    expect(drillZoom('month', 'week')).toBe('week');
    expect(drillZoom('quarter', 'week')).toBe('week');
    expect(drillZoom('half-year', 'week')).toBe('week');
    expect(drillZoom('month', 'day-letters')).toBe('week');
  });

  it('opens 1M from a month in 3M and up', () => {
    for (const z of ['quarter', 'half-year', 'year', '2-year'] as const) {
      expect(drillZoom(z, 'month')).toBe('month');
    }
  });

  it('leaves every other band alone', () => {
    expect(drillZoom('month', 'month')).toBeNull();
    expect(drillZoom('year', 'quarter')).toBeNull();
    expect(drillZoom('2-year', 'year')).toBeNull();
    expect(drillZoom('quarter', 'quarter-year')).toBeNull();
  });
});
