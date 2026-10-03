import { MS_PER_DAY } from './time';

// Typed dates and times, shared by search (operators, jump-to-date) and the
// add-event quick entry. Everything here is pure: `todayMs` is the UTC midnight
// of "today" (the app's day convention, see today.svelte.ts), and a parsed date
// comes back as a UTC midnight too. English words only; numbers work in any
// locale.

// Day/month order for slash/dot dates (`9/10`): follows the date-format setting.
export type DateOrder = 'dmy' | 'mdy';

export type Clock = { h: number; m: number };

export function dateOrderFor(format: string): DateOrder {
  return format === 'MM/DD/YYYY' ? 'mdy' : 'dmy';
}

// The viewer's own calendar day, as a UTC midnight: what "today" means when
// they type it.
export function localDayMs(now: Date = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const UNIT_DAYS: Record<string, number> = { d: 1, day: 1, days: 1, w: 7, wk: 7, week: 7, weeks: 7 };
const UNIT_MONTHS: Record<string, number> = { m: 1, mo: 1, month: 1, months: 1, y: 12, yr: 12, year: 12, years: 12 };

function utc(y: number, m: number, d: number): number | null {
  const ms = Date.UTC(y, m, d);
  const back = new Date(ms);
  // Reject roll-overs such as 31 Feb.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m || back.getUTCDate() !== d) return null;
  return ms;
}

function addMonthsUtc(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

function dayNumber(tok: string): number | null {
  const m = /^(\d{1,2})(?:st|nd|rd|th)?,?$/.exec(tok);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 31 ? n : null;
}

function yearNumber(tok: string | undefined): number | null {
  if (!tok || !/^\d{4}$/.test(tok)) return null;
  return Number(tok);
}

// A day and month with no year: this year's, or next year's once it has passed.
function upcoming(todayMs: number, month: number, day: number): number | null {
  const y = new Date(todayMs).getUTCFullYear();
  const ms = utc(y, month, day);
  if (ms != null && ms >= todayMs) return ms;
  return utc(y + 1, month, day);
}

export type DateMatch = { ms: number; length: number };

// Match a date starting at tokens[i] (lower-cased, whitespace-split). Returns
// the day and how many tokens it used, or null. Forms: today / tomorrow /
// yesterday, weekday names ("fri" is the coming Friday, today included; "next
// fri" the one a week after), 2026-10-09, 9/10 and 9.10(.2026) in the setting's
// order, "9 oct" / "oct 9th" (optionally with a year), +3d / -2w / +1m / +1y and
// "in 3 days". With `loose`, also a bare month ("march"), year-month
// ("2027-03") and year ("2027") — fine for a whole search query, too eager
// inside a sentence.
export function matchDate(
  tokens: readonly string[],
  i: number,
  todayMs: number,
  order: DateOrder,
  loose = false,
): DateMatch | null {
  const t = tokens[i];
  if (t == null) return null;
  const word = t.replace(/,$/, '');

  if (word === 'today') return { ms: todayMs, length: 1 };
  if (word === 'tomorrow' || word === 'tmr' || word === 'tmrw') return { ms: todayMs + MS_PER_DAY, length: 1 };
  if (word === 'yesterday') return { ms: todayMs - MS_PER_DAY, length: 1 };

  const weekday = (w: string | undefined): number | null =>
    w != null && w.replace(/,$/, '') in WEEKDAYS ? WEEKDAYS[w.replace(/,$/, '')]! : null;
  const dow = new Date(todayMs).getUTCDay();
  if (word === 'next' || word === 'this') {
    const wd = weekday(tokens[i + 1]);
    if (wd != null) {
      const ahead = (wd - dow + 7) % 7;
      return { ms: todayMs + (ahead + (word === 'next' ? 7 : 0)) * MS_PER_DAY, length: 2 };
    }
    if (word === 'next' && (tokens[i + 1] === 'week' || tokens[i + 1] === 'month' || tokens[i + 1] === 'year')) {
      const u = tokens[i + 1]!;
      if (u === 'week') return { ms: todayMs + 7 * MS_PER_DAY, length: 2 };
      return { ms: addMonthsUtc(todayMs, u === 'month' ? 1 : 12), length: 2 };
    }
    return null;
  }
  const wd = weekday(word);
  if (wd != null) return { ms: todayMs + ((wd - dow + 7) % 7) * MS_PER_DAY, length: 1 };

  // ISO 2026-10-09, and (loose) 2027-03 / 2027.
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(word);
  if (m) {
    const ms = utc(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return ms == null ? null : { ms, length: 1 };
  }
  if (loose) {
    m = /^(\d{4})-(\d{1,2})$/.exec(word);
    if (m) {
      const ms = utc(Number(m[1]), Number(m[2]) - 1, 1);
      return ms == null ? null : { ms, length: 1 };
    }
    const y = yearNumber(word);
    if (y != null && y >= 1900 && y <= 2199) return { ms: Date.UTC(y, 0, 1), length: 1 };
  }

  // 9/10, 9.10, 9/10/2026, 9.10.26
  m = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/.exec(word);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [day, month] = order === 'mdy' ? [b, a] : [a, b];
    if (month < 1 || month > 12) return null;
    let ms: number | null;
    if (m[3]) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      ms = utc(y, month - 1, day);
    } else {
      ms = upcoming(todayMs, month - 1, day);
    }
    return ms == null ? null : { ms, length: 1 };
  }

  // +3d, -2w, +1m, +1y
  m = /^([+-])(\d{1,3})([a-z]+)$/.exec(word);
  if (m) {
    const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    if (m[3]! in UNIT_DAYS) return { ms: todayMs + n * UNIT_DAYS[m[3]!]! * MS_PER_DAY, length: 1 };
    if (m[3]! in UNIT_MONTHS) return { ms: addMonthsUtc(todayMs, n * UNIT_MONTHS[m[3]!]!), length: 1 };
    return null;
  }

  // in 3 days / in 2 weeks / in 1 month
  if (word === 'in' && tokens[i + 1] && /^\d{1,3}$/.test(tokens[i + 1]!)) {
    const n = Number(tokens[i + 1]);
    const unit = (tokens[i + 2] ?? '').replace(/,$/, '');
    if (unit in UNIT_DAYS && unit.length > 1) return { ms: todayMs + n * UNIT_DAYS[unit]! * MS_PER_DAY, length: 3 };
    if (unit in UNIT_MONTHS && unit.length > 1) return { ms: addMonthsUtc(todayMs, n * UNIT_MONTHS[unit]!), length: 3 };
    return null;
  }

  // 9 oct (2026) / oct 9th (2026)
  const d1 = dayNumber(word);
  if (d1 != null) {
    const mon = tokens[i + 1]?.replace(/[.,]$/, '');
    if (mon != null && mon in MONTHS) {
      const y = yearNumber(tokens[i + 2]);
      const ms = y != null ? utc(y, MONTHS[mon]!, d1) : upcoming(todayMs, MONTHS[mon]!, d1);
      return ms == null ? null : { ms, length: y != null ? 3 : 2 };
    }
    return null;
  }
  const monWord = word.replace(/\.$/, '');
  if (monWord in MONTHS) {
    const d2 = tokens[i + 1] != null ? dayNumber(tokens[i + 1]!) : null;
    if (d2 != null) {
      const y = yearNumber(tokens[i + 2]);
      const ms = y != null ? utc(y, MONTHS[monWord]!, d2) : upcoming(todayMs, MONTHS[monWord]!, d2);
      return ms == null ? null : { ms, length: y != null ? 3 : 2 };
    }
    if (loose) {
      const y = yearNumber(tokens[i + 1]);
      if (y != null) return { ms: Date.UTC(y, MONTHS[monWord]!, 1), length: 2 };
      return { ms: upcoming(todayMs, MONTHS[monWord]!, 1) ?? todayMs, length: 1 };
    }
  }
  return null;
}

// A whole string that is nothing but a date (loose forms allowed), or null.
export function parseDateQuery(text: string, todayMs: number, order: DateOrder): number | null {
  const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const match = matchDate(tokens, 0, todayMs, order, true);
  return match && match.length === tokens.length ? match.ms : null;
}

// One clock time: 13:00, 9:30, 1pm, 10:30am, 9.30am, noon, midnight. A bare
// number ("13") only counts with `bare` (inside a range or after "at").
type ClockMatch = Clock & { meridiem: 'am' | 'pm' | null };

function parseClock(tok: string, bare: boolean): ClockMatch | null {
  const t = tok.replace(/,$/, '');
  if (t === 'noon') return { h: 12, m: 0, meridiem: null };
  if (t === 'midnight') return { h: 0, m: 0, meridiem: null };
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] != null ? Number(m[2]) : 0;
  const mer = m[3] ? (m[3].startsWith('a') ? 'am' : 'pm') : null;
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    return { h: (h % 12) + (mer === 'pm' ? 12 : 0), m: min, meridiem: mer };
  }
  // Without am/pm a time needs a colon (13:00) unless the caller allows bare
  // hours; a dot alone (9.30) is too easily a date.
  if (m[2] == null && !bare) return null;
  if (m[2] != null && t.includes('.')) return null;
  if (h > 23) return null;
  return { h, m: min, meridiem: null };
}

