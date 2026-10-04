// Repeating local events. A local lane stores a series once — its first
// occurrence plus an RFC 5545 RRULE, EXDATEs and the zone whose wall clock it
// repeats on — and the display pipeline expands it into occurrences over the
// timeline's window (state.svelte.ts). Occurrence ids are `seriesUid#r<startMs>`
// so every per-event action can find its way back to the series.
//
// The expander covers the rules calendars actually write (DAILY / WEEKLY /
// MONTHLY / YEARLY with INTERVAL, COUNT, UNTIL, BYDAY with ordinals,
// BYMONTHDAY, BYMONTH, BYSETPOS, WKST). Anything finer (BYHOUR, BYWEEKNO,
// BYYEARDAY, sub-daily FREQ) parses as unsupported, and an .ics import falls
// back to fixed copies for that series.
import type { ParsedEvent, Timezone } from './types';
import { zonedParts } from './format';
import { zonedWallToInstant } from './event-drag';
import { MS_PER_DAY } from './time';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

// wd follows Date#getUTCDay (0 = Sunday); n is the ordinal (0 = every).
export type ByDay = { n: number; wd: number };

export type RRule = {
  freq: Freq;
  interval: number;
  count?: number;
  // The raw UNTIL value (date or date-time); resolved per series.
  until?: string;
  byDay?: ByDay[];
  byMonthDay?: number[];
  byMonth?: number[];
  bySetPos?: number[];
  wkst: number;
};

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQS: Freq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

function intList(v: string, min: number, max: number, allowNegative: boolean): number[] | null {
  const out: number[] = [];
  for (const part of v.split(',')) {
    if (!/^[+-]?\d+$/.test(part)) return null;
    const n = parseInt(part, 10);
    if (n === 0 || Math.abs(n) > max || (n < 0 && !allowNegative) || (n > 0 && n < min)) return null;
    out.push(n);
  }
  return out;
}

/** Parse an RRULE value (with or without the `RRULE:` prefix); null when unsupported. */
export function parseRRule(raw: string): RRule | null {
  const s = raw.trim().replace(/^RRULE:/i, '');
  if (!s) return null;
  const rule: RRule = { freq: 'DAILY', interval: 1, wkst: 1 };
  let freq: Freq | null = null;
  for (const part of s.split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) return null;
    const key = part.slice(0, eq).toUpperCase();
    const val = part.slice(eq + 1).toUpperCase();
    switch (key) {
      case 'FREQ':
        if (!(FREQS as string[]).includes(val)) return null;
        freq = val as Freq;
        break;
      case 'INTERVAL': {
        const n = Number(val);
        if (!Number.isInteger(n) || n < 1 || n > 1000) return null;
        rule.interval = n;
        break;
      }
      case 'COUNT': {
        const n = Number(val);
        if (!Number.isInteger(n) || n < 1) return null;
        rule.count = n;
        break;
      }
      case 'UNTIL':
        if (!/^\d{8}(T\d{6}Z?)?$/.test(val)) return null;
        rule.until = val;
        break;
      case 'BYDAY': {
        const out: ByDay[] = [];
        for (const d of val.split(',')) {
          const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d);
          if (!m) return null;
          const n = m[1] ? parseInt(m[1], 10) : 0;
          if (Math.abs(n) > 53) return null;
          out.push({ n, wd: WEEKDAYS.indexOf(m[2]!) });
        }
        rule.byDay = out;
        break;
      }
      case 'BYMONTHDAY': {
        const l = intList(val, 1, 31, true);
        if (!l) return null;
        rule.byMonthDay = l;
        break;
      }
      case 'BYMONTH': {
        const l = intList(val, 1, 12, false);
        if (!l) return null;
        rule.byMonth = l;
        break;
      }
      case 'BYSETPOS': {
        const l = intList(val, 1, 366, true);
        if (!l) return null;
        rule.bySetPos = l;
        break;
      }
      case 'WKST': {
        const i = WEEKDAYS.indexOf(val);
        if (i < 0) return null;
        rule.wkst = i;
        break;
      }
      default:
        // BYHOUR / BYMINUTE / BYSECOND / BYWEEKNO / BYYEARDAY / X-…: not ours.
        return null;
    }
  }
  if (!freq) return null;
  rule.freq = freq;
  return rule;
}

