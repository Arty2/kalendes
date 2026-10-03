import { describe, it, expect } from 'vitest';
import { parseQuickAdd, quickTitle, hasQuickFields, type QuickKind } from './quick-add';

const TODAY = Date.UTC(2026, 9, 3); // Saturday
const ALL = new Set<QuickKind>(['date', 'time', 'location']);
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));

describe('parseQuickAdd', () => {
  it('splits a typed line into title, date, time range and location', () => {
    const q = parseQuickAdd('Lunch w/ Ana fri 13-14 @Taverna Plaka', TODAY, 'dmy');
    expect(iso(q.date)).toBe('2026-10-09');
    expect(q.start).toEqual({ h: 13, m: 0 });
    expect(q.end).toEqual({ h: 14, m: 0 });
    expect(q.location).toBe('Taverna Plaka');
    expect(quickTitle(q, ALL)).toBe('Lunch w/ Ana');
  });

  it('reads a start with a duration', () => {
    const q = parseQuickAdd('Call Bob tomorrow at 3pm for 30m', TODAY, 'dmy');
    expect(iso(q.date)).toBe('2026-10-04');
    expect(q.start).toEqual({ h: 15, m: 0 });
    expect(q.end).toBeNull();
    expect(q.minutes).toBe(30);
    expect(quickTitle(q, ALL)).toBe('Call Bob');
  });

  it('takes date and time words out of the location', () => {
    const q = parseQuickAdd('Dinner @ Cafe Nikos 9 oct 20:00', TODAY, 'dmy');
    expect(q.location).toBe('Cafe Nikos');
    expect(iso(q.date)).toBe('2026-10-09');
    expect(q.start).toEqual({ h: 20, m: 0 });
    expect(quickTitle(q, ALL)).toBe('Dinner');
  });

  it('leaves plain titles alone', () => {
    const q = parseQuickAdd('Dentist checkup', TODAY, 'dmy');
    expect(hasQuickFields(q)).toBe(false);
    expect(quickTitle(q, ALL)).toBe('Dentist checkup');
  });

  it('keeps the words of a field the user set by hand', () => {
    const q = parseQuickAdd('Standup mon 9:30', TODAY, 'dmy');
    expect(quickTitle(q, new Set<QuickKind>(['time']))).toBe('Standup mon');
  });

  it('never strips a title down to nothing', () => {
    const q = parseQuickAdd('tomorrow', TODAY, 'dmy');
    expect(iso(q.date)).toBe('2026-10-04');
    expect(quickTitle(q, ALL)).toBe('tomorrow');
  });

  it('ignores a duration with no start time', () => {
    const q = parseQuickAdd('Run for 30m', TODAY, 'dmy');
    expect(q.minutes).toBeNull();
    expect(quickTitle(q, ALL)).toBe('Run for 30m');
  });
});
