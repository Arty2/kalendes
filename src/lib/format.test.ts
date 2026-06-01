import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatMonth,
  formatDayInitial,
  formatRange,
  formatTime,
  formatTzDiff,
  tzOffsetMinutesVsDisplay,
  isDaylight,
  dayLimitMinutes,
  isWeekend,
  durationDays,
  parseFormattedDate,
} from './format';
import type { DateFormat } from './types';

const may1 = new Date('2026-05-01T00:00:00Z');
const may10 = new Date('2026-05-10T00:00:00Z');
const jul15 = new Date('2026-07-15T00:00:00Z');

describe('formatDate', () => {
  it('renders YYYY-MM-DD', () => {
    expect(formatDate(may1, 'YYYY-MM-DD', 'en')).toBe('2026-05-01');
  });
  it('renders DD MMM YYYY in English with uppercase month', () => {
    expect(formatDate(may1, 'DD MMM YYYY', 'en')).toBe('01 MAY 2026');
  });
  it('renders DD.MM.YYYY', () => {
    expect(formatDate(may1, 'DD.MM.YYYY', 'en')).toBe('01.05.2026');
  });
  it('renders MM/DD/YYYY', () => {
    expect(formatDate(may1, 'MM/DD/YYYY', 'en')).toBe('05/01/2026');
  });
  it('renders DD MMM YYYY in Greek without accents and uppercased', () => {
    expect(formatDate(may1, 'DD MMM YYYY', 'el')).toBe('01 ΜΑΙ 2026');
  });
});

describe('formatMonth', () => {
  it('returns short Greek month uppercase without accents', () => {
    expect(formatMonth(may1, 'el', 'short')).toBe('ΜΑΙ');
  });
  it('returns long English month', () => {
    expect(formatMonth(may1, 'en', 'long')).toBe('May');
  });
});

describe('formatDayInitial', () => {
  it('returns Greek "Π" for Friday', () => {
    expect(formatDayInitial(may1, 'el')).toBe('Π');
  });
  it('returns English "F" for Friday', () => {
    expect(formatDayInitial(may1, 'en')).toBe('F');
  });
});

describe('isWeekend', () => {
  it('is false for Friday', () => {
    expect(isWeekend(may1)).toBe(false);
  });
  it('is true for Saturday', () => {
    expect(isWeekend(new Date('2026-05-02T00:00:00Z'))).toBe(true);
  });
  it('is true for Sunday', () => {
    expect(isWeekend(new Date('2026-05-03T00:00:00Z'))).toBe(true);
  });
});

describe('durationDays', () => {
  it('counts inclusive days for an all-day range', () => {
    const start = new Date('2026-12-01T00:00:00Z');
    const end = new Date('2026-12-11T00:00:00Z');
    expect(durationDays(start, end)).toBe(10);
  });

  it('returns 1 for a same-day all-day event', () => {
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-02T00:00:00Z');
    expect(durationDays(start, end)).toBe(1);
  });

  it('treats iCal-spec exclusive DTEND as N-day duration', () => {
    // iCal: DTSTART:20260115, DTEND:20260117 => Jan 15 + Jan 16 = 2 days
    const start = new Date('2026-01-15T00:00:00Z');
    const end = new Date('2026-01-17T00:00:00Z');
    expect(durationDays(start, end)).toBe(2);
  });
});

describe('formatRange', () => {
  it('falls through to single date for a same-day range', () => {
    const start = new Date('2026-05-01T00:00:00Z');
    const end = new Date('2026-05-02T00:00:00Z');
    expect(formatRange(start, end, 'YYYY-MM-DD', 'en')).toBe('2026-05-01');
  });

  it('collapses same-month ISO range into YYYY-MM-DD–DD', () => {
    expect(formatRange(may1, may10, 'YYYY-MM-DD', 'en')).toBe('2026-05-01 — 09');
  });

  it('collapses same-month DD MMM YYYY range without repeating month/year', () => {
    expect(formatRange(may1, may10, 'DD MMM YYYY', 'en')).toBe('01 — 09 MAY 2026');
  });

  it('collapses same-year DD.MM.YYYY range with one trailing year', () => {
    expect(formatRange(may1, jul15, 'DD.MM.YYYY', 'en')).toBe('01.05 — 14.07.2026');
  });

  it('renders an iCal 2-day all-day event as Jan 15 — Jan 16, not Jan 17', () => {
    // DTSTART:20260115, DTEND:20260117 (exclusive) => last inclusive day is Jan 16
    const start = new Date('2026-01-15T00:00:00Z');
    const end = new Date('2026-01-17T00:00:00Z');
    expect(formatRange(start, end, 'YYYY-MM-DD', 'en')).toBe('2026-01-15 — 16');
  });
});

describe('formatTime', () => {
  it('renders 24h with leading zero', () => {
    const t = new Date('2026-05-04T08:30:00Z');
    expect(formatTime(t, '24h', 'UTC')).toBe('08:30');
  });

  it('renders 12h with AM/PM marker', () => {
    const t = new Date('2026-05-04T20:15:00Z');
    expect(formatTime(t, '12h', 'UTC')).toMatch(/^08:15 ?PM$/i);
  });
});