export type TimeMatch = { start: Clock; end: Clock | null; length: number };

const RANGE_SEP = /^(?:-|–|—|to|till|until)$/;

// Match a time or a time range at tokens[i]: "13:00", "at 3pm", "13-14",
// "9:30–11", "1-2pm", "10am - 12pm", "14:00 to 15:30". An unmarked start takes
// the end's am/pm when that keeps it before the end ("11-1pm" is 11am–1pm).
// A bare range of small hours reads as afternoon ("6-8" is 18:00–20:00).
export function matchTime(tokens: readonly string[], i: number): TimeMatch | null {
  let at = i;
  let lead = 0;
  if (tokens[at] === 'at') {
    at++;
    lead = 1;
  }
  const tok = tokens[at];
  if (tok == null) return null;

  // Range in one token: 13-14, 1-2pm, 9:30–11
  const one = /^([^-–—]+)[-–—]([^-–—]+)$/.exec(tok.replace(/,$/, ''));
  if (one) {
    const r = resolveRange(one[1]!, one[2]!);
    if (r) return { ...r, length: lead + 1 };
  }
  // Range over three tokens: 10am - 12pm, 14:00 to 15:30
  if (tokens[at + 1] != null && RANGE_SEP.test(tokens[at + 1]!) && tokens[at + 2] != null) {
    const r = resolveRange(tok, tokens[at + 2]!);
    if (r) return { ...r, length: lead + 3 };
  }
  const single = parseClock(tok, lead > 0);
  if (!single) return null;
  return { start: { h: single.h, m: single.m }, end: null, length: lead + 1 };
}

