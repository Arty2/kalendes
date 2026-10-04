import type { FeedCategory, ParsedEvent } from './types';
import { FEED_CATEGORIES, SCRATCHPAD_FEED_ID } from './types';
import { snippetFromText } from './format';
import { safeHref } from './event-display';
import { isValidTimezone, parseRRule } from './recurrence';
import { offsetMinutes, zonedParts } from './format';

export const SCRATCHPAD_KEY = 'calendar-timeline:scratchpad';

// The Draft lane keeps the original key for backward compatibility; every other
// local lane (imported .ics) gets a suffixed key.
function keyForLane(id: string): string {
  return id === 'default' ? SCRATCHPAD_KEY : SCRATCHPAD_KEY + ':' + id;
}

export type SerializedScratchEvent = {
  uid: string;
  title: string;
  description: string;
  descriptionSnippet: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  url?: string;
  category?: FeedCategory;
  cancelled?: boolean;
  // iCal revision (see ParsedEvent). Missing in lanes saved before it existed,
  // which read back as sequence 0 / no LAST-MODIFIED.
  sequence?: number;
  lastModified?: string;
  // A repeating series (see ParsedEvent): RRULE value, skipped starts (ISO),
  // and the zone a timed series repeats in.
  rrule?: string;
  exdates?: string[];
  tzid?: string;
  // Legacy (pre-merge) per-event travel tag; migrated into `category` on load.
  travel?: 'international' | 'local' | 'none';
};

export function loadScratchpad(id: string = 'default'): ParsedEvent[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(keyForLane(id));
  if (!raw) return [];
  try {
    const { events, assignedUid } = deserializeScratchEvents(JSON.parse(raw), 'scratchpad:' + id);
    // The uid is the exported iCal UID, so it must survive every load: an entry
    // stored without one gets a fresh uid once, written straight back, rather
    // than a new one on every load (which would duplicate it on each re-import).
    if (assignedUid) saveScratchpad(events, id);
    return events;
  } catch {
    return [];
  }
}

// The stored lane format, shared with config export files (storage.ts), which
// carry each local lane whole — uids and revisions included — so a restore is
// the same lane, not a copy. Non-arrays read as an empty lane.
export function deserializeScratchEvents(
  parsed: unknown,
  feedId: string,
): { events: ParsedEvent[]; assignedUid: boolean } {
  if (!Array.isArray(parsed)) return { events: [], assignedUid: false };
  let assignedUid = false;
  const events: ParsedEvent[] = parsed
    .filter((e): e is SerializedScratchEvent => e && typeof e === 'object')
    .map((e) => {
      let cat = typeof e.category === 'string' && (FEED_CATEGORIES as string[]).includes(e.category)
        ? (e.category as FeedCategory)
        : undefined;
      // Legacy per-event travel tag → event type.
      if (e.travel === 'international') cat = 'travel-international';
      else if (e.travel === 'local') cat = 'travel-local';
      let uid = typeof e.uid === 'string' ? e.uid : e.uid == null ? '' : String(e.uid);
      if (!uid) {
        uid = newUid();
        assignedUid = true;
      }
      const sequence =
        typeof e.sequence === 'number' && Number.isInteger(e.sequence) && e.sequence > 0
          ? e.sequence
          : 0;
      const lastModified = typeof e.lastModified === 'string' ? new Date(e.lastModified) : null;
      // A rule this build can't expand would show as a lone first occurrence,
      // so only a parseable one is kept.
      const rrule = typeof e.rrule === 'string' && parseRRule(e.rrule) ? e.rrule : undefined;
      const exdates = rrule && Array.isArray(e.exdates)
        ? e.exdates.map((x) => new Date(String(x))).filter((d) => !isNaN(d.getTime()))
        : [];
      const tzid = rrule && isValidTimezone(e.tzid) ? e.tzid : undefined;
      return {
        uid,
        feedId,
        title: String(e.title ?? ''),
        description: String(e.description ?? ''),
        descriptionSnippet: String(e.descriptionSnippet ?? ''),
        location: String(e.location ?? ''),
        start: new Date(e.start),
        end: new Date(e.end),
        allDay: Boolean(e.allDay),
        // Only keep a stored URL if it has a safe scheme — an older build (or a
        // hand-edited localStorage) could hold a `javascript:` value that the
        // event modal would otherwise render as a clickable href.
        ...(safeHref(e.url) ? { url: safeHref(e.url)! } : {}),
        ...(cat ? { category: cat } : {}),
        ...(e.cancelled === true ? { cancelled: true } : {}),
        ...(sequence > 0 ? { sequence } : {}),
        ...(lastModified && !isNaN(lastModified.getTime()) ? { lastModified } : {}),
        ...(rrule ? { rrule } : {}),
        ...(exdates.length ? { exdates } : {}),
        ...(tzid ? { tzid } : {}),
      };
    });
  return { events, assignedUid };
}

