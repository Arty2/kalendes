import { parseIcsForLane } from './ics-lane';
import { eventsToIcs } from './scratchpad';
import { expandLaneEvents } from './recurrence';

const wrap = (body: string): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', body, 'END:VCALENDAR'].join('\r\n');

const range = [new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 11, 31))] as const;

describe('parseIcsForLane', () => {
  it('keeps a repeating event as one series, with its zone and skipped days', () => {
    const ics = wrap([
      'BEGIN:VEVENT', 'UID:standup', 'SUMMARY:Standup',
      'DTSTART;TZID=Europe/Athens:20260105T100000', 'DTEND;TZID=Europe/Athens:20260105T103000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE;TZID=Europe/Athens:20260107T100000',
      'END:VEVENT',
      'BEGIN:VEVENT', 'UID:once', 'SUMMARY:Once', 'DTSTART:20260301T090000Z', 'DTEND:20260301T100000Z', 'END:VEVENT',
    ].join('\r\n'));
    const lane = parseIcsForLane(ics, 'scratchpad:x', ...range);
    expect(lane).toHaveLength(2);
    const series = lane.find((e) => e.rrule)!;
    expect(series).toMatchObject({ uid: 'standup', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', tzid: 'Europe/Athens' });
    expect(series.start.toISOString()).toBe('2026-01-05T08:00:00.000Z');
    expect(series.exdates!.map((d) => d.toISOString())).toEqual(['2026-01-07T08:00:00.000Z']);
    // Summer occurrences stay at 10:00 Athens (07:00Z).
    const occ = expandLaneEvents(lane, Date.UTC(2026, 6, 1), Date.UTC(2026, 6, 2)).filter((e) => e.seriesUid);
    expect(occ.map((e) => e.start.toISOString())).toEqual(['2026-07-01T07:00:00.000Z']);
  });

  it('turns an overridden occurrence into a one-off and skips its original day', () => {
    const ics = wrap([
      'BEGIN:VEVENT', 'UID:gym', 'SUMMARY:Gym', 'DTSTART;VALUE=DATE:20260105', 'DTEND;VALUE=DATE:20260106',
      'RRULE:FREQ=WEEKLY;COUNT=3', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:gym', 'SUMMARY:Gym (moved)', 'RECURRENCE-ID;VALUE=DATE:20260112',
      'DTSTART;VALUE=DATE:20260113', 'DTEND;VALUE=DATE:20260114', 'END:VEVENT',
    ].join('\r\n'));
    const lane = parseIcsForLane(ics, 'scratchpad:x', ...range);
    expect(lane.map((e) => e.title)).toEqual(['Gym', 'Gym (moved)']);
    const all = expandLaneEvents(lane, ...range.map((d) => d.getTime()) as [number, number]);
    expect(all.map((e) => e.start.toISOString().slice(0, 10))).toEqual(['2026-01-05', '2026-01-13', '2026-01-19']);
  });

  it('falls back to fixed copies for a rule it cannot expand', () => {
    const ics = wrap([
      'BEGIN:VEVENT', 'UID:h', 'SUMMARY:Hourly', 'DTSTART:20260105T090000Z', 'DTEND:20260105T091000Z',
      'RRULE:FREQ=HOURLY;COUNT=3', 'END:VEVENT',
    ].join('\r\n'));
    const lane = parseIcsForLane(ics, 'scratchpad:x', ...range);
    expect(lane).toHaveLength(3);
    expect(lane.every((e) => !e.rrule)).toBe(true);
  });

  it('round-trips through the lane export', () => {
    const ics = wrap([
      'BEGIN:VEVENT', 'UID:standup', 'SUMMARY:Standup',
      'DTSTART;TZID=America/New_York:20260105T090000', 'DTEND;TZID=America/New_York:20260105T093000',
      'RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z', 'EXDATE;TZID=America/New_York:20260112T090000',
      'END:VEVENT',
    ].join('\r\n'));
    const lane = parseIcsForLane(ics, 'scratchpad:x', ...range);
    const out = eventsToIcs(lane);
    expect(out).toContain('DTSTART;TZID=America/New_York:20260105T090000');
    expect(out).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z');
    expect(out).toContain('EXDATE;TZID=America/New_York:20260112T090000');
    const again = parseIcsForLane(out, 'scratchpad:x', ...range);
    expect(again[0]).toMatchObject({ uid: 'standup', rrule: lane[0]!.rrule, tzid: 'America/New_York' });
    expect(again[0]!.start.getTime()).toBe(lane[0]!.start.getTime());
    expect(again[0]!.exdates).toEqual(lane[0]!.exdates);
  });
});

describe('parseIcsForLane (single parse)', () => {
  it('converts plain events directly, honouring the file VTIMEZONE and the window', () => {
    const ics = wrap([
      'BEGIN:VTIMEZONE', 'TZID:Custom/Plus5', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0500', 'TZOFFSETTO:+0500', 'END:STANDARD', 'END:VTIMEZONE',
      'BEGIN:VEVENT', 'UID:p1', 'SUMMARY:Plain', 'DTSTART;TZID=Custom/Plus5:20260310T100000',
      'DTEND;TZID=Custom/Plus5:20260310T110000', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:p2', 'SUMMARY:Too early', 'DTSTART:20200101T100000Z', 'DTEND:20200101T110000Z', 'END:VEVENT',
    ].join('\r\n'));
    const lane = parseIcsForLane(ics, 'scratchpad:x', ...range);
    expect(lane.map((e) => e.title)).toEqual(['Plain']);
    expect(lane[0]!.start.toISOString()).toBe('2026-03-10T05:00:00.000Z');
  });

  it('expands an unsupported series with its overrides, and keeps supported ones whole', () => {
    const ics = wrap([
      'BEGIN:VEVENT', 'UID:h', 'SUMMARY:Hourly', 'DTSTART:20260105T090000Z', 'DTEND:20260105T091000Z',
      'RRULE:FREQ=HOURLY;COUNT=3', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:h', 'SUMMARY:Hourly (moved)', 'RECURRENCE-ID:20260105T100000Z',
      'DTSTART:20260105T103000Z', 'DTEND:20260105T104000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:w', 'SUMMARY:Weekly', 'DTSTART;VALUE=DATE:20260105', 'DTEND;VALUE=DATE:20260106',
      'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    ].join('\r\n'));
    const lane = parseIcsForLane(ics, 'scratchpad:x', ...range);
    expect(lane.filter((e) => e.rrule).map((e) => e.uid)).toEqual(['w']);
    expect(lane.filter((e) => !e.rrule).map((e) => e.title).sort()).toEqual(['Hourly', 'Hourly', 'Hourly (moved)']);
  });
});
