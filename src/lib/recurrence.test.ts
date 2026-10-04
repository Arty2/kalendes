import {
  buildRRule,
  describeRRule,
  expandLaneEvents,
  occurrenceStarts,
  occurrenceUid,
  parseRRule,
  presetOf,
  splitOccurrenceUid,
  moveExdates,
} from './recurrence';
import type { ParsedEvent } from './types';

function ev(over: Partial<ParsedEvent>): ParsedEvent {
  return {
    uid: 'scratch:s1',
    feedId: 'scratchpad:default',
    title: 'Standup',
    description: '',
    descriptionSnippet: '',
    location: '',
    start: new Date('2026-01-05T08:00:00Z'),
    end: new Date('2026-01-05T08:30:00Z'),
    allDay: false,
    ...over,
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();

describe('parseRRule', () => {
  it('reads the common parts', () => {
    expect(parseRRule('RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR;COUNT=4')).toEqual({
      freq: 'MONTHLY', interval: 2, count: 4, byDay: [{ n: -1, wd: 5 }], wkst: 1,
    });
  });
  it('refuses what it cannot expand', () => {
    expect(parseRRule('FREQ=HOURLY')).toBeNull();
    expect(parseRRule('FREQ=WEEKLY;BYHOUR=9')).toBeNull();
    expect(parseRRule('FREQ=YEARLY;BYWEEKNO=20')).toBeNull();
    expect(parseRRule('INTERVAL=2')).toBeNull();
    expect(parseRRule('FREQ=DAILY;UNTIL=tomorrow')).toBeNull();
  });
});

describe('occurrenceStarts', () => {
  it('keeps a timed series on its wall clock across DST', () => {
    // 10:00 Athens every week, March 23 → April 6 crosses the March 29 change.
    const series = ev({
      start: new Date('2026-03-23T08:00:00Z'),
      end: new Date('2026-03-23T09:00:00Z'),
      rrule: 'FREQ=WEEKLY',
      tzid: 'Europe/Athens',
    });
    const got = occurrenceStarts(series, Date.UTC(2026, 2, 1), Date.UTC(2026, 3, 10)).map(iso);
    expect(got).toEqual(['2026-03-23T08:00:00.000Z', '2026-03-30T07:00:00.000Z', '2026-04-06T07:00:00.000Z']);
  });

  it('honours COUNT, UNTIL and EXDATE', () => {
    const range = [Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31)] as const;
    const daily = ev({ rrule: 'FREQ=DAILY;COUNT=3', tzid: 'UTC' });
    expect(occurrenceStarts(daily, ...range)).toHaveLength(3);
    const until = ev({ rrule: 'FREQ=DAILY;UNTIL=20260107T235959Z', tzid: 'UTC' });
    expect(occurrenceStarts(until, ...range)).toHaveLength(3);
    const ex = ev({ rrule: 'FREQ=DAILY;COUNT=3', tzid: 'UTC', exdates: [new Date('2026-01-06T08:00:00Z')] });
    expect(occurrenceStarts(ex, ...range).map(iso)).toEqual(['2026-01-05T08:00:00.000Z', '2026-01-07T08:00:00.000Z']);
  });

  it('expands monthly ordinals and set positions', () => {
    const allDay = (rrule: string): number[] =>
      occurrenceStarts(
        ev({ allDay: true, start: new Date(Date.UTC(2026, 0, 30)), end: new Date(Date.UTC(2026, 0, 31)), rrule }),
        Date.UTC(2026, 0, 1),
        Date.UTC(2026, 3, 30),
      );
    // Last Friday of each month.
    expect(allDay('FREQ=MONTHLY;BYDAY=-1FR').map(iso).map((s) => s.slice(0, 10))).toEqual([
      '2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24',
    ]);
    // Last weekday of each month.
    expect(allDay('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1').map(iso).map((s) => s.slice(0, 10))).toEqual([
      '2026-01-30', '2026-02-27', '2026-03-31', '2026-04-30',
    ]);
    // The 31st skips the months without one.
    expect(
      occurrenceStarts(
        ev({ allDay: true, start: new Date(Date.UTC(2026, 0, 31)), end: new Date(Date.UTC(2026, 1, 1)), rrule: 'FREQ=MONTHLY' }),
        Date.UTC(2026, 0, 1),
        Date.UTC(2026, 5, 30),
      ).map(iso).map((s) => s.slice(0, 10)),
    ).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('walks a years-old series straight to the window', () => {
    const old = ev({ start: new Date('2016-01-04T08:00:00Z'), end: new Date('2016-01-04T08:30:00Z'), rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', tzid: 'Europe/Athens' });
    const got = occurrenceStarts(old, Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 15));
    expect(got.map(iso)).toEqual([
      '2026-01-05T08:00:00.000Z', '2026-01-07T08:00:00.000Z', '2026-01-12T08:00:00.000Z', '2026-01-14T08:00:00.000Z',
    ]);
  });

  it('includes an occurrence that started before the window but runs into it', () => {
    const long = ev({ allDay: true, start: new Date(Date.UTC(2026, 0, 1)), end: new Date(Date.UTC(2026, 0, 4)), rrule: 'FREQ=WEEKLY' });
    expect(occurrenceStarts(long, Date.UTC(2026, 0, 10), Date.UTC(2026, 0, 12)).map(iso)).toEqual(['2026-01-08T00:00:00.000Z']);
  });
});

describe('expandLaneEvents', () => {
  it('returns the same array when nothing repeats', () => {
    const list = [ev({})];
    expect(expandLaneEvents(list, 0, Date.UTC(2030, 0, 1))).toBe(list);
  });
  it('gives each occurrence an id that leads back to its series', () => {
    const list = [ev({ rrule: 'FREQ=DAILY;COUNT=2', tzid: 'UTC' })];
    const out = expandLaneEvents(list, 0, Date.UTC(2030, 0, 1));
    expect(out.map((o) => o.uid)).toEqual([
      occurrenceUid('scratch:s1', Date.parse('2026-01-05T08:00:00Z')),
      occurrenceUid('scratch:s1', Date.parse('2026-01-06T08:00:00Z')),
    ]);
    expect(out[1]!.end.getTime() - out[1]!.start.getTime()).toBe(30 * 60_000);
    expect(out.every((o) => o.seriesUid === 'scratch:s1')).toBe(true);
    expect(splitOccurrenceUid(out[1]!.uid)).toEqual({ seriesUid: 'scratch:s1', startMs: Date.parse('2026-01-06T08:00:00Z') });
    expect(splitOccurrenceUid('scratch:s1')).toBeNull();
  });
});

describe('repeat picker', () => {
  it('round-trips presets with an end day', () => {
    const rule = buildRRule('weekly', '2026-12-31', false, 'America/New_York');
    expect(rule).toBe('FREQ=WEEKLY;UNTIL=20270101T045959Z');
    expect(presetOf(rule, 'America/New_York')).toEqual({ preset: 'weekly', until: '2026-12-31' });
    expect(buildRRule('weekdays', '', true, 'UTC')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(presetOf('FREQ=MONTHLY;BYDAY=2TU').preset).toBe('custom');
    expect(presetOf(undefined).preset).toBe('none');
  });
  it('describes rules in a line', () => {
    const day = new Date(Date.UTC(2026, 9, 6)); // a Tuesday
    expect(describeRRule('FREQ=WEEKLY', day)).toBe('Every week on Tuesday');
    expect(describeRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', day)).toBe('Every weekday');
    expect(describeRRule('FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR', day)).toBe('Every 2 months on the last Friday');
    expect(describeRRule('FREQ=MONTHLY', day)).toBe('Every month on the 6th');
    expect(describeRRule('FREQ=YEARLY;UNTIL=20301006', day)).toBe('Every year on October 6 until 2030-10-06');
    expect(describeRRule('FREQ=DAILY;COUNT=5', day)).toBe('Every day, 5 times');
  });
});

describe('moveExdates', () => {
  it('keeps skipped days on their occurrences across DST and kind changes', () => {
    // Athens 10:00 on 2026-03-20 (+2) with Apr 10 10:00 (+3) skipped; move the start to Apr 3 10:00.
    const prev = { start: new Date('2026-03-20T08:00:00Z'), allDay: false, tzid: 'Europe/Athens', exdates: [new Date('2026-04-10T07:00:00Z')] };
    const next = { start: new Date('2026-04-03T07:00:00Z'), allDay: false, tzid: 'Europe/Athens' };
    expect(moveExdates(prev, next).map((d) => d.toISOString())).toEqual(['2026-04-24T07:00:00.000Z']);
    // Same series turned all-day: the skipped day stays that day.
    expect(moveExdates(prev, { start: new Date(Date.UTC(2026, 2, 20)), allDay: true }).map((d) => d.toISOString()))
      .toEqual(['2026-04-10T00:00:00.000Z']);
  });
});
