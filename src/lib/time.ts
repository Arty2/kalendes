import type { Zoom } from './types';

export const MS_PER_DAY = 86_400_000;

export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function startOfQuarter(d: Date): Date {
  const m = d.getUTCMonth();
  const q = Math.floor(m / 3) * 3;
  return new Date(Date.UTC(d.getUTCFullYear(), q, 1));
}

export function startOfYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

// Overlap of two INCLUSIVE UTC-midnight day spans, or null when they don't
// touch. `days` counts both ends in, like markerRange() and durationDays — used
// to clip the tray's week headings to the temp marker's span.
export function intersectDaySpan(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): { startMs: number; endMs: number; days: number } | null {
  const startMs = Math.max(aStartMs, bStartMs);
  const endMs = Math.min(aEndMs, bEndMs);
  if (startMs > endMs) return null;
  return { startMs, endMs, days: Math.round((endMs - startMs) / MS_PER_DAY) + 1 };
}

export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}

export function addYears(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()));
}

export function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
}

export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

export type WeekStartOpt = 'monday' | 'sunday';

export function ticksBetween(
  from: Date,
  to: Date,
  granularity: Granularity,
  weekStart: WeekStartOpt = 'monday',
): Date[] {
  const ticks: Date[] = [];
  let cursor: Date;
  switch (granularity) {
    case 'day':
      cursor = startOfDay(from);
      while (cursor <= to) {
        ticks.push(cursor);
        cursor = addDays(cursor, 1);
      }
      return ticks;
    case 'week': {
      cursor = startOfDay(from);
      if (weekStart === 'sunday') {
        cursor = addDays(cursor, -cursor.getUTCDay());
      } else {
        const dow = cursor.getUTCDay() || 7;
        cursor = addDays(cursor, 1 - dow);
      }
      while (cursor <= to) {
        if (cursor >= from) ticks.push(cursor);
        cursor = addDays(cursor, 7);
      }
      return ticks;
    }
    case 'month':
      cursor = startOfMonth(from);
      while (cursor <= to) {
        ticks.push(cursor);
        cursor = addMonths(cursor, 1);
      }
      return ticks;
    case 'quarter':
      cursor = startOfQuarter(from);
      while (cursor <= to) {
        ticks.push(cursor);
        cursor = addMonths(cursor, 3);
      }
      return ticks;
    case 'year':
      cursor = startOfYear(from);
      while (cursor <= to) {
        ticks.push(cursor);
        cursor = addYears(cursor, 1);
      }
      return ticks;
  }
}

export type Tier = 'quarter-year' | 'year' | 'quarter' | 'month' | 'week' | 'day';

export const HEADER_TIERS: Record<Zoom, Tier[]> = {
  // The 1W week view replaces the whole timeline with its own grid (WeekGrid),
  // so TimeHeader never renders in that mode; this entry only satisfies the
  // exhaustive Record<Zoom, …> type.
  week: ['day'],
  month: ['quarter-year', 'month'],
  quarter: ['quarter-year', 'month', 'week'],
  'half-year': ['quarter-year', 'month', 'week'],
  year: ['year', 'quarter', 'month'],
  '2-year': ['year', 'quarter', 'month'],
};

// The unit the bare ←/→ keys step the day marker by, per zoom: a day in 1W, a
// week in 1M, a month in 3M/6M, a quarter in 1Y/2Y.
export const MARKER_STEP: Record<Zoom, Granularity> = {
  week: 'day',
  month: 'week',
  quarter: 'month',
  'half-year': 'month',
  year: 'quarter',
  '2-year': 'quarter',
};

function unitStart(d: Date, unit: Granularity, weekStart: WeekStartOpt): Date {
  switch (unit) {
    case 'day':
      return startOfDay(d);
    case 'week': {
      const day = startOfDay(d);
      const back = weekStart === 'sunday' ? day.getUTCDay() : (day.getUTCDay() || 7) - 1;
      return addDays(day, -back);
    }
    case 'month':
      return startOfMonth(d);
    case 'quarter':
      return startOfQuarter(d);
    case 'year':
      return startOfYear(d);
  }
}

function addUnits(d: Date, unit: Granularity, n: number): Date {
  switch (unit) {
    case 'day':
      return addDays(d, n);
    case 'week':
      return addDays(d, 7 * n);
    case 'month':
      return addMonths(d, n);
    case 'quarter':
      return addMonths(d, 3 * n);
    case 'year':
      return addYears(d, n);
  }
}

/**
 * The nearest unit boundary strictly after (dir 1) or before (dir -1) a day,
 * as a UTC midnight: from a mid-month day, back is that month's 1st and
 * forward the next month's; from a 1st, a whole month either way.
 */
export function stepToBoundary(dayMs: number, unit: Granularity, dir: -1 | 1, weekStart: WeekStartOpt = 'monday'): number {
  const day = startOfDay(new Date(dayMs));
  const start = unitStart(day, unit, weekStart);
  if (dir > 0) return addUnits(start, unit, 1).getTime();
  return start.getTime() < day.getTime() ? start.getTime() : addUnits(start, unit, -1).getTime();
}

// Which zoom a double tap on a header band drills into, or null where it
// doesn't: a week (3M/6M week numbers, 1M's week numbers in the month lane) or
// a 1M day opens 1W; a month from 3M up opens 1M.
export function drillZoom(from: Zoom, tier: Tier | 'day-letters'): Zoom | null {
  if (tier === 'week' && (from === 'month' || from === 'quarter' || from === 'half-year')) return 'week';
  if (tier === 'day-letters' && from === 'month') return 'week';
  if (tier === 'month' && from !== 'month' && from !== 'week') return 'month';
  return null;
}

export function tierToGranularity(tier: Tier): Granularity {
  return tier === 'quarter-year' ? 'quarter' : tier;
}

export function formatTier(d: Date, tier: Tier): string {
  switch (tier) {
    case 'quarter-year':
      return 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1) + ' ' + d.getUTCFullYear();
    case 'year':
      return String(d.getUTCFullYear());
    case 'quarter':
      return 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
    case 'month':
      return d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    case 'week':
      return 'W' + isoWeekNumber(d);
    case 'day':
      return String(d.getUTCDate());
  }
}
