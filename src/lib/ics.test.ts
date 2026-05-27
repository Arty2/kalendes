import { describe, it, expect } from 'vitest';
import { parseIcs } from './ics-core';
import { feedIdFor } from './ics';
import { durationDays } from './format';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:newyear@test
SUMMARY:New Year's Day
DESCRIPTION:First day of the year.\\nTraditionally celebrated worldwide.
DTSTART;VALUE=DATE:20240101
DTEND;VALUE=DATE:20240102
RRULE:FREQ=YEARLY;COUNT=5
END:VEVENT
BEGIN:VEVENT
UID:meeting@test
SUMMARY:Project sync
DESCRIPTION:Weekly status meeting
LOCATION:Athens
DTSTART:20260415T100000Z
DTEND:20260415T110000Z
END:VEVENT
END:VCALENDAR
`;

describe('parseIcs', () => {
  it('expands RRULE into yearly occurrences within range', () => {
    const events = parseIcs(ICS, 'demo', new Date('2024-01-01T00:00:00Z'), new Date('2027-12-15T00:00:00Z'));
    const newYears = events.filter((e) => e.title.includes('New Year'));
    expect(newYears.length).toBe(4);
    expect(newYears.map((e) => e.start.getUTCFullYear()).sort()).toEqual([2024, 2025, 2026, 2027]);
  });

  it('marks date-only events as all-day and timed events as not', () => {
    const events = parseIcs(ICS, 'demo', new Date('2024-01-01T00:00:00Z'), new Date('2027-12-15T00:00:00Z'));
    const newYear = events.find((e) => e.title.includes('New Year'));
    const meeting = events.find((e) => e.title.includes('Project sync'));
    expect(newYear?.allDay).toBe(true);
    expect(meeting?.allDay).toBe(false);
  });

  it('extracts the first non-empty description line as snippet', () => {
    const events = parseIcs(ICS, 'demo', new Date('2024-01-01T00:00:00Z'), new Date('2027-12-15T00:00:00Z'));
    const newYear = events.find((e) => e.title.includes('New Year'));
    expect(newYear?.descriptionSnippet).toBe('First day of the year.');
  });

  it('preserves location on events', () => {
    const events = parseIcs(ICS, 'demo', new Date('2024-01-01T00:00:00Z'), new Date('2027-12-15T00:00:00Z'));
    const meeting = events.find((e) => e.title.includes('Project sync'));
    expect(meeting?.location).toBe('Athens');
  });

  it('returns events sorted by start time', () => {
    const events = parseIcs(ICS, 'demo', new Date('2024-01-01T00:00:00Z'), new Date('2027-12-15T00:00:00Z'));
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.start.getTime()).toBeGreaterThanOrEqual(events[i - 1]!.start.getTime());
    }
  });
});

function christmasIcs(body: string): string {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:xmas@test
SUMMARY:Christmas Day
${body}
END:VEVENT
END:VCALENDAR
`;
}

describe('Christmas single-day all-day event', () => {
  const range = [new Date('2026-06-01T00:00:00Z'), new Date('2027-01-15T00:00:00Z')] as const;

  it('canonical DTSTART/DTEND VALUE=DATE (next-day exclusive) → 1 day', () => {
    const events = parseIcs(
      christmasIcs('DTSTART;VALUE=DATE:20261225\nDTEND;VALUE=DATE:20261226'),
      'feed',
      range[0],
      range[1],
    );
    expect(events.length).toBe(1);
    const ev = events[0]!;
    expect(ev.allDay).toBe(true);
    expect(durationDays(ev.start, ev.end)).toBe(1);
  });

  it('DTSTART only (no DTEND) → parser fallback yields 1 day', () => {
    const events = parseIcs(
      christmasIcs('DTSTART;VALUE=DATE:20261225'),
      'feed',
      range[0],
      range[1],
    );
    expect(events.length).toBe(1);
    const ev = events[0]!;
    expect(ev.allDay).toBe(true);
    expect(durationDays(ev.start, ev.end)).toBe(1);
  });

  it('DTSTART + DURATION:P1D → 1 day', () => {
    const events = parseIcs(
      christmasIcs('DTSTART;VALUE=DATE:20261225\nDURATION:P1D'),
      'feed',
      range[0],
      range[1],
    );
    expect(events.length).toBe(1);
    const ev = events[0]!;
    expect(durationDays(ev.start, ev.end)).toBe(1);
  });

  it('recurring yearly Christmas via RRULE → each occurrence 1 day', () => {
    const events = parseIcs(
      christmasIcs(
        'DTSTART;VALUE=DATE:20201225\nDTEND;VALUE=DATE:20201226\nRRULE:FREQ=YEARLY;COUNT=10',
      ),
      'feed',
      range[0],
      range[1],
    );
    expect(events.length).toBe(1);
    const ev = events[0]!;
    expect(ev.start.getUTCFullYear()).toBe(2026);
    expect(durationDays(ev.start, ev.end)).toBe(1);
  });
});

describe("Greek Holidays Mother's Day (real Google VEVENT bytes)", () => {
  // Exact VEVENT shape returned by Google's `en.greek` holidays feed for
  // Mother's Day 2025. Single-day, all-day, exclusive DTEND. Regression guard
  // against re-introducing an off-by-one in the parser/format chain.
  const ICS = `BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Holidays in Greece
X-WR-TIMEZONE:UTC
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250511
DTEND;VALUE=DATE:20250512
DTSTAMP:20260507T050411Z
UID:20250511_hl0fhke7535uknuu39hlvkigjc@google.com
CLASS:PUBLIC
CREATED:20240522T190116Z
DESCRIPTION:Observance\\nTo hide observances\\, go to Google Calendar Settings > Holidays in Greece
LAST-MODIFIED:20240522T190116Z
SEQUENCE:0
STATUS:CONFIRMED
SUMMARY:Mother's Day
TRANSP:TRANSPARENT
END:VEVENT
END:VCALENDAR
`;

  it('parses to exactly 24h duration and renders as a single date', () => {
    const events = parseIcs(
      ICS,
      'feed',
      new Date('2025-01-01T00:00:00Z'),
      new Date('2026-12-15T00:00:00Z'),
    );
    expect(events.length).toBe(1);
    const ev = events[0]!;
    expect(ev.allDay).toBe(true);
    expect(ev.start.toISOString()).toBe('2025-05-11T00:00:00.000Z');
    expect(ev.end.toISOString()).toBe('2025-05-12T00:00:00.000Z');
    expect(ev.end.getTime() - ev.start.getTime()).toBe(86_400_000);
    expect(durationDays(ev.start, ev.end)).toBe(1);
  });
});

describe('feedIdFor', () => {
  it('produces stable ids per source kind', () => {
    expect(feedIdFor({ kind: 'secret', id: 'work' })).toBe('secret:work');
    const a = feedIdFor({ kind: 'user', url: 'https://example.com/cal.ics' });
    const b = feedIdFor({ kind: 'user', url: 'https://example.com/cal.ics' });
    expect(a).toBe(b);
    expect(a.startsWith('user:')).toBe(true);
  });
});
