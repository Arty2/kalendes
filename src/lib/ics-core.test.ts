import { describe, it, expect } from 'vitest';
import ICAL from 'ical.js';
import IcalExpander from 'ical-expander';
import { expandBetween, extractRawVevent, parseIcs } from './ics-core';

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

describe('URL', () => {
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:a@test
SUMMARY:With page
URL:https://example.org/events/1
DTSTART;VALUE=DATE:20260501
DTEND;VALUE=DATE:20260504
END:VEVENT
BEGIN:VEVENT
UID:b@test
SUMMARY:Script link
URL:javascript:alert(1)
DTSTART:20260502T100000Z
DTEND:20260502T110000Z
END:VEVENT
BEGIN:VEVENT
UID:c@test
SUMMARY:No link
DTSTART:20260503T100000Z
DTEND:20260503T110000Z
END:VEVENT
END:VCALENDAR
`;
  const events = parseIcs(ics, 'feed', new Date('2026-04-01T00:00:00Z'), new Date('2026-06-01T00:00:00Z'));
  const url = (t: string) => events.find((e) => e.title === t)?.url;

  it('keeps an event page address, and only a web address', () => {
    expect(url('With page')).toBe('https://example.org/events/1');
    expect(url('Script link')).toBeUndefined();
    expect(url('No link')).toBeUndefined();
  });
});

describe('expandBetween matches ical-expander', () => {
  // The expansion replaced ical-expander's (quadratic) one; on what both
  // support it must return the same events and occurrences.
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN',
    'BEGIN:VEVENT', 'UID:daily', 'SUMMARY:Standup', 'DTSTART;TZID=Europe/Athens:20200106T093000',
    'DTEND;TZID=Europe/Athens:20200106T094500', 'RRULE:FREQ=DAILY', 'EXDATE;TZID=Europe/Athens:20260303T093000',
    'EXDATE;TZID=Europe/Athens:20260305T093000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:daily', 'SUMMARY:Standup (moved)', 'RECURRENCE-ID;TZID=Europe/Athens:20260304T093000',
    'DTSTART;TZID=Europe/Athens:20260304T120000', 'DTEND;TZID=Europe/Athens:20260304T121500', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:weekly', 'SUMMARY:Gym', 'DTSTART;VALUE=DATE:20260105', 'DTEND;VALUE=DATE:20260106',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20260430', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:one', 'SUMMARY:One-off', 'DTSTART:20260310T080000Z', 'DTEND:20260310T090000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:out', 'SUMMARY:Outside', 'DTSTART:20250110T080000Z', 'DTEND:20250110T090000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:run', 'SUMMARY:Exhibition', 'DTSTART;VALUE=DATE:20251201', 'DTEND;VALUE=DATE:20260401', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const after = new Date('2026-03-01T00:00:00Z');
  const before = new Date('2026-04-01T00:00:00Z');
  const key = (r: { events: ICAL.Event[]; occurrences: { startDate: ICAL.Time; endDate: ICAL.Time; item: ICAL.Event }[] }) => [
    ...r.events.map((e) => `E ${e.summary} ${e.startDate.toJSDate().toISOString()} ${e.endDate.toJSDate().toISOString()}`),
    ...r.occurrences.map((o) => `O ${o.item.summary} ${o.startDate.toJSDate().toISOString()} ${o.endDate.toJSDate().toISOString()}`),
  ].sort();

  it('gives the same events and occurrences', () => {
    const theirs = new IcalExpander({ ics, maxIterations: 5000 }).between(after, before);
    const ours = expandBetween(new ICAL.Component(ICAL.parse(ics) as never), after, before, 5000);
    expect(key(ours)).toEqual(key(theirs as never));
    expect(key(ours).some((k) => k.includes('Standup (moved)'))).toBe(true);
  });

  it('counts every date of a multi-date EXDATE', () => {
    const multi = ics.replace('EXDATE;TZID=Europe/Athens:20260303T093000', 'EXDATE;TZID=Europe/Athens:20260303T093000,20260306T093000');
    const ours = key(expandBetween(new ICAL.Component(ICAL.parse(multi) as never), after, before, 5000));
    expect(ours.filter((k) => k.startsWith('O Standup 2026-03-06'))).toEqual([]);
    expect(ours.filter((k) => k.startsWith('O Standup 2026-03-07'))).toHaveLength(1);
  });
});
