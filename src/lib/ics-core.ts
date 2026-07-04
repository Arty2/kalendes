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
};

export function parseIcs(
  ics: string,
  feedId: string,
  rangeStart: Date,
  rangeEnd: Date,
): ParsedEvent[] {
  return parseIcsExtended(ics, feedId, rangeStart, rangeEnd).events;
}

// ical-expander counts iterations from each series' DTSTART, not from the
// window start, so the cap has to cover the occurrences before the window
// (e.g. a years-old daily standup) as well as the window itself. One
// iteration ≈ one occurrence; daily is the worst common granularity, so
// allow ten years of daily pre-window backlog plus one per window day. The
// old fixed cap of 1000 (~2.7 years of a daily series) silently truncated
// long series inside the visible range.
function iterationCapFor(rangeStart: Date, rangeEnd: Date): number {
  const windowDays = Math.ceil(Math.max(0, rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000);
  return Math.max(1000, windowDays + 3660);
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
    expander = new IcalExpander({ ics, maxIterations: iterationCapFor(rangeStart, rangeEnd) });
    result = expander.between(rangeStart, rangeEnd) as ExpanderResult;
  } catch {
    return parseIcsFallback(ics, feedId, rangeStart, rangeEnd);
  }
  const out: ParsedEvent[] = [];
  for (const event of result.events) {
    out.push(toParsedEvent(event, feedId, event.startDate, event.endDate));
  }
  for (const occ of result.occurrences) {
    out.push(toParsedEvent(occ.item, feedId, occ.startDate, occ.endDate));
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  const root = (expander as unknown as { component: ICAL.Component }).component;
  const timezone = root ? detectFeedTimezoneFromComponent(root) : null;
  return { events: out, timezone };
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
      }
    } catch { /* skip malformed event */ }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  const timezone = detectFeedTimezoneFromComponent(root);
  return { events: out, timezone };
}

// On-demand source lookup for the event modal: pull the raw VEVENT block for a
// composite `uid:startMs` event id straight out of the original feed text.
// Serializing every VEVENT eagerly at parse time used to double the worker
// payload (and retain one copy per occurrence); a string scan when the source
// view actually opens costs nothing on the refresh path.
export function extractRawVevent(ics: string, compositeUid: string): string | null {
  const sep = compositeUid.lastIndexOf(':');
  const baseUid = sep >= 0 ? compositeUid.slice(0, sep) : compositeUid;
  const startMs = sep >= 0 ? Number(compositeUid.slice(sep + 1)) : NaN;

  const blocks: string[] = [];
  const lines = ics.split(/\r?\n/);
  let cur: string[] | null = null;
  for (const line of lines) {
    if (cur === null) {
      if (/^BEGIN:VEVENT\s*$/i.test(line)) cur = [line];
      continue;
    }
    cur.push(line);
    if (/^END:VEVENT\s*$/i.test(line)) {
      blocks.push(cur.join('\r\n'));
      cur = null;
    }
  }

  const matches = blocks.filter((b) => uidOfBlock(b) === baseUid);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;

  // A series with overridden instances: prefer the override whose start is the
  // occurrence being viewed, otherwise fall back to the series master.
  let master: string | null = null;
  for (const block of matches) {
    if (!/^RECURRENCE-ID/im.test(unfoldBlock(block))) {
      master ??= block;
      continue;
    }
    if (Number.isFinite(startMs) && blockStartMs(block) === startMs) return block;
  }
  return master ?? matches[0]!;
}

// Undo RFC 5545 line folding (continuation lines start with a space or tab) so
// property regexes see one property per line.
function unfoldBlock(block: string): string {
  return block.replace(/\r?\n[ \t]/g, '');
}

function uidOfBlock(block: string): string | null {
  const m = /^UID(?:;[^:\r\n]*)?:(.*)$/im.exec(unfoldBlock(block));
  return m ? m[1]!.trim() : null;
}

function blockStartMs(block: string): number | null {
  try {
    const comp = new ICAL.Component(ICAL.parse(wrapVeventInCalendar(block)) as never);
    const ve = comp.getFirstSubcomponent('vevent');
    if (!ve) return null;
    const event = new ICAL.Event(ve);
    if (!event.startDate) return null;
    return timeToUtcDate(event.startDate).getTime();
  } catch {
    return null;
  }
}

// A bare VEVENT block is not a valid calendar on its own. Wrap it in a minimal
// VCALENDAR envelope so the source view can be copied out as a standalone,
// importable .ics. Already-wrapped input is returned unchanged.
export function wrapVeventInCalendar(raw: string): string {
  if (/BEGIN:VCALENDAR/i.test(raw)) return raw;
  const body = raw.replace(/\r?\n$/, '');
  return (
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//almanacs//EN', body, 'END:VCALENDAR'].join('\r\n') +
    '\r\n'
  );
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
