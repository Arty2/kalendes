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

describe('STATUS / TRANSP', () => {
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:a@test
SUMMARY:Called off
STATUS:CANCELLED
DTSTART:20260501T100000Z
DTEND:20260501T110000Z
END:VEVENT
BEGIN:VEVENT
UID:b@test
SUMMARY:Focus time
TRANSP:TRANSPARENT
DTSTART:20260502T100000Z
DTEND:20260502T110000Z
END:VEVENT
BEGIN:VEVENT
UID:c@test
SUMMARY:Plain
STATUS:CONFIRMED
TRANSP:OPAQUE
DTSTART:20260503T100000Z
DTEND:20260503T110000Z
END:VEVENT
BEGIN:VEVENT
UID:d@test
SUMMARY:Weekly
DTSTART:20260504T100000Z
DTEND:20260504T110000Z
RRULE:FREQ=WEEKLY;COUNT=2
END:VEVENT
BEGIN:VEVENT
UID:d@test
RECURRENCE-ID:20260511T100000Z
SUMMARY:Weekly
STATUS:CANCELLED
DTSTART:20260511T100000Z
DTEND:20260511T110000Z
END:VEVENT
END:VCALENDAR
`;
  const events = parseIcs(ics, 'feed', new Date('2026-04-01T00:00:00Z'), new Date('2026-06-01T00:00:00Z'));
  const byTitle = (t: string) => events.filter((e) => e.title === t);

  it('flags cancelled events only; show-as-free (TRANSP) is not read', () => {
    expect(byTitle('Called off')[0]).toMatchObject({ cancelled: true });
    expect(byTitle('Focus time')[0]!.cancelled).toBeUndefined();
    expect(byTitle('Focus time')[0]).not.toHaveProperty('free');
    expect(byTitle('Plain')[0]!.cancelled).toBeUndefined();
  });

  it('reads the flag per occurrence of a recurring series', () => {
    const weekly = byTitle('Weekly').sort((a, b) => a.start.getTime() - b.start.getTime());
    expect(weekly).toHaveLength(2);
    expect(weekly[0]!.cancelled).toBeUndefined();
    expect(weekly[1]!.cancelled).toBe(true);
  });
});