// --- day-number calendar math (days since 1970-01-01, UTC) -----------------

type Ymd = { y: number; m: number; d: number };

function dayNum(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}
function ymdOf(dn: number): Ymd {
  const t = new Date(dn * MS_PER_DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function weekdayOf(dn: number): number {
  return (((dn + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// The days of [first, first + len) whose weekday is wd, then picked by ordinal.
function nthWeekday(first: number, len: number, { n, wd }: ByDay): number[] {
  const offset = (wd - weekdayOf(first) + 7) % 7;
  const all: number[] = [];
  for (let dn = first + offset; dn < first + len; dn += 7) all.push(dn);
  if (n === 0) return all;
  const pick = n > 0 ? all[n - 1] : all[all.length + n];
  return pick == null ? [] : [pick];
}

function monthDays(y: number, m: number, rule: RRule, d0: number): number[] {
  const first = dayNum(y, m, 1);
  const len = daysInMonth(y, m);
  let out: number[];
  if (rule.byMonthDay) {
    out = rule.byMonthDay
      .map((n) => (n > 0 ? n : len + 1 + n))
      .filter((d) => d >= 1 && d <= len)
      .map((d) => first + d - 1);
    // BYDAY alongside BYMONTHDAY only narrows (e.g. Friday the 13th).
    if (rule.byDay) {
      const wds = new Set(rule.byDay.map((b) => b.wd));
      out = out.filter((dn) => wds.has(weekdayOf(dn)));
    }
  } else if (rule.byDay) {
    out = rule.byDay.flatMap((b) => nthWeekday(first, len, b));
  } else {
    out = d0 <= len ? [first + d0 - 1] : [];
  }
  return out;
}

function sortedUnique(list: number[]): number[] {
  return [...new Set(list)].sort((a, b) => a - b);
}

function applySetPos(list: number[], setPos: number[] | undefined): number[] {
  if (!setPos) return list;
  const out: number[] = [];
  for (const p of setPos) {
    const v = p > 0 ? list[p - 1] : list[list.length + p];
    if (v != null) out.push(v);
  }
  return sortedUnique(out);
}

// The candidate days of period k (counted in INTERVAL steps from the series'
// first period), sorted. Also returns the first day of the period, which the
// caller uses to stop past the window.
function periodDays(rule: RRule, k: number, dn0: number, a: Ymd): { from: number; days: number[] } {
  const step = k * rule.interval;
  let from: number;
  let days: number[];
  switch (rule.freq) {
    case 'DAILY': {
      from = dn0 + step;
      const p = ymdOf(from);
      const ok =
        (!rule.byMonth || rule.byMonth.includes(p.m)) &&
        (!rule.byMonthDay ||
          rule.byMonthDay.some((n) => (n > 0 ? n : daysInMonth(p.y, p.m) + 1 + n) === p.d)) &&
        (!rule.byDay || rule.byDay.some((b) => b.wd === weekdayOf(from)));
      days = ok ? [from] : [];
      break;
    }
    case 'WEEKLY': {
      const week0 = dn0 - ((weekdayOf(dn0) - rule.wkst + 7) % 7);
      from = week0 + 7 * step;
      const wds = rule.byDay ? new Set(rule.byDay.map((b) => b.wd)) : new Set([weekdayOf(dn0)]);
      days = [];
      for (let dn = from; dn < from + 7; dn++) {
        if (!wds.has(weekdayOf(dn))) continue;
        if (rule.byMonth && !rule.byMonth.includes(ymdOf(dn).m)) continue;
        days.push(dn);
      }
      break;
    }
    case 'MONTHLY': {
      const mi = a.y * 12 + (a.m - 1) + step;
      const y = Math.floor(mi / 12);
      const m = (mi % 12) + 1;
      from = dayNum(y, m, 1);
      days = rule.byMonth && !rule.byMonth.includes(m) ? [] : monthDays(y, m, rule, a.d);
      break;
    }
    case 'YEARLY': {
      const y = a.y + step;
      from = dayNum(y, 1, 1);
      if (rule.byMonth) {
        days = rule.byMonth.flatMap((m) =>
          rule.byMonthDay || rule.byDay ? monthDays(y, m, rule, a.d) : a.d <= daysInMonth(y, m) ? [dayNum(y, m, a.d)] : [],
        );
      } else if (rule.byMonthDay) {
        days = Array.from({ length: 12 }, (_, i) => monthDays(y, i + 1, rule, a.d)).flat();
      } else if (rule.byDay) {
        const len = dayNum(y + 1, 1, 1) - from;
        days = rule.byDay.flatMap((b) => nthWeekday(from, len, b));
      } else {
        days = a.d <= daysInMonth(y, a.m) ? [dayNum(y, a.m, a.d)] : [];
      }
      break;
    }
  }
  return { from, days: applySetPos(sortedUnique(days), rule.bySetPos) };
}

// How many periods to skip so iteration starts just before `dn` (only valid
// without COUNT, which has to count from the first occurrence).
function periodsBefore(rule: RRule, dn0: number, a: Ymd, dn: number): number {
  let k = 0;
  switch (rule.freq) {
    case 'DAILY':
      k = Math.floor((dn - dn0) / rule.interval);
      break;
    case 'WEEKLY': {
      const week0 = dn0 - ((weekdayOf(dn0) - rule.wkst + 7) % 7);
      k = Math.floor((dn - week0) / (7 * rule.interval));
      break;
    }
    case 'MONTHLY': {
      const p = ymdOf(dn);
      k = Math.floor((p.y * 12 + p.m - (a.y * 12 + a.m)) / rule.interval);
      break;
    }
    case 'YEARLY':
      k = Math.floor((ymdOf(dn).y - a.y) / rule.interval);
      break;
  }
  return Math.max(0, k - 1);
}

/** Whether `tz` is a zone Intl knows (an IANA id, or UTC). */
// Memoised per zone: it runs per series on every expansion and per stored
// event on load, and constructing an Intl formatter each time is costly.
const tzValidity = new Map<string, boolean>();
export function isValidTimezone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  let ok = tzValidity.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    tzValidity.set(tz, ok);
  }
  return ok;
}

function untilMs(raw: string, allDay: boolean, tz: Timezone): number {
  const y = +raw.slice(0, 4);
  const m = +raw.slice(4, 6);
  const d = +raw.slice(6, 8);
  if (raw.length === 8) {
    // A date UNTIL includes that whole day.
    return allDay ? Date.UTC(y, m - 1, d) : zonedWallToInstant(y, m, d + 1, 0, tz).getTime() - 1;
  }
  const min = +raw.slice(9, 11) * 60 + +raw.slice(11, 13);
  const sec = +raw.slice(13, 15);
  if (raw.endsWith('Z')) return Date.UTC(y, m - 1, d, 0, min, sec);
  return zonedWallToInstant(y, m, d, min, tz).getTime() + sec * 1000;
}

/**
 * A series' skipped days carried through an edit of its start: each moves by
 * the same number of calendar days the start did and takes the new start's
 * time, on the series' own wall clock (so a DST change between them, or a
 * switch between all-day and timed, keeps them on their occurrences).
 */
export function moveExdates(
  prev: Pick<ParsedEvent, 'start' | 'allDay' | 'tzid' | 'exdates'>,
  next: Pick<ParsedEvent, 'start' | 'allDay' | 'tzid'>,
): Date[] {
  const prevTz: Timezone = !prev.allDay && isValidTimezone(prev.tzid) ? prev.tzid : 'UTC';
  const nextTz: Timezone = !next.allDay && isValidTimezone(next.tzid) ? next.tzid : 'UTC';
  const dayOf = (d: Date, allDay: boolean, tz: Timezone): number => {
    if (allDay) return Math.floor(d.getTime() / MS_PER_DAY);
    const p = zonedParts(d, tz);
    return dayNum(p.y, p.m, p.d);
  };
  const shift = dayOf(next.start, next.allDay, nextTz) - dayOf(prev.start, prev.allDay, prevTz);
  const minutes = next.allDay ? 0 : zonedParts(next.start, nextTz).minutes;
  const sub = next.allDay ? 0 : next.start.getTime() % 60_000;
  return (prev.exdates ?? []).map((x) => {
    const dn = dayOf(x, prev.allDay, prevTz) + shift;
    if (next.allDay) return new Date(dn * MS_PER_DAY);
    const p = ymdOf(dn);
    return new Date(zonedWallToInstant(p.y, p.m, p.d, minutes, nextTz).getTime() + sub);
  });
}

const OCC_SEP = '#r';

export function occurrenceUid(seriesUid: string, startMs: number): string {
  return seriesUid + OCC_SEP + startMs;
}

/** The series uid and start of an occurrence id, or null for a plain uid. */
export function splitOccurrenceUid(uid: string): { seriesUid: string; startMs: number } | null {
  const i = uid.lastIndexOf(OCC_SEP);
  if (i <= 0) return null;
  const tail = uid.slice(i + OCC_SEP.length);
  if (!/^-?\d+$/.test(tail)) return null;
  return { seriesUid: uid.slice(0, i), startMs: Number(tail) };
}

// Runaway guard: periods walked per series per expansion.
const MAX_PERIODS = 20_000;

/**
 * The occurrence starts of a series overlapping [rangeStart, rangeEnd] (ms),
 * EXDATEs removed. Timed series repeat on the wall clock of `ev.tzid` (UTC if
 * unset), so a 10:00 event stays at 10:00 across DST; all-day series repeat on
 * UTC calendar days.
 */
export function occurrenceStarts(ev: ParsedEvent, rangeStart: number, rangeEnd: number): number[] {
  const rule = ev.rrule ? parseRRule(ev.rrule) : null;
  const s0 = ev.start.getTime();
  const dur = Math.max(0, ev.end.getTime() - s0);
  const ex = new Set((ev.exdates ?? []).map((d) => d.getTime()));
  const out: number[] = [];
  const keep = (ms: number): void => {
    if (ms + dur >= rangeStart && ms <= rangeEnd && !ex.has(ms)) out.push(ms);
  };
  if (!rule) {
    keep(s0);
    return out;
  }
  const tz: Timezone = ev.allDay ? 'UTC' : isValidTimezone(ev.tzid) ? ev.tzid : 'UTC';
  const p0 = ev.allDay
    ? { y: ev.start.getUTCFullYear(), m: ev.start.getUTCMonth() + 1, d: ev.start.getUTCDate(), minutes: 0 }
    : zonedParts(ev.start, tz);
  const a: Ymd = { y: p0.y, m: p0.m, d: p0.d };
  const dn0 = dayNum(a.y, a.m, a.d);
  // Carry DTSTART's seconds onto every occurrence (wall times are minute-based).
  const sub = ev.allDay ? 0 : s0 - Math.floor(s0 / 60_000) * 60_000;
  const at = (dn: number): number => {
    if (ev.allDay) return dn * MS_PER_DAY;
    const p = ymdOf(dn);
    return zonedWallToInstant(p.y, p.m, p.d, p0.minutes, tz).getTime() + sub;
  };
  const until = rule.until ? untilMs(rule.until, ev.allDay, tz) : Infinity;
  // The last day an occurrence could start on and still be in range (+1 for
  // zone offsets), and the first worth walking from.
  const lastDn = Math.floor(rangeEnd / MS_PER_DAY) + 1;
  let produced = 1; // DTSTART is always the first instance, and counts
  keep(s0);
  if (rule.count === 1) return out;
  const firstDn = Math.floor((rangeStart - dur) / MS_PER_DAY) - 1;
  let k = rule.count ? 0 : periodsBefore(rule, dn0, a, firstDn);
  for (let walked = 0; walked < MAX_PERIODS; walked++, k++) {
    const { from, days } = periodDays(rule, k, dn0, a);
    if (from > lastDn) break;
    for (const dn of days) {
      if (dn <= dn0) continue;
      // A COUNT series walks from its start; repeats days before the window
      // only need counting, not their (Intl-heavy) zoned instant — unless an
      // UNTIL could end the series first.
      if (dn < firstDn && !rule.until) {
        produced++;
        if (rule.count && produced >= rule.count) return out;
        continue;
      }
      const ms = at(dn);
      if (ms > until) return out;
      produced++;
      keep(ms);
      if (rule.count && produced >= rule.count) return out;
    }
  }
  return out;
}

/**
 * A lane's events with every series expanded into its occurrences over the
 * range. Returns `events` itself when nothing in it repeats, so identity-keyed
 * caches downstream stay warm.
 */
export function expandLaneEvents(events: ParsedEvent[], rangeStart: number, rangeEnd: number): ParsedEvent[] {
  if (!events.some((e) => e.rrule)) return events;
  const out: ParsedEvent[] = [];
  for (const ev of events) {
    if (!ev.rrule) {
      out.push(ev);
      continue;
    }
    const dur = ev.end.getTime() - ev.start.getTime();
    for (const ms of occurrenceStarts(ev, rangeStart, rangeEnd)) {
      out.push({
        ...ev,
        uid: occurrenceUid(ev.uid, ms),
        seriesUid: ev.uid,
        start: new Date(ms),
        end: new Date(ms + dur),
      });
    }
  }
  return out.sort((x, y) => x.start.getTime() - y.start.getTime());
}

// --- the editor's repeat picker ----------------------------------------------

export type RepeatPreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export const REPEAT_PRESETS: RepeatPreset[] = ['none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly'];

const PRESET_RULES: Record<Exclude<RepeatPreset, 'none'>, string> = {
  daily: 'FREQ=DAILY',
  weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'FREQ=WEEKLY',
  biweekly: 'FREQ=WEEKLY;INTERVAL=2',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
};

// UNTIL as the YYYY-MM-DD day it ends on, read in the series' zone (a UTC
// date-time from a zoned series can fall on the next UTC day).
function untilDate(u: string, tz: Timezone): string {
  if (u.length === 8 || !u.endsWith('Z')) return `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
  const p = zonedParts(new Date(untilMs(u, false, 'UTC')), tz);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

function withoutUntil(rrule: string): string {
  return rrule
    .replace(/^RRULE:/i, '')
    .split(';')
    .filter((p) => p && !/^UNTIL=/i.test(p))
    .map((p) => p.toUpperCase())
    .sort()
    .join(';');
}

/**
 * Which picker entry a stored rule is, and its UNTIL as a YYYY-MM-DD date (in
 * the series' zone). 'custom' = a rule the picker can't build (COUNT, BYSETPOS,
 * an imported BYDAY…), kept as it is unless the user picks another entry.
 */
export function presetOf(rrule: string | undefined, tz: Timezone = 'UTC'): { preset: RepeatPreset | 'custom'; until: string } {
  if (!rrule) return { preset: 'none', until: '' };
  const rule = parseRRule(rrule);
  if (!rule) return { preset: 'custom', until: '' };
  const until = rule.until ? untilDate(rule.until, tz) : '';
  const key = withoutUntil(rrule);
  for (const preset of REPEAT_PRESETS) {
    if (preset !== 'none' && withoutUntil(PRESET_RULES[preset]) === key) return { preset, until };
  }
  return { preset: 'custom', until };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The RRULE for a picker entry, ending on `until` (YYYY-MM-DD, inclusive) when
 * given. A timed series' UNTIL is the end of that day in its zone, in UTC as
 * RFC 5545 requires next to a zoned DTSTART.
 */
export function buildRRule(preset: Exclude<RepeatPreset, 'none'>, until: string, allDay: boolean, tz: Timezone): string {
  const base = PRESET_RULES[preset];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until);
  if (!m) return base;
  const [y, mo, d] = [+m[1]!, +m[2]!, +m[3]!];
  if (allDay) return `${base};UNTIL=${m[1]}${m[2]}${m[3]}`;
  const t = new Date(zonedWallToInstant(y, mo, d + 1, 0, tz).getTime() - 1000);
  const stamp =
    t.getUTCFullYear() + pad2(t.getUTCMonth() + 1) + pad2(t.getUTCDate()) + 'T' +
    pad2(t.getUTCHours()) + pad2(t.getUTCMinutes()) + pad2(t.getUTCSeconds()) + 'Z';
  return `${base};UNTIL=${stamp}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(n: number): string {
  if (n === -1) return 'last';
  if (n < 0) return `${ordinal(-n)} to last`;
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return n + s;
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/**
 * A short English line for a rule — "Every week on Tuesday", "Every 2 months
 * on the last Friday", "Every weekday until 2026-12-31". `startDay` is the
 * series' first day (a UTC-midnight anchor), for rules that repeat on it.
 */
export function describeRRule(rrule: string, startDay: Date, tz: Timezone = 'UTC'): string {
  const rule = parseRRule(rrule);
  if (!rule) return 'Repeats';
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[rule.freq];
  let text = rule.interval > 1 ? `Every ${rule.interval} ${unit}s` : `Every ${unit}`;
  const plainDays = rule.byDay?.filter((b) => b.n === 0).map((b) => b.wd) ?? [];
  const weekdaysOnly =
    plainDays.length === 5 && [1, 2, 3, 4, 5].every((d) => plainDays.includes(d)) && rule.byDay!.length === 5;
  if (weekdaysOnly && rule.freq === 'WEEKLY' && rule.interval === 1 && !rule.bySetPos) {
    text = 'Every weekday';
  } else if (rule.freq === 'WEEKLY') {
    const wds = rule.byDay ? rule.byDay.map((b) => b.wd) : [startDay.getUTCDay()];
    const order = (d: number): number => (d + 6) % 7; // Monday first
    text += ' on ' + listJoin([...new Set(wds)].sort((x, y) => order(x) - order(y)).map((d) => DAY_NAMES[d]!));
  } else if (rule.freq === 'MONTHLY' || (rule.freq === 'YEARLY' && rule.byMonth)) {
    let on: string;
    if (rule.byMonthDay) on = 'the ' + listJoin(rule.byMonthDay.map((n) => (n === -1 ? 'last day' : ordinal(n))));
    else if (rule.byDay && rule.bySetPos) on = 'the ' + listJoin(rule.bySetPos.map(ordinal)) + ' ' + (weekdaysOnly ? 'weekday' : listJoin(rule.byDay.map((b) => DAY_NAMES[b.wd]!)));
    else if (rule.byDay) on = 'the ' + listJoin(rule.byDay.map((b) => (b.n ? ordinal(b.n) + ' ' : 'every ') + DAY_NAMES[b.wd]));
    else on = 'the ' + ordinal(startDay.getUTCDate());
    if (rule.freq === 'YEARLY') on += ' of ' + listJoin(rule.byMonth!.map((m) => MONTH_NAMES[m - 1]!));
    text += ' on ' + on;
  } else if (rule.freq === 'YEARLY') {
    text += ' on ' + MONTH_NAMES[startDay.getUTCMonth()] + ' ' + startDay.getUTCDate();
  }
  if (rule.count) text += rule.count === 1 ? ', once' : `, ${rule.count} times`;
  else if (rule.until) text += ' until ' + untilDate(rule.until, tz);
  return text;
}
