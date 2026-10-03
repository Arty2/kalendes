// An .ics file imported as a local lane. Feeds are expanded into fixed
// occurrences over the parse window (ics-core); a lane keeps each repeating
// event as one series instead — its RRULE, EXDATEs and zone (recurrence.ts) —
// so it repeats past the window, edits as one event and exports as it came.
// A series this app can't expand (an exotic RRULE, RDATE, a zone Intl doesn't
// know) falls back to the fixed copies a feed would get. Loaded on demand by
// the import action, never by the worker.
import ICAL from 'ical.js';
import type { ParsedEvent } from './types';
import { parseIcs, eventFlags } from './ics-core';
import { isValidTimezone, parseRRule } from './recurrence';
import { zonedWallToInstant } from './event-drag';
import { resolveLocalTz, snippetFromText } from './format';

// The instant an ICAL.Time names. A zoned value is read on its TZID's wall
// clock ourselves, so it lands right whether or not the file carries a
// VTIMEZONE; a floating one reads in `floatingTz`.
function instantOf(t: ICAL.Time, tzid: string | null, floatingTz: string): number {
  if (t.isDate) return Date.UTC(t.year, t.month - 1, t.day);
  const min = t.hour * 60 + t.minute;
  if (t.zone?.tzid === 'UTC') return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const zone = tzid && isValidTimezone(tzid) ? tzid : tzid ? null : floatingTz;
  if (zone) return zonedWallToInstant(t.year, t.month, t.day, min, zone).getTime() + t.second * 1000;
  return t.toJSDate().getTime();
}

function tzidOf(comp: ICAL.Component, prop: string): string | null {
  const v = comp.getFirstProperty(prop)?.getParameter('tzid');
  return typeof v === 'string' && v ? v : null;
}

// The series behind a VEVENT with one supported RRULE, or null.
function seriesFrom(comp: ICAL.Component, feedId: string): ParsedEvent | null {
  const rules = comp.getAllProperties('rrule');
  if (rules.length !== 1 || comp.hasProperty('rdate')) return null;
  const uid = comp.getFirstPropertyValue('uid');
  if (typeof uid !== 'string' || !uid) return null;
  const rrule = String(rules[0]!.getFirstValue());
  if (!parseRRule(rrule)) return null;
  const event = new ICAL.Event(comp);
  const s = event.startDate;
  if (!s) return null;
  const allDay = s.isDate;
  const startTz = tzidOf(comp, 'dtstart');
  let tzid: string | undefined;
  if (!allDay) {
    if (s.zone?.tzid === 'UTC') tzid = 'UTC';
    else if (startTz) {
      if (!isValidTimezone(startTz)) return null; // e.g. a Windows zone name
      tzid = startTz;
    } else tzid = resolveLocalTz();
  }
  const floating = tzid ?? 'UTC';
  const start = instantOf(s, startTz, floating);
  const e = event.endDate;
  let end = e ? instantOf(e, tzidOf(comp, 'dtend') ?? startTz, floating) : start;
  if (end <= start) end = start + (allDay ? 86_400_000 : 3_600_000);
  const exdates: Date[] = [];
  for (const prop of comp.getAllProperties('exdate')) {
    const tz = (prop.getParameter('tzid') as string | undefined) ?? startTz;
    for (const v of prop.getValues() as ICAL.Time[]) {
      exdates.push(new Date(exdateInstant(v, tz, floating, allDay, s)));
    }
  }
  const description = event.description ?? '';
  return {
    uid,
    feedId,
    title: event.summary ?? '(untitled)',
    description,
    descriptionSnippet: snippetFromText(description),
    location: event.location ?? '',
    start: new Date(start),
    end: new Date(end),
    allDay,
    rrule,
    ...(exdates.length ? { exdates } : {}),
    ...(tzid ? { tzid } : {}),
    ...eventFlags(event),
  };
}

// An EXDATE / RECURRENCE-ID as the occurrence start it removes. A date-only
// value against a timed series means that day's occurrence (at DTSTART's time).
function exdateInstant(v: ICAL.Time, tzid: string | null, floatingTz: string, allDay: boolean, dtstart: ICAL.Time): number {
  if (v.isDate && !allDay) {
    const at = v.clone();
    at.isDate = false;
    at.hour = dtstart.hour;
    at.minute = dtstart.minute;
    at.second = dtstart.second;
    return instantOf(at, tzid, floatingTz);
  }
  return instantOf(v, tzid, floatingTz);
}

function baseUid(compositeUid: string): string {
  const i = compositeUid.lastIndexOf(':');
  return i >= 0 ? compositeUid.slice(0, i) : compositeUid;
}

/** Parse an .ics file into a local lane's events, keeping supported series whole. */
export function parseIcsForLane(ics: string, feedId: string, rangeStart: Date, rangeEnd: Date): ParsedEvent[] {
  const expanded = parseIcs(ics, feedId, rangeStart, rangeEnd);
  let vevents: ICAL.Component[];
  try {
    vevents = new ICAL.Component(ICAL.parse(ics) as never).getAllSubcomponents('vevent');
  } catch {
    return expanded;
  }
  const series = new Map<string, ParsedEvent>();
  const overrides: ICAL.Component[] = [];
  for (const comp of vevents) {
    try {
      if (comp.hasProperty('recurrence-id')) overrides.push(comp);
      else {
        const s = seriesFrom(comp, feedId);
        if (s && !series.has(s.uid)) series.set(s.uid, s);
      }
    } catch {
      /* malformed: its fixed copies stay */
    }
  }
  if (series.size === 0) return expanded;
  // A moved or changed occurrence: the series skips its original start and the
  // override stays as a one-off event (wherever it falls, not only in range).
  const oneOffs: ParsedEvent[] = [];
  for (const comp of overrides) {
    const uid = comp.getFirstPropertyValue('uid');
    const s = typeof uid === 'string' ? series.get(uid) : undefined;
    if (!s) continue;
    try {
      const rid = comp.getFirstPropertyValue('recurrence-id') as ICAL.Time;
      const floating = s.tzid ?? 'UTC';
      const startTz = tzidOf(comp, 'dtstart');
      const dtstart = new ICAL.Event(comp).startDate;
      s.exdates = [...(s.exdates ?? []), new Date(exdateInstant(rid, tzidOf(comp, 'recurrence-id'), floating, s.allDay, dtstart))];
      const event = new ICAL.Event(comp);
      const start = instantOf(event.startDate, startTz, floating);
      let end = event.endDate ? instantOf(event.endDate, tzidOf(comp, 'dtend') ?? startTz, floating) : start;
      if (end <= start) end = start + (event.startDate.isDate ? 86_400_000 : 3_600_000);
      const description = event.description ?? '';
      oneOffs.push({
        uid: uid + ':' + start,
        feedId,
        title: event.summary ?? s.title,
        description,
        descriptionSnippet: snippetFromText(description),
        location: event.location ?? '',
        start: new Date(start),
        end: new Date(end),
        allDay: event.startDate.isDate,
        ...eventFlags(event),
      });
    } catch {
      /* skip a malformed override */
    }
  }
  const fixed = expanded.filter((e) => !series.has(baseUid(e.uid)));
  return [...fixed, ...series.values(), ...oneOffs].sort((a, b) => a.start.getTime() - b.start.getTime());
}
