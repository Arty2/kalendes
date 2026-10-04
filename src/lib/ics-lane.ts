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

// A single (non-repeating) VEVENT, or a moved instance of `series`, as a lane
// event (uid `UID:startMs`, as feeds have it). Times read like a series' do:
// a TZID on its wall clock via Intl (a VTIMEZONE isn't needed), a floating
// time in the series' zone, else the device's.
function oneOffFrom(comp: ICAL.Component, feedId: string, series: ParsedEvent | null): ParsedEvent | null {
  const event = new ICAL.Event(comp);
  const s = event.startDate;
  if (!s) return null;
  const floating = series?.tzid ?? resolveLocalTz();
  const startTz = tzidOf(comp, 'dtstart');
  const start = instantOf(s, startTz, floating);
  let end = event.endDate ? instantOf(event.endDate, tzidOf(comp, 'dtend') ?? startTz, floating) : start;
  if (end <= start) end = start + (s.isDate ? 86_400_000 : 3_600_000);
  const description = event.description ?? '';
  return {
    uid: (event.uid ?? series?.uid ?? '') + ':' + start,
    feedId,
    title: event.summary ?? series?.title ?? '(untitled)',
    description,
    descriptionSnippet: snippetFromText(description),
    location: event.location ?? '',
    start: new Date(start),
    end: new Date(end),
    allDay: s.isDate,
    ...eventFlags(event),
  };
}

/**
 * Parse an .ics file into a local lane's events, keeping supported series
 * whole. The file is parsed once: plain events convert directly, and only the
 * repeating events this app can't keep as a series (with their overrides) go
 * through the feed expander, as a reduced calendar of just those.
 */
export function parseIcsForLane(ics: string, feedId: string, rangeStart: Date, rangeEnd: Date): ParsedEvent[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(ics) as never);
  } catch {
    return parseIcs(ics, feedId, rangeStart, rangeEnd); // its fallback copes with malformed files
  }
  const zones = root.getAllSubcomponents('vtimezone');
  // Register the file's zones so plain events with a TZID convert correctly
  // (the expander does the same for the components it handles).
  for (const vtz of zones) {
    try {
      ICAL.TimezoneService.register(new ICAL.Timezone(vtz));
    } catch {
      /* an unusable VTIMEZONE: its times read as floating */
    }
  }
  const vevents = root.getAllSubcomponents('vevent');
  const series = new Map<string, ParsedEvent>();
  const overrides: ICAL.Component[] = [];
  const plain: ICAL.Component[] = [];
  const unsupported: ICAL.Component[] = [];
  for (const comp of vevents) {
    try {
      if (comp.hasProperty('recurrence-id')) overrides.push(comp);
      else if (comp.hasProperty('rrule') || comp.hasProperty('rdate')) {
        const s = seriesFrom(comp, feedId);
        if (!s) unsupported.push(comp);
        else if (!series.has(s.uid)) series.set(s.uid, s);
        // A second master under a kept series' UID is a stale duplicate: drop it.
      } else plain.push(comp);
    } catch {
      unsupported.push(comp); // let the expander (and its fallback) have a go
    }
  }
  const rs = rangeStart.getTime();
  const re = rangeEnd.getTime();
  const fixed: ParsedEvent[] = [];
  for (const comp of plain) {
    try {
      const e = oneOffFrom(comp, feedId, null);
      if (e && e.end.getTime() >= rs && e.start.getTime() <= re) fixed.push(e);
    } catch {
      /* skip a malformed event */
    }
  }
  // Overrides of series kept whole become one-offs below; the rest belong to
  // an unsupported series (or none) and go to the expander with it. An
  // unsupported master under a kept series' UID is dropped as a duplicate.
  const kept: ICAL.Component[] = [];
  const leftover: ICAL.Component[] = [];
  for (const c of overrides) (series.has(String(c.getFirstPropertyValue('uid'))) ? kept : leftover).push(c);
  for (const c of unsupported) if (!series.has(String(c.getFirstPropertyValue('uid')))) leftover.push(c);
  if (leftover.length) {
    const cal = new ICAL.Component('vcalendar');
    for (const prop of root.getAllProperties()) cal.addProperty(prop);
    for (const vtz of zones) cal.addSubcomponent(vtz);
    for (const comp of leftover) cal.addSubcomponent(comp);
    fixed.push(...parseIcs(cal.toString(), feedId, rangeStart, rangeEnd));
  }
  // A moved or changed occurrence: the series skips its original start and the
  // override stays as a one-off event (wherever it falls, not only in range).
  const oneOffs: ParsedEvent[] = [];
  for (const comp of kept) {
    const uid = comp.getFirstPropertyValue('uid');
    const s = typeof uid === 'string' ? series.get(uid) : undefined;
    if (!s) continue;
    try {
      const rid = comp.getFirstPropertyValue('recurrence-id') as ICAL.Time;
      const floating = s.tzid ?? 'UTC';
      const dtstart = new ICAL.Event(comp).startDate;
      s.exdates = [...(s.exdates ?? []), new Date(exdateInstant(rid, tzidOf(comp, 'recurrence-id'), floating, s.allDay, dtstart))];
      const one = oneOffFrom(comp, feedId, s);
      if (one) oneOffs.push(one);
    } catch {
      /* skip a malformed override */
    }
  }
  return [...fixed, ...series.values(), ...oneOffs].sort((a, b) => a.start.getTime() - b.start.getTime());
}