export function serializeScratchEvents(events: ParsedEvent[]): SerializedScratchEvent[] {
  return events.map((e) => ({
    uid: e.uid,
    title: e.title,
    description: e.description,
    descriptionSnippet: e.descriptionSnippet,
    location: e.location,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    allDay: e.allDay,
    ...(e.url ? { url: e.url } : {}),
    ...(e.category ? { category: e.category } : {}),
    ...(e.cancelled ? { cancelled: true } : {}),
    ...(e.sequence ? { sequence: e.sequence } : {}),
    ...(e.lastModified ? { lastModified: e.lastModified.toISOString() } : {}),
    ...(e.rrule ? { rrule: e.rrule } : {}),
    ...(e.rrule && e.exdates?.length ? { exdates: e.exdates.map((d) => d.toISOString()) } : {}),
    ...(e.rrule && e.tzid ? { tzid: e.tzid } : {}),
  }));
}

export function saveScratchpad(events: ParsedEvent[], id: string = 'default'): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(keyForLane(id), JSON.stringify(serializeScratchEvents(events)));
  } catch {
    /* storage full or unavailable */
  }
}

export function clearScratchpad(id: string = 'default'): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(keyForLane(id));
  } catch {
    /* ignore */
  }
}

export function newUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'scratch:' + crypto.randomUUID();
  }
  return 'scratch:' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export type ScratchpadInput = {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  category?: FeedCategory;
  // A repeating series: its RRULE and, for a timed one, the zone it repeats in.
  rrule?: string;
  tzid?: string;
};

export function makeScratchpadEvent(input: ScratchpadInput): ParsedEvent {
  const description = input.description ?? '';
  return {
    uid: newUid(),
    feedId: SCRATCHPAD_FEED_ID,
    title: input.title,
    description,
    descriptionSnippet: snippetFromText(description),
    location: input.location ?? '',
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    ...(input.category && input.category !== 'none' ? { category: input.category } : {}),
    ...(input.rrule ? { rrule: input.rrule } : {}),
    ...(input.rrule && input.tzid && !input.allDay ? { tzid: input.tzid } : {}),
  };
}

// The fields an .ics export carries for an event — what counts as an edit.
function sameContent(a: ParsedEvent, b: ParsedEvent): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.location === b.location &&
    a.start.getTime() === b.start.getTime() &&
    a.end.getTime() === b.end.getTime() &&
    a.allDay === b.allDay &&
    (a.url ?? '') === (b.url ?? '') &&
    (a.category ?? '') === (b.category ?? '') &&
    (a.rrule ?? '') === (b.rrule ?? '') &&
    (a.tzid ?? '') === (b.tzid ?? '') &&
    exdateKey(a) === exdateKey(b)
  );
}

function exdateKey(e: ParsedEvent): string {
  return (e.exdates ?? []).map((d) => d.getTime()).sort((x, y) => x - y).join(',');
}

/**
 * `next` as the edited revision of `prev`: same uid, SEQUENCE one higher and
 * LAST-MODIFIED now — so another calendar app that imported the earlier export
 * treats the re-export as an update of the same event. A save that changed
 * nothing keeps `prev`'s revision, so re-saving doesn't churn the sequence.
 */
export function reviseEvent<T extends ParsedEvent>(prev: ParsedEvent, next: T, now: Date = new Date()): T {
  const out: T = { ...next, uid: prev.uid };
  delete out.sequence;
  delete out.lastModified;
  if (sameContent(prev, next)) {
    return {
      ...out,
      ...(prev.sequence ? { sequence: prev.sequence } : {}),
      ...(prev.lastModified ? { lastModified: prev.lastModified } : {}),
    };
  }
  return { ...out, sequence: (prev.sequence ?? 0) + 1, lastModified: now };
}

// --- ICS import/export helpers ---

export function isIcsText(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(text);
}

