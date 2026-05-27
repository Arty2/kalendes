import ICAL from 'ical.js';
import IcalExpander from 'ical-expander';
import type { ParsedEvent } from './types';
import { snippetFromText } from './format';

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
  let expander: IcalExpander;
  let result: ExpanderResult;
  try {
    expander = new IcalExpander({ ics, maxIterations: 1000 });
    result = expander.between(rangeStart, rangeEnd) as ExpanderResult;
  } catch {
    return parseIcsFallback(ics, feedId, rangeStart, rangeEnd);
  }
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
  const root = (expander as unknown as { component: ICAL.Component }).component;
  const timezone = root ? detectFeedTimezoneFromComponent(root) : null;
  return { events: out, timezone, rawByUid };
}

function sanitizeJCal(jcal: unknown): unknown {
  if (!Array.isArray(jcal)) return jcal;
  const name = jcal[0];
  const props = Array.isArray(jcal[1]) ? jcal[1] : [];
  const subs = Array.isArray(jcal[2]) ? (jcal[2] as unknown[]).map(sanitizeJCal) : [];
  return [name, props, subs];
}

function parseIcsFallback(
  ics: string,
  feedId: string,
  rangeStart: Date,
  rangeEnd: Date,
): FeedParseResult {
  const rsMs = rangeStart.getTime();
  const reMs = rangeEnd.getTime();
  const out: ParsedEvent[] = [];
  const rawByUid: Record<string, string> = {};

  let root: ICAL.Component;
  try {
    const safe = sanitizeJCal(ICAL.parse(ics) as unknown) as unknown[];
    root = new ICAL.Component(safe as never);
  } catch (err) {
    throw new Error('Failed to parse calendar: ' + (err instanceof Error ? err.message : String(err)));
  }

  let vevents: ICAL.Component[] = [];
  try {
    vevents = root.getAllSubcomponents('vevent');
  } catch { /* jCal still malformed — return empty */ }

  for (const vevent of vevents) {
    try {
      const event = new ICAL.Event(vevent);
      if (!event.startDate) continue;
      const endDate = event.endDate ?? event.startDate;
      const parsed = toParsedEvent(event, feedId, event.startDate, endDate);
      if (parsed.end.getTime() >= rsMs && parsed.start.getTime() <= reMs) {
        out.push(parsed);
        captureRaw(rawByUid, parsed.uid, event);
      }
    } catch { /* skip malformed event */ }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  const timezone = detectFeedTimezoneFromComponent(root);
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

function detectFeedTimezoneFromComponent(root: ICAL.Component): string | null {
  try {
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
    descriptionSnippet: snippetFromText(description),
    location: event.location ?? '',
    start,
    end,
    allDay,
  };
}