function resolveRange(a: string, b: string): { start: Clock; end: Clock } | null {
  const end = parseClock(b, true);
  const start = parseClock(a, true);
  if (!start || !end) return null;
  // Both bare hours with nothing to anchor them must at least look like times.
  if (start.meridiem == null && !a.includes(':') && end.meridiem == null && !b.includes(':')) {
    if (start.h > 23 || end.h > 24) return null;
    if (start.h < 7 && end.h <= 12 && start.h < end.h) {
      return { start: { h: start.h + 12, m: start.m }, end: { h: end.h + 12, m: end.m } };
    }
  }
  if (start.meridiem == null && end.meridiem != null && start.h <= 12) {
    const raw = start.h % 12;
    const same = raw + (end.meridiem === 'pm' ? 12 : 0);
    const startMin = same * 60 + start.m;
    const endMin = end.h * 60 + end.m;
    const h = startMin <= endMin ? same : raw + (end.meridiem === 'pm' ? 0 : 12);
    return { start: { h, m: start.m }, end: { h: end.h, m: end.m } };
  }
  return { start: { h: start.h, m: start.m }, end: { h: end.h, m: end.m } };
}

// "for 30m", "for 2h", "for 1h30", "for 90 min", "for 1.5h"
export function matchDuration(tokens: readonly string[], i: number): { minutes: number; length: number } | null {
  if (tokens[i] !== 'for' || tokens[i + 1] == null) return null;
  const tok = tokens[i + 1]!.replace(/,$/, '');
  let m = /^(\d+(?:\.\d+)?)(h|hr|hrs|hours?)$/.exec(tok);
  if (m) return { minutes: Math.round(Number(m[1]) * 60), length: 2 };
  m = /^(\d+)(m|min|mins|minutes?)$/.exec(tok);
  if (m) return { minutes: Number(m[1]), length: 2 };
  m = /^(\d+)h(\d{1,2})m?$/.exec(tok);
  if (m) return { minutes: Number(m[1]) * 60 + Number(m[2]), length: 2 };
  if (/^\d+(?:\.\d+)?$/.test(tok) && tokens[i + 2] != null) {
    const unit = tokens[i + 2]!.replace(/,$/, '');
    const n = Number(tok);
    if (/^(h|hr|hrs|hours?)$/.test(unit)) return { minutes: Math.round(n * 60), length: 3 };
    if (/^(m|min|mins|minutes?)$/.test(unit)) return { minutes: Math.round(n), length: 3 };
  }
  return null;
}
