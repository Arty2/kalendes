import { describe, it, expect } from 'vitest';
import { extractRawVevent, parseIcs } from './ics-core';

describe('recurrence expansion iteration cap', () => {
  it('expands a years-old daily series across the full window', () => {
    // DTSTART ~2.5 years before the window: reaching the window alone costs
    // ~900 iterations, so with the old fixed cap of 1000 the series vanished
    // partway into the visible range.
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:standup@test
SUMMARY:Daily standup
DTSTART:20230103T090000Z
DTEND:20230103T091500Z
RRULE:FREQ=DAILY
END:VEVENT
END:VCALENDAR
`;
    const rangeStart = new Date('2025-07-01T00:00:00Z');
    const rangeEnd = new Date('2027-07-01T00:00:00Z');
    const events = parseIcs(ics, 'feed', rangeStart, rangeEnd);

    expect(events[0]!.start.toISOString()).toBe('2025-07-01T09:00:00.000Z');
    expect(events.at(-1)!.start.toISOString()).toBe('2027-06-30T09:00:00.000Z');
    // One occurrence per day of the two-year window.
    expect(events).toHaveLength(730);
  });
});

describe('expired recurring series are skipped', () => {
  const rangeStart = new Date('2025-07-01T00:00:00Z');
  const rangeEnd = new Date('2027-07-01T00:00:00Z');

  it('drops a series whose RRULE UNTIL is before the window, keeping other events', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:expired@test
SUMMARY:Old weekly
DTSTART:20200106T090000Z
DTEND:20200106T093000Z
RRULE:FREQ=WEEKLY;UNTIL=20240101T000000Z
END:VEVENT
BEGIN:VEVENT
UID:live@test
SUMMARY:In window
DTSTART:20260101T090000Z
DTEND:20260101T093000Z
END:VEVENT
END:VCALENDAR
`;
    const events = parseIcs(ics, 'feed', rangeStart, rangeEnd);
    expect(events.some((e) => e.title === 'Old weekly')).toBe(false);
    expect(events.some((e) => e.title === 'In window')).toBe(true);
  });

  it('keeps a series whose RRULE UNTIL falls within the window', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:active@test
SUMMARY:Active weekly
DTSTART:20250701T090000Z
DTEND:20250701T093000Z
RRULE:FREQ=WEEKLY;UNTIL=20250801T000000Z
END:VEVENT
END:VCALENDAR
`;
    const events = parseIcs(ics, 'feed', rangeStart, rangeEnd);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.title === 'Active weekly')).toBe(true);
  });

  it('keeps an open-ended (no UNTIL) series that predates the window', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:forever@test
SUMMARY:Forever weekly
DTSTART:20200106T090000Z
DTEND:20200106T093000Z
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR
`;
    const events = parseIcs(ics, 'feed', rangeStart, rangeEnd);
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('extractRawVevent', () => {
  const SERIES_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:weekly@test
SUMMARY:Weekly sync
DTSTART:20260401T100000Z
DTEND:20260401T110000Z
RRULE:FREQ=WEEKLY;COUNT=4
END:VEVENT
BEGIN:VEVENT
UID:weekly@test
RECURRENCE-ID:20260408T100000Z
SUMMARY:Weekly sync (moved)
DTSTART:20260408T140000Z
DTEND:20260408T150000Z
END:VEVENT
BEGIN:VEVENT
UID:lunch@test
SUMMARY:Lunch
DTSTART:20260402T120000Z
DTEND:20260402T130000Z
END:VEVENT
END:VCALENDAR
`;

  it('returns the single matching VEVENT block for a plain event', () => {
    const block = extractRawVevent(SERIES_ICS, 'lunch@test:' + Date.UTC(2026, 3, 2, 12));
    expect(block).toContain('SUMMARY:Lunch');
    expect(block).not.toContain('SUMMARY:Weekly sync');
  });

  it('returns the series master for a regular occurrence', () => {
    const block = extractRawVevent(SERIES_ICS, 'weekly@test:' + Date.UTC(2026, 3, 15, 10));
    expect(block).toContain('RRULE:FREQ=WEEKLY');
    expect(block).not.toContain('RECURRENCE-ID');
  });

  it('returns the override block for an overridden occurrence', () => {
    const block = extractRawVevent(SERIES_ICS, 'weekly@test:' + Date.UTC(2026, 3, 8, 14));
    expect(block).toContain('SUMMARY:Weekly sync (moved)');
    expect(block).toContain('RECURRENCE-ID');
  });

  it('matches a folded UID property and returns null for unknown uids', () => {
    const folded = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:very-long-
 uid@test
SUMMARY:Folded
DTSTART:20260501T090000Z
END:VEVENT
END:VCALENDAR
`;
    const block = extractRawVevent(folded, 'very-long-uid@test:' + Date.UTC(2026, 4, 1, 9));
    expect(block).toContain('SUMMARY:Folded');
    expect(extractRawVevent(folded, 'missing@test:0')).toBeNull();
  });
});