describe('formatTzDiff', () => {
  const may8noon = new Date('2026-05-08T12:00:00Z');

  it('shows signed integer hour diff between feed tz and current tz', () => {
    // New York is UTC-4 in May; Athens is UTC+3. NY − Athens = -7
    expect(formatTzDiff('America/New_York', 'Europe/Athens', may8noon)).toBe('−7');
  });

  it('returns empty string when offsets match', () => {
    expect(formatTzDiff('Europe/Athens', 'Europe/Athens', may8noon)).toBe('');
  });

  it('returns empty string when feed matches current UTC', () => {
    expect(formatTzDiff('UTC', 'UTC', may8noon)).toBe('');
  });

  it('renders half-hour zones with decimal', () => {
    // Kolkata UTC+5:30 minus Athens UTC+3 = +2.5
    expect(formatTzDiff('Asia/Kolkata', 'Europe/Athens', may8noon)).toBe('+2.5');
  });
});

describe('tzOffsetMinutesVsDisplay', () => {
  const may8noon = new Date('2026-05-08T12:00:00Z');

  it('is positive when the feed tz is ahead of the display tz', () => {
    // Athens UTC+3 vs UTC display => +180 minutes (segment bends right)
    expect(tzOffsetMinutesVsDisplay('Europe/Athens', 'UTC', may8noon)).toBe(180);
  });

  it('is negative when the feed tz is behind the display tz', () => {
    // New York UTC-4 vs Athens UTC+3 => -420 minutes (segment bends left)
    expect(tzOffsetMinutesVsDisplay('America/New_York', 'Europe/Athens', may8noon)).toBe(-420);
  });

  it('is zero when offsets match (segment stays straight)', () => {
    expect(tzOffsetMinutesVsDisplay('UTC', 'UTC', may8noon)).toBe(0);
  });

  it('handles half-hour zones', () => {
    // Kolkata UTC+5:30 vs UTC => +330 minutes
    expect(tzOffsetMinutesVsDisplay('Asia/Kolkata', 'UTC', may8noon)).toBe(330);
  });
});

describe('parseFormattedDate', () => {
  const target = new Date(Date.UTC(2026, 2, 15));
  const formats: DateFormat[] = ['YYYY-MM-DD', 'DD MMM YYYY', 'DD.MM.YYYY', 'MM/DD/YYYY'];

  for (const fmt of formats) {
    it(`round-trips with formatDate for ${fmt}`, () => {
      const rendered = formatDate(target, fmt, 'en');
      const parsed = parseFormattedDate(rendered, fmt, 'en');
      expect(parsed).toEqual({ y: 2026, m: 3, d: 15 });
    });
  }

  it('returns null for an empty string', () => {
    expect(parseFormattedDate('', 'YYYY-MM-DD')).toBeNull();
  });

  it('returns null for an out-of-range month', () => {
    expect(parseFormattedDate('2026-13-01', 'YYYY-MM-DD')).toBeNull();
  });

  it('returns null for an unknown month abbreviation', () => {
    expect(parseFormattedDate('15 ZZZ 2026', 'DD MMM YYYY', 'en')).toBeNull();
  });
});

describe('isDaylight', () => {
  it('flips to day at 08:00 UTC', () => {
    expect(isDaylight('UTC', new Date('2026-05-08T07:59:00Z'))).toBe(false);
    expect(isDaylight('UTC', new Date('2026-05-08T08:00:00Z'))).toBe(true);
  });

  it('flips to night at 20:00 UTC', () => {
    expect(isDaylight('UTC', new Date('2026-05-08T19:59:00Z'))).toBe(true);
    expect(isDaylight('UTC', new Date('2026-05-08T20:00:00Z'))).toBe(false);
  });

  it('respects minute-level boundaries', () => {
    const morning = 7 * 60 + 30; // 07:30
    const evening = 20 * 60 + 30; // 20:30
    expect(isDaylight('UTC', new Date('2026-05-08T07:29:00Z'), morning, evening)).toBe(false);
    expect(isDaylight('UTC', new Date('2026-05-08T07:30:00Z'), morning, evening)).toBe(true);
    expect(isDaylight('UTC', new Date('2026-05-08T20:29:00Z'), morning, evening)).toBe(true);
    expect(isDaylight('UTC', new Date('2026-05-08T20:30:00Z'), morning, evening)).toBe(false);
  });
});

describe('dayLimitMinutes', () => {
  it('parses HH:MM to minutes since midnight', () => {
    expect(dayLimitMinutes('07:30', 480)).toBe(450);
    expect(dayLimitMinutes('20:00', 1200)).toBe(1200);
  });

  it('falls back when empty or malformed', () => {
    expect(dayLimitMinutes('', 480)).toBe(480);
    expect(dayLimitMinutes('nope', 1200)).toBe(1200);
  });
});