// Read the calendar's display name (X-WR-CALNAME) if the file declares one,
// unfolding RFC 5545 line continuations first.
export function calNameFromIcs(text: string): string | null {
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const m = unfolded.match(/^X-WR-CALNAME(?:;[^:\r\n]*)?:(.+)$/im);
  if (!m) return null;
  const name = m[1]
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
  return name || null;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function icsDate(d: Date): string {
  return pad(d.getUTCFullYear(), 4) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
}

function icsDateTime(d: Date): string {
  return (
    icsDate(d) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'
  );
}

// `d`'s wall clock in `tz` as a floating DATE-TIME, for a TZID-qualified value.
function icsZonedDateTime(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return (
    pad(p.y, 4) + pad(p.m) + pad(p.d) + 'T' + pad(Math.floor(p.minutes / 60)) + pad(p.minutes % 60) +
    pad(d.getUTCSeconds())
  );
}

// Fold content lines to 75 octets per RFC 5545 (approximated on string length).
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    out.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return out.join('\r\n');
}

// RFC 5545 wants a VTIMEZONE for every TZID a file uses. Built from the
// browser's zone data, so it follows the zone's real history: every offset
// change from `fromYear` through next year is written as it happened (found
// by daily samples, narrowed to the minute), then —
// only if one yearly rule ("the last Sunday of March") reproduces the five
// years after that — the rule carries on open-ended; otherwise thirty more
// years are listed one by one (e.g. Israel's "Friday before the last Sunday").
// A zone without changes gets a single fixed STANDARD.
type ZoneChange = { at: number; from: number; to: number };

function zoneChanges(tz: string, year: number): ZoneChange[] {
  const DAY = 86_400_000;
  const off = (t: number): number => offsetMinutes(tz, new Date(t)) ?? 0;
  const out: ZoneChange[] = [];
  const end = Date.UTC(year + 1, 0, 1);
  let t = Date.UTC(year, 0, 1);
  let prev = off(t);
  // Daily samples (a change and its reversal within a week would cancel out
  // in coarser ones), then narrow each change to the minute.
  while (t < end) {
    const nextT = Math.min(t + DAY, end);
    if (off(nextT) !== prev) {
      let lo = t;
      let hi = nextT;
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
        if (off(mid) === prev) lo = mid;
        else hi = mid;
      }
      const to = off(hi);
      out.push({ at: hi, from: prev, to });
      prev = to;
      t = hi;
      continue;
    }
    t = nextT;
  }
  return out;
}

const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// A change's wall time on the clock before it, and its "nth weekday" rule.
function changeRule(c: ZoneChange): { local: Date; key: string; rrule: string } {
  const local = new Date(c.at + c.from * 60_000);
  const d = local.getUTCDate();
  const m = local.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(local.getUTCFullYear(), m, 0)).getUTCDate();
  const nth = d + 7 > lastDay ? -1 : Math.ceil(d / 7);
  const byday = `${nth}${ICS_DAYS[local.getUTCDay()]}`;
  const clock = pad(local.getUTCHours()) + pad(local.getUTCMinutes());
  return {
    local,
    key: `${m}/${byday}/${clock}/${c.from}/${c.to}`,
    rrule: `RRULE:FREQ=YEARLY;BYMONTH=${m};BYDAY=${byday}`,
  };
}

