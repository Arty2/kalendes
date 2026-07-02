import { describe, it, expect } from 'vitest';
import { parseIcs } from './ics-core';

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
