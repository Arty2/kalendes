import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseIcs, wrapVeventInCalendar } from './ics-core';
import { feedIdFor, fetchAndParseFeed, rangeKeyFor } from './ics';
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
  // Parsing runs ical.js + ical-expander — the heaviest work in the suite — and
  // the assertions below are all read-only, so parse the fixture once and share it.
  const events = parseIcs(ICS, 'demo', new Date('2024-01-01T00:00:00Z'), new Date('2027-12-15T00:00:00Z'));

  it('expands RRULE into yearly occurrences within range', () => {
    const newYears = events.filter((e) => e.title.includes('New Year'));
    expect(newYears.length).toBe(4);
    expect(newYears.map((e) => e.start.getUTCFullYear()).sort()).toEqual([2024, 2025, 2026, 2027]);
  });

  it('marks date-only events as all-day and timed events as not', () => {
    const newYear = events.find((e) => e.title.includes('New Year'));
    const meeting = events.find((e) => e.title.includes('Project sync'));
    expect(newYear?.allDay).toBe(true);
    expect(meeting?.allDay).toBe(false);
  });

  it('extracts the first non-empty description line as snippet', () => {
    const newYear = events.find((e) => e.title.includes('New Year'));
    expect(newYear?.descriptionSnippet).toBe('First day of the year.');
  });

  it('preserves location on events', () => {
    const meeting = events.find((e) => e.title.includes('Project sync'));
    expect(meeting?.location).toBe('Athens');
  });

  it('returns events sorted by start time', () => {
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

describe('fetchAndParseFeed conditional requests', () => {
  const source = { kind: 'user', url: 'https://example.com/cal.ics' } as const;
  const rangeStart = new Date('2026-01-01T00:00:00Z');
  const rangeEnd = new Date('2026-12-31T00:00:00Z');
  const FEED_ICS = christmasIcs('DTSTART;VALUE=DATE:20261225\nDTEND;VALUE=DATE:20261226');

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentHeaders(fetchMock: ReturnType<typeof vi.fn>, call: number): Record<string, string> {
    const init = fetchMock.mock.calls[call]![1] as RequestInit;
    return (init.headers ?? {}) as Record<string, string>;
  }

  it('captures validators from a 200 and returns not-modified on a 304', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(FEED_ICS, {
        status: 200,
        headers: { ETag: '"v1"', 'Last-Modified': 'Wed, 01 Jul 2026 00:00:00 GMT' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchAndParseFeed(source, rangeStart, rangeEnd);
    expect(first.kind).toBe('parsed');
    if (first.kind !== 'parsed') return;
    expect(first.result.events).toHaveLength(1);
    expect(first.validators).toEqual({
      etag: '"v1"',
      lastModified: 'Wed, 01 Jul 2026 00:00:00 GMT',
      rangeKey: rangeKeyFor(rangeStart, rangeEnd),
    });
    // The first request carries no conditional headers.
    expect(sentHeaders(fetchMock, 0)['If-None-Match']).toBeUndefined();

    fetchMock.mockImplementation(async () => new Response(null, { status: 304 }));
    const second = await fetchAndParseFeed(source, rangeStart, rangeEnd, {
      validators: first.validators!,
    });
    expect(second.kind).toBe('not-modified');
    expect(sentHeaders(fetchMock, 1)['If-None-Match']).toBe('"v1"');
    expect(sentHeaders(fetchMock, 1)['If-Modified-Since']).toBe('Wed, 01 Jul 2026 00:00:00 GMT');
  });

  it('skips revalidation when the expansion range changed', async () => {
    const fetchMock = vi.fn(async () => new Response(FEED_ICS, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await fetchAndParseFeed(source, rangeStart, new Date('2027-06-30T00:00:00Z'), {
      validators: { etag: '"v1"', rangeKey: rangeKeyFor(rangeStart, rangeEnd) },
    });
    expect(outcome.kind).toBe('parsed');
    // Stale-range validators must not be sent: a 304 would leave the events
    // expanded for the old range.
    expect(sentHeaders(fetchMock, 0)['If-None-Match']).toBeUndefined();
    // And a response without validator headers yields none to store.
    if (outcome.kind === 'parsed') expect(outcome.validators).toBeNull();
  });
});

describe('wrapVeventInCalendar', () => {
  const VEVENT = [
    'BEGIN:VEVENT',
    'UID:abc@test',
    'SUMMARY:Lunch',
    'DTSTART:20260115T120000Z',
    'DTEND:20260115T130000Z',
    'END:VEVENT',
  ].join('\r\n');

  it('wraps a bare VEVENT into a valid, parseable VCALENDAR', () => {
    const ics = wrapVeventInCalendar(VEVENT);
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain(VEVENT);
    const events = parseIcs(
      ics,
      'scratchpad:x',
      new Date('2000-01-01T00:00:00Z'),
      new Date('2100-01-01T00:00:00Z'),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe('Lunch');
  });

  it('leaves already-wrapped input unchanged', () => {
    const wrapped = wrapVeventInCalendar(VEVENT);
    expect(wrapVeventInCalendar(wrapped)).toBe(wrapped);
  });
});
