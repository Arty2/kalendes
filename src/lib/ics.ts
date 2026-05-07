import ICAL from 'ical.js';
import IcalExpander from 'ical-expander';
import type { FeedSource, ParsedEvent } from './types';

export function feedIdFor(source: FeedSource): string {
  if (source.kind === 'secret') return 'secret:' + source.id;
  return 'user:' + hashString(source.url);
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(36);
}

function buildSourceUrl(source: FeedSource): string {
  if (source.kind === 'secret') return '/api/ics?id=' + encodeURIComponent(source.id);
  return '/api/ics?url=' + encodeURIComponent(source.url);
}

function snippetFromDescription(description: string): string {
  const normalized = description.replace(/\\n/g, '\n').replace(/\\,/g, ',');
  const firstLine = normalized.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return firstLine.length > 80 ? firstLine.slice(0, 79) + '…' : firstLine;
}

type ExpanderOccurrence = {
  startDate: ICAL.Time;
  endDate: ICAL.Time;
  item: ICAL.Event;
};

type ExpanderResult = {
  events: ICAL.Event[];
  occurrences: ExpanderOccurrence[];
};

export type FeedParseResult = {
  events: ParsedEvent[];
  timezone: string | null;
  rawByUid: Record<string, string>;
};

export async function fetchAndParseFeed(
  source: FeedSource,
  rangeStart: Date,
  rangeEnd: Date,
  signal?: AbortSignal,
): Promise<FeedParseResult> {
  const url = buildSourceUrl(source);
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error('Failed to fetch ' + url + ': ' + response.status);
  }
  const text = await response.text();
  return parseIcsExtended(text, feedIdFor(source), rangeStart, rangeEnd);
}

export function parseIcs(
  ics: string,
  feedId: string,
  rangeStart: Date,
  rangeEnd: Date,
): ParsedEvent[] {
  return parseIcsExtended(ics, feedId, rangeStart, rangeEnd).events;
}

export function parseIcsExtended(
  ics: string,
  feedId: string,
  rangeStart: Date,
  rangeEnd: Date,
): FeedParseResult {
  const expander = new IcalExpander({ ics, maxIterations: 1000 });
  const result = expander.between(rangeStart, rangeEnd) as ExpanderResult;
  const out: ParsedEvent[] = [];
  const rawByUid: Record<string, string> = {};
  for (const event of result.events) {
    const parsed = toParsedEvent(event, feedId, event.startDate, event.endDate);
    out.push(parsed);
    captureRaw(rawByUid, parsed.uid, event);
  }
  for (const occ of result.occurrences) {
    const parsed = toParsedEvent(occ.item, feedId, occ.startDate, occ.endDate);
    out.push(parsed);
    captureRaw(rawByUid, parsed.uid, occ.item);
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  const timezone = detectFeedTimezone(ics);
  return { events: out, timezone, rawByUid };
}

function captureRaw(target: Record<string, string>, uid: string, event: ICAL.Event): void {
  try {
    const comp = (event as unknown as { component?: ICAL.Component }).component;
    if (comp) target[uid] = comp.toString();
  } catch {
    /* ignore */
  }
}

function detectFeedTimezone(ics: string): string | null {
  try {
    const jcal = ICAL.parse(ics);
    const root = new ICAL.Component(jcal);
    const wrTz = root.getFirstPropertyValue('x-wr-timezone');
    if (typeof wrTz === 'string' && wrTz.trim()) return wrTz.trim();
    const counts = new Map<string, number>();
    for (const ve of root.getAllSubcomponents('vevent')) {
      const dtstart = ve.getFirstProperty('dtstart');
      const tz = dtstart?.getParameter('tzid');
      if (typeof tz === 'string' && tz) counts.set(tz, (counts.get(tz) ?? 0) + 1);
    }
    let best: { tz: string; n: number } | null = null;
    for (const [tz, n] of counts) {
      if (!best || n > best.n) best = { tz, n };
    }
    return best?.tz ?? null;
  } catch {
    return null;
  }
}

function timeToUtcDate(t: ICAL.Time): Date {
  // ical.js anchors VALUE=DATE values to *local* midnight, which shifts the
  // calendar day in non-UTC browsers (e.g. Athens at UTC+3 turns May 11 into
  // May 10T21:00Z). Re-anchor date-only values to UTC midnight using the raw
  // y/m/d fields so downstream layout/duration logic is timezone-agnostic.
  if (t.isDate) return new Date(Date.UTC(t.year, t.month - 1, t.day));
  return t.toJSDate();
}

function toParsedEvent(
  event: ICAL.Event,
  feedId: string,
  startDate: ICAL.Time,
  endDate: ICAL.Time,
): ParsedEvent {
  const allDay = startDate.isDate;
  const start = timeToUtcDate(startDate);
  let end = timeToUtcDate(endDate);
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + (allDay ? 86_400_000 : 60 * 60 * 1000));
  }
  const description = event.description ?? '';
  return {
    uid: event.uid + ':' + start.getTime(),
    feedId,
    title: event.summary ?? '(untitled)',
    description,
    descriptionSnippet: snippetFromDescription(description),
    location: event.location ?? '',
    start,
    end,
    allDay,
  };
}
