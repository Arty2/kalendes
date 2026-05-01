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

export function ticksBetween(from: Date, to: Date, granularity: Granularity): Date[] {
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
      const dow = cursor.getUTCDay() || 7;
      cursor = addDays(cursor, 1 - dow);
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

export type Tier = 'year' | 'quarter' | 'month' | 'week' | 'day';

export const HEADER_TIERS: Record<Zoom, [Tier, Tier, Tier]> = {
  month: ['year', 'month', 'day'],
  quarter: ['year', 'month', 'week'],
  'half-year': ['year', 'quarter', 'month'],
  year: ['year', 'quarter', 'month'],
};

export function tierToGranularity(tier: Tier): Granularity {
  return tier;
}

export function formatTier(d: Date, tier: Tier): string {
  switch (tier) {
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
