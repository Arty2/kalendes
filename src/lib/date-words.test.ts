import { describe, it, expect } from 'vitest';
import { matchDate, matchTime, matchDuration, parseDateQuery } from './date-words';

// Saturday 2026-10-03.
const TODAY = Date.UTC(2026, 9, 3);
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));
const date = (text: string, order: 'dmy' | 'mdy' = 'dmy', loose = false) => {
  const m = matchDate(text.toLowerCase().split(' '), 0, TODAY, order, loose);
  return m ? { day: iso(m.ms), length: m.length } : null;
};

describe('matchDate', () => {
  it('reads relative words and weekdays', () => {
    expect(date('today')).toEqual({ day: '2026-10-03', length: 1 });
    expect(date('tomorrow')).toEqual({ day: '2026-10-04', length: 1 });
    expect(date('sat')).toEqual({ day: '2026-10-03', length: 1 });
    expect(date('fri')).toEqual({ day: '2026-10-09', length: 1 });
    expect(date('monday')).toEqual({ day: '2026-10-05', length: 1 });
    expect(date('next fri')).toEqual({ day: '2026-10-16', length: 2 });
    expect(date('next week')).toEqual({ day: '2026-10-10', length: 2 });
  });

  it('reads numeric dates in the setting order, rolling past days to next year', () => {
    expect(date('2026-10-09')).toEqual({ day: '2026-10-09', length: 1 });
    expect(date('9/10')).toEqual({ day: '2026-10-09', length: 1 });
    expect(date('10/9', 'mdy')).toEqual({ day: '2026-10-09', length: 1 });
    expect(date('1.2')).toEqual({ day: '2027-02-01', length: 1 });
    expect(date('9.10.27')).toEqual({ day: '2027-10-09', length: 1 });
    expect(date('31/2')).toBeNull();
    expect(date('9/13')).toBeNull();
  });

  it('reads month names and offsets', () => {
    expect(date('9 oct')).toEqual({ day: '2026-10-09', length: 2 });
    expect(date('oct 9th 2027')).toEqual({ day: '2027-10-09', length: 3 });
    expect(date('9 oct 2027,')).toEqual({ day: '2027-10-09', length: 3 });
    expect(date('march 15')).toEqual({ day: '2027-03-15', length: 2 });
    expect(date('+3d')).toEqual({ day: '2026-10-06', length: 1 });
    expect(date('-2w')).toEqual({ day: '2026-09-19', length: 1 });
    expect(date('+1m')).toEqual({ day: '2026-11-03', length: 1 });
    expect(date('in 2 weeks')).toEqual({ day: '2026-10-17', length: 3 });
  });

  it('keeps bare months and years for loose (whole-query) matching', () => {
    expect(date('march')).toBeNull();
    expect(date('march', 'dmy', true)).toEqual({ day: '2027-03-01', length: 1 });
    expect(date('2027-03', 'dmy', true)).toEqual({ day: '2027-03-01', length: 1 });
    expect(date('2027', 'dmy', true)).toEqual({ day: '2027-01-01', length: 1 });
    expect(date('may')).toBeNull();
  });
});

describe('parseDateQuery', () => {
  it('accepts a query that is only a date', () => {
    expect(iso(parseDateQuery(' 2027-03 ', TODAY, 'dmy'))).toBe('2027-03-01');
    expect(iso(parseDateQuery('Next Fri', TODAY, 'dmy'))).toBe('2026-10-16');
    expect(parseDateQuery('fri drinks', TODAY, 'dmy')).toBeNull();
    expect(parseDateQuery('dentist', TODAY, 'dmy')).toBeNull();
    expect(parseDateQuery('', TODAY, 'dmy')).toBeNull();
  });
});

describe('matchTime', () => {
  const time = (text: string) => {
    const m = matchTime(text.toLowerCase().split(' '), 0);
    if (!m) return null;
    const f = (c: { h: number; m: number }) => String(c.h).padStart(2, '0') + ':' + String(c.m).padStart(2, '0');
    return [f(m.start), m.end ? f(m.end) : null, m.length];
  };

  it('reads single times', () => {
    expect(time('13:00')).toEqual(['13:00', null, 1]);
    expect(time('1pm')).toEqual(['13:00', null, 1]);
    expect(time('12am')).toEqual(['00:00', null, 1]);
    expect(time('10:30am')).toEqual(['10:30', null, 1]);
    expect(time('at 3')).toEqual(['15:00', null, 2]);
    expect(time('at 9')).toEqual(['09:00', null, 2]);
    expect(time('at 3:00')).toEqual(['03:00', null, 2]);
    expect(time('noon')).toEqual(['12:00', null, 1]);
    expect(time('13')).toBeNull();
    expect(time('9.30')).toBeNull();
    expect(time('25:00')).toBeNull();
  });

  it('reads ranges', () => {
    expect(time('13-14')).toEqual(['13:00', '14:00', 1]);
    expect(time('9:30–11')).toEqual(['09:30', '11:00', 1]);
    expect(time('1-2pm')).toEqual(['13:00', '14:00', 1]);
    expect(time('11-1pm')).toEqual(['11:00', '13:00', 1]);
    expect(time('10am - 12pm')).toEqual(['10:00', '12:00', 3]);
    expect(time('14:00 to 15:30')).toEqual(['14:00', '15:30', 3]);
    expect(time('6-8')).toEqual(['18:00', '20:00', 1]);
    expect(time('9-5')).toEqual(['09:00', '17:00', 1]);
    expect(time('11-1')).toEqual(['11:00', '13:00', 1]);
    expect(time('10:30-2')).toEqual(['10:30', '14:00', 1]);
    expect(time('22:00-01:00')).toEqual(['22:00', '01:00', 1]);
  });
});

describe('matchDuration', () => {
  it('reads "for" lengths', () => {
    const d = (t: string) => matchDuration(t.split(' '), 0)?.minutes ?? null;
    expect(d('for 30m')).toBe(30);
    expect(d('for 2h')).toBe(120);
    expect(d('for 1h30')).toBe(90);
    expect(d('for 1.5h')).toBe(90);
    expect(d('for 90 min')).toBe(90);
    expect(d('for ana')).toBeNull();
  });
});
