import { describe, it, expect } from 'vitest';
import {
  isoWeekNumber,
  ticksBetween,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  HEADER_TIERS,
} from './time';

describe('isoWeekNumber', () => {
  it('returns W01 for 2024-01-01 (Monday)', () => {
    expect(isoWeekNumber(new Date('2024-01-01T00:00:00Z'))).toBe(1);
  });
  it('returns W01 for 2025-12-30 (week of W01 2026)', () => {
    expect(isoWeekNumber(new Date('2025-12-30T00:00:00Z'))).toBe(1);
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
});
