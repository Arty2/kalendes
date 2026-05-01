import ICAL from 'ical.js';
import IcalExpander from 'ical-expander';
import type { FeedSource, ParsedEvent } from './types';

export function feedIdFor(source: FeedSource): string {
  if (source.kind === 'secret') return 'secret:' + source.id;
  if (source.kind === 'static') return 'static:' + source.path;
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
  if (source.kind === 'static') return source.path;
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

export async function fetchAndParseFeed(
  source: FeedSource,
  rangeStart: Date,
  rangeEnd: Date,
  signal?: AbortSignal,
): Promise<ParsedEvent[]> {
  const url = buildSourceUrl(source);
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error('Failed to fetch ' + url + ': ' + response.status);
  }
  const text = await response.text();
  return parseIcs(text, feedIdFor(source), rangeStart, rangeEnd);
}

export function parseIcs(
  ics: string,
  feedId: string,
  rangeStart: Date,
  rangeEnd: Date,
): ParsedEvent[] {
  const expander = new IcalExpander({ ics, maxIterations: 1000 });
  const result = expander.between(rangeStart, rangeEnd) as ExpanderResult;
  const out: ParsedEvent[] = [];
  for (const event of result.events) {
    out.push(toParsedEvent(event, feedId, event.startDate, event.endDate));
  }
  for (const occ of result.occurrences) {
    out.push(toParsedEvent(occ.item, feedId, occ.startDate, occ.endDate));
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

function toParsedEvent(
  event: ICAL.Event,
  feedId: string,
  startDate: ICAL.Time,
  endDate: ICAL.Time,
): ParsedEvent {
  const allDay = startDate.isDate;
  const start = startDate.toJSDate();
  let end = endDate.toJSDate();
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
