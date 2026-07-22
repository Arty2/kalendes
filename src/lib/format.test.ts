import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatMonth,
  formatDayInitial,
  formatRange,
  formatTime,
  formatNextRelative,
  formatTzDiff,
  tzOffsetMinutesVsDisplay,
  offsetMinutes,
  isDaylight,
  dayLimitMinutes,
  isWeekend,
  durationDays,
  parseFormattedDate,
  zonedParts,
  zonedDayKey,
  orderedGutterZones,
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

  it('labels one instant on the hour in both week-view zones (Athens / US)', () => {
    // The week header relies on a single UTC-hour tick reading as a round local
    // hour in every whole-hour zone simultaneously. In summer Athens is UTC+3
    // and New York UTC-4, so 12:00Z is 15:00 / 08:00 — both on the hour.
    const noonUtc = new Date('2026-07-15T12:00:00Z');
    expect(formatTime(noonUtc, '24h', 'Europe/Athens')).toBe('15:00');
    expect(formatTime(noonUtc, '24h', 'America/New_York')).toBe('08:00');
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

describe('offsetMinutes DST override', () => {
  const jul1 = new Date('2026-07-01T12:00:00Z');
  const jan1 = new Date('2026-01-01T12:00:00Z');

  it("auto follows the zone's real offset", () => {
    expect(offsetMinutes('Europe/Athens', jul1, 'auto')).toBe(180); // UTC+3 summer
    expect(offsetMinutes('Europe/Athens', jan1, 'auto')).toBe(120); // UTC+2 winter
  });

  it("'off' forces each zone's standard offset regardless of date", () => {
    expect(offsetMinutes('Europe/Athens', jul1, 'off')).toBe(120); // UTC+2
    expect(offsetMinutes('America/New_York', jul1, 'off')).toBe(-300); // UTC-5
  });

  it("'on' forces each zone's daylight offset, incl. southern-hemisphere flip", () => {
    expect(offsetMinutes('Europe/Athens', jan1, 'on')).toBe(180); // UTC+3
    expect(offsetMinutes('Australia/Sydney', jul1, 'on')).toBe(660); // UTC+11 (their summer)
  });

  it('is a no-op for zones without DST', () => {
    expect(offsetMinutes('Asia/Tokyo', jul1, 'on')).toBe(540);
    expect(offsetMinutes('Asia/Tokyo', jul1, 'off')).toBe(540);
    expect(offsetMinutes('Asia/Taipei', jan1, 'on')).toBe(480);
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
  it('flips to day at the default 08:30 UTC', () => {
    expect(isDaylight('UTC', new Date('2026-05-08T08:29:00Z'))).toBe(false);
    expect(isDaylight('UTC', new Date('2026-05-08T08:30:00Z'))).toBe(true);
  });

  it('flips to night at the default 20:30 UTC', () => {
    expect(isDaylight('UTC', new Date('2026-05-08T20:29:00Z'))).toBe(true);
    expect(isDaylight('UTC', new Date('2026-05-08T20:30:00Z'))).toBe(false);
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

describe('formatNextRelative', () => {
  // Anchor "now" at local noon so hour offsets stay within the same calendar
  // day regardless of the test runner's timezone.
  const now = new Date(2026, 5, 6, 12, 0, 0);
  const nowMs = now.getTime();
  const at = (ms: number) => formatNextRelative(new Date(nowMs + ms), nowMs);

  it('shows minutes under an hour', () => {
    expect(at(35 * 60_000)).toBe('IN 35 MIN');
  });
  it('floors imminent events to at least 1 min', () => {
    expect(at(10_000)).toBe('IN 1 MIN');
  });
  it('shows hours within the soon window', () => {
    expect(at(5 * 3_600_000)).toBe('IN 5H');
  });
  it('shows TODAY later the same day', () => {
    expect(at(10 * 3_600_000)).toBe('TODAY');
  });
  it('shows TOMORROW for the next calendar day', () => {
    expect(at(24 * 3_600_000)).toBe('TOMORROW');
  });
  it('shows IN N DAYS further out', () => {
    expect(at(4 * 24 * 3_600_000)).toBe('IN 4 DAYS');
  });
});

describe('zonedParts / zonedDayKey', () => {
  it('reads calendar parts and minutes-since-midnight in a zone (summer)', () => {
    const noonUtc = new Date('2026-07-15T12:00:00Z');
    // Athens is UTC+3 in summer → 15:00 on the 15th.
    expect(zonedParts(noonUtc, 'Europe/Athens')).toMatchObject({
      y: 2026, m: 7, d: 15, minutes: 15 * 60,
    });
    // New York is UTC-4 in summer → 08:00 on the 15th.
    expect(zonedParts(noonUtc, 'America/New_York')).toMatchObject({
      y: 2026, m: 7, d: 15, minutes: 8 * 60,
    });
  });

  it('tracks DST: the same wall instant shifts across the offset change', () => {
    // Winter: Athens UTC+2, New York UTC-5 (one hour less than summer above).
    const noonWinter = new Date('2026-01-15T12:00:00Z');
    expect(zonedParts(noonWinter, 'Europe/Athens').minutes).toBe(14 * 60);
    expect(zonedParts(noonWinter, 'America/New_York').minutes).toBe(7 * 60);
  });

  it('rolls the day key into the next calendar day past local midnight', () => {
    // 23:30Z is 02:30 the next day in Athens but still 19:30 the same day in NY.
    const lateUtc = new Date('2026-07-15T23:30:00Z');
    expect(zonedDayKey(lateUtc, 'Europe/Athens')).toBe('2026-7-16');
    expect(zonedDayKey(lateUtc, 'America/New_York')).toBe('2026-7-15');
    expect(zonedParts(lateUtc, 'Europe/Athens').minutes).toBe(2 * 60 + 30);
  });

  it('normalises local midnight to minutes 0 (not 1440)', () => {
    // 21:00Z = 00:00 on the 16th in Athens (UTC+3 in summer).
    const p = zonedParts(new Date('2026-07-15T21:00:00Z'), 'Europe/Athens');
    expect(p.minutes).toBe(0);
    expect(p.d).toBe(16);
  });
});

describe('orderedGutterZones', () => {
  it('lists Current, #1, #2 when all differ (three columns)', () => {
    expect(orderedGutterZones('Europe/London', 'Europe/Athens', 'America/New_York')).toEqual([
      'Europe/London',
      'Europe/Athens',
      'America/New_York',
    ]);
  });

  it('floats Current to the left and drops the matching reference (two columns)', () => {
    // Current == #2 → [Current(NY), #1(Athens)]
    expect(orderedGutterZones('America/New_York', 'Europe/Athens', 'America/New_York')).toEqual([
      'America/New_York',
      'Europe/Athens',
    ]);
    // Current == #1 → [Current(Athens), #2(NY)]
    expect(orderedGutterZones('Europe/Athens', 'Europe/Athens', 'America/New_York')).toEqual([
      'Europe/Athens',
      'America/New_York',
    ]);
  });

  it('collapses duplicate reference zones', () => {
    expect(orderedGutterZones('Europe/London', 'Europe/Athens', 'Europe/Athens')).toEqual([
      'Europe/London',
      'Europe/Athens',
    ]);
    expect(orderedGutterZones('Europe/Athens', 'Europe/Athens', 'Europe/Athens')).toEqual([
      'Europe/Athens',
    ]);
  });
});
