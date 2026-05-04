import { describe, it, expect } from 'vitest';
import { dateToPx, pxToDate, assignLanes, rangeForToday, PX_PER_DAY, MIN_PILL_PX } from './layout';
import type { DisplayEvent } from './types';

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
});

describe('rangeForToday', () => {
  const today = new Date(Date.UTC(2026, 4, 4));

  it('uses default 24/36 month bounds when none given', () => {
    const { start, end } = rangeForToday(today);
    expect(start.getUTCFullYear()).toBe(2024);
    expect(start.getUTCMonth()).toBe(4);
    expect(end.getUTCFullYear()).toBe(2029);
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