function vtimezoneLines(tz: string, fromYear: number, thisYear: number): string[] {
  const fmtOff = (m: number): string => (m < 0 ? '-' : '+') + pad(Math.floor(Math.abs(m) / 60)) + pad(Math.abs(m) % 60);
  const observance = (c: ZoneChange, rrule?: string): string[] => {
    const { local } = changeRule(c);
    const kind = c.to > c.from ? 'DAYLIGHT' : 'STANDARD';
    return [
      'BEGIN:' + kind,
      'DTSTART:' + icsDate(local) + 'T' + pad(local.getUTCHours()) + pad(local.getUTCMinutes()) + '00',
      ...(rrule ? [rrule] : []),
      'TZOFFSETFROM:' + fmtOff(c.from),
      'TZOFFSETTO:' + fmtOff(c.to),
      'END:' + kind,
    ];
  };
  const lines = ['BEGIN:VTIMEZONE', 'TZID:' + tz];
  // The offset in force from the first year's start, so nothing before its
  // first change is left uncovered.
  const startOff = offsetMinutes(tz, new Date(Date.UTC(fromYear, 0, 1))) ?? 0;
  lines.push('BEGIN:STANDARD', `DTSTART:${pad(fromYear, 4)}0101T000000`, 'TZOFFSETFROM:' + fmtOff(startOff), 'TZOFFSETTO:' + fmtOff(startOff), 'END:STANDARD');
  const lastListed = Math.max(fromYear, thisYear + 1);
  for (let y = fromYear; y <= lastListed; y++) for (const c of zoneChanges(tz, y)) lines.push(...observance(c));
  // Beyond that: one yearly rule per change, if the same rules hold for the
  // next five years; else list the years.
  const ahead = Array.from({ length: 5 }, (_, i) => zoneChanges(tz, lastListed + 1 + i));
  const keys = ahead.map((cs) => cs.map((c) => changeRule(c).key).join('|'));
  if (keys[0] && keys.every((k) => k === keys[0])) {
    for (const c of ahead[0]!) lines.push(...observance(c, changeRule(c).rrule));
  } else if (keys.some((k) => k)) {
    for (const cs of ahead) for (const c of cs) lines.push(...observance(c));
    for (let y = lastListed + 6; y <= lastListed + 30; y++) for (const c of zoneChanges(tz, y)) lines.push(...observance(c));
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

// Serialize local-lane events to an RFC 5545 VCALENDAR. A repeating series is
// one VEVENT with its RRULE / EXDATEs; a timed one is written on its zone's
// wall clock (DTSTART;TZID=…) so other apps repeat it across DST as we do.
export function eventsToIcs(events: ParsedEvent[], calName?: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//kalendes//local//EN', 'CALSCALE:GREGORIAN'];
  if (calName) lines.push('X-WR-CALNAME:' + escapeIcsText(calName));
  // One VTIMEZONE per zone a repeating timed event is written in, covering
  // from the year its earliest series starts.
  const zoneYears = new Map<string, number>();
  for (const ev of events) {
    if (!ev.rrule || ev.allDay || !ev.tzid || ev.tzid === 'UTC') continue;
    // The start's year on its own clock: a late-December start west of UTC
    // is already next year in UTC, which would leave it before the zone's
    // first observance.
    const y = zonedParts(ev.start, ev.tzid).y;
    zoneYears.set(ev.tzid, Math.min(zoneYears.get(ev.tzid) ?? y, y));
  }
  const thisYear = new Date().getUTCFullYear();
  for (const [tz, year] of zoneYears) lines.push(...vtimezoneLines(tz, year, thisYear));
  const dtstamp = icsDateTime(new Date());
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + escapeIcsText(ev.uid));
    lines.push('DTSTAMP:' + dtstamp);
    // SEQUENCE / LAST-MODIFIED make a re-export an update of the same UID.
    lines.push('SEQUENCE:' + (ev.sequence ?? 0));
    if (ev.lastModified) lines.push('LAST-MODIFIED:' + icsDateTime(ev.lastModified));
    const zone = ev.rrule && !ev.allDay && ev.tzid && ev.tzid !== 'UTC' ? ev.tzid : null;
    if (ev.allDay) {
      lines.push('DTSTART;VALUE=DATE:' + icsDate(ev.start));
      lines.push('DTEND;VALUE=DATE:' + icsDate(ev.end));
    } else if (zone) {
      lines.push(`DTSTART;TZID=${zone}:` + icsZonedDateTime(ev.start, zone));
      lines.push(`DTEND;TZID=${zone}:` + icsZonedDateTime(ev.end, zone));
    } else {
      lines.push('DTSTART:' + icsDateTime(ev.start));
      lines.push('DTEND:' + icsDateTime(ev.end));
    }
    if (ev.rrule) {
      lines.push('RRULE:' + ev.rrule.replace(/^RRULE:/i, ''));
      for (const x of ev.exdates ?? []) {
        if (ev.allDay) lines.push('EXDATE;VALUE=DATE:' + icsDate(x));
        else if (zone) lines.push(`EXDATE;TZID=${zone}:` + icsZonedDateTime(x, zone));
        else lines.push('EXDATE:' + icsDateTime(x));
      }
    }
    if (ev.title) lines.push('SUMMARY:' + escapeIcsText(ev.title));
    if (ev.description) lines.push('DESCRIPTION:' + escapeIcsText(ev.description));
    if (ev.location) lines.push('LOCATION:' + escapeIcsText(ev.location));
    if (ev.url) lines.push('URL:' + escapeIcsText(ev.url));
    if (ev.cancelled) lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

// Turn a lane name into a safe .ics filename, e.g. "My Trips!" -> "my-trips.ics".
export function exportLaneFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return (slug || 'calendar') + '.ics';
}
