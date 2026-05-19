import { describe, expect, it } from 'vitest';
import {
  buildGoogleAddUrl,
  buildIcs,
  buildIcsBundle,
  buildIcsBundleDownload,
  buildIcsDownload,
  buildOutlookAddUrl,
} from './calendar-links';
import type { ParsedEvent } from './types';

const allDay: ParsedEvent = {
  uid: 'evt-1@example',
  feedId: 'feed-1',
  title: "Mother's Day",
  description: 'Greek Mother\'s Day',
  descriptionSnippet: 'Greek Mother\'s Day',
  location: '',
  start: new Date(Date.UTC(2026, 4, 11, 0, 0, 0)),
  end: new Date(Date.UTC(2026, 4, 12, 0, 0, 0)),
  allDay: true,
};

const timed: ParsedEvent = {
  uid: 'evt-2@example',
  feedId: 'feed-1',
  title: 'Lunch with: Maria',
  description: 'Tavern, downtown',
  descriptionSnippet: 'Tavern, downtown',
  location: 'Athens, GR',
  start: new Date(Date.UTC(2026, 5, 1, 11, 30, 0)),
  end: new Date(Date.UTC(2026, 5, 1, 12, 30, 0)),
  allDay: false,
};

describe('calendar-links', () => {
  it('builds a Google all-day URL with YYYYMMDD/YYYYMMDD dates', () => {
    const url = buildGoogleAddUrl(allDay);
    expect(url).toContain('action=TEMPLATE');
    expect(url).toContain('dates=20260511%2F20260512');
    expect(url).toMatch(/text=Mother/);
  });

  it('builds a Google timed URL with UTC zulu timestamps', () => {
    const url = buildGoogleAddUrl(timed);
    expect(url).toContain('dates=20260601T113000Z%2F20260601T123000Z');
    expect(url).toContain('location=Athens%2C+GR');
  });

  it('builds an Outlook URL with subject, startdt, enddt', () => {
    const url = buildOutlookAddUrl(timed);
    expect(url).toContain('subject=Lunch+with');
    expect(url).toContain('startdt=2026-06-01T11%3A30%3A00Z');
    expect(url).toContain('enddt=2026-06-01T12%3A30%3A00Z');
  });

  it('marks Outlook all-day events with allday=true', () => {
    const url = buildOutlookAddUrl(allDay);
    expect(url).toContain('allday=true');
  });

  it('synthesises a valid ICS body', () => {
    const ics = buildIcs(timed);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('SUMMARY:Lunch with: Maria');
    expect(ics).toContain('DTSTART:20260601T113000Z');
    expect(ics).toContain('DTEND:20260601T123000Z');
    expect(ics).toContain('LOCATION:Athens\\, GR');
  });

  it('produces a data URL and a date-prefixed filename for single-day events', () => {
    const { dataUrl, filename } = buildIcsDownload(allDay);
    expect(dataUrl.startsWith('data:text/calendar;charset=utf-8,')).toBe(true);
    expect(filename).toBe('2026-05-11_mother-s-day.ics');
  });

  it('uses a YYYY-MM-DD_to_YYYY-MM-DD prefix for multi-day events', () => {
    const multi: ParsedEvent = {
      ...allDay,
      uid: 'evt-3@example',
      title: 'Team Offsite',
      start: new Date(Date.UTC(2026, 4, 11, 0, 0, 0)),
      end: new Date(Date.UTC(2026, 4, 14, 0, 0, 0)),
      allDay: true,
    };
    const { filename } = buildIcsDownload(multi);
    expect(filename).toBe('2026-05-11_to_2026-05-13_team-offsite.ics');
  });

  it('bundles multiple events into one VCALENDAR sorted by start time', () => {
    const ics = buildIcsBundle([timed, allDay]);
    const beginCount = (ics.match(/BEGIN:VCALENDAR/g) ?? []).length;
    const endCount = (ics.match(/END:VCALENDAR/g) ?? []).length;
    expect(beginCount).toBe(1);
    expect(endCount).toBe(1);
    const vevents = ics.match(/BEGIN:VEVENT/g) ?? [];
    expect(vevents.length).toBe(2);
    const allDayIdx = ics.indexOf("Mother's Day");
    const timedIdx = ics.indexOf('Lunch with: Maria');
    expect(allDayIdx).toBeGreaterThan(-1);
    expect(timedIdx).toBeGreaterThan(allDayIdx);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260511');
    expect(ics).toContain('DTSTART:20260601T113000Z');
    expect(ics).toContain('LOCATION:Athens\\, GR');
  });

  it('emits a valid empty bundle when given no events', () => {
    const ics = buildIcsBundle([]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('names the bundle by start--end date range and event count', () => {
    const { blob, filename } = buildIcsBundleDownload([timed, allDay]);
    expect(blob.type).toBe('text/calendar;charset=utf-8');
    expect(filename).toBe('2026-05-11--2026-06-01_2-events.ics');
  });

  it('falls back to today for an empty bundle filename', () => {
    const { filename } = buildIcsBundleDownload([]);
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}--\d{4}-\d{2}-\d{2}_0-events\.ics$/);
  });
});
