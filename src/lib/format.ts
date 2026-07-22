import type { DateFormat, Dst, Locale, TimeFormat, Timezone } from './types';
import { MS_PER_DAY, startOfDay } from './time';

// Intl.DateTimeFormat construction is expensive (~100µs); reuse instances
// across the hundreds of events formatted per render via a keyed cache.
const dtfCache = new Map<string, Intl.DateTimeFormat>();
export function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + '|' + JSON.stringify(options);
  let fmt = dtfCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options);
    dtfCache.set(key, fmt);
  }
  return fmt;
}

const MONTH_LONG: Record<Locale, string[]> = {
  en: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  el: [
    'Ιανουαριος', 'Φεβρουαριος', 'Μαρτιος', 'Απριλιος', 'Μαιος', 'Ιουνιος',
    'Ιουλιος', 'Αυγουστος', 'Σεπτεμβριος', 'Οκτωβριος', 'Νοεμβριος', 'Δεκεμβριος',
  ],
};

const MONTH_SHORT: Record<Locale, string[]> = {
  en: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  el: ['ΙΑΝ', 'ΦΕΒ', 'ΜΑΡ', 'ΑΠΡ', 'ΜΑΙ', 'ΙΟΥΝ', 'ΙΟΥΛ', 'ΑΥΓ', 'ΣΕΠ', 'ΟΚΤ', 'ΝΟΕ', 'ΔΕΚ'],
};

const DAY_INITIAL: Record<Locale, string[]> = {
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  el: ['Κ', 'Δ', 'Τ', 'Τ', 'Π', 'Π', 'Σ'],
};

const DAY_LONG: Record<Locale, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  el: ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'],
};

export function formatMonth(d: Date, locale: Locale, length: 'long' | 'short' = 'short'): string {
  const m = d.getUTCMonth();
  const table = length === 'long' ? MONTH_LONG : MONTH_SHORT;
  return table[locale][m] ?? '';
}

export function formatDayInitial(d: Date, locale: Locale): string {
  return DAY_INITIAL[locale][d.getUTCDay()] ?? '';
}

export function formatWeekday(d: Date, locale: Locale): string {
  return DAY_LONG[locale][d.getUTCDay()] ?? '';
}

export function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function formatDate(d: Date, format: DateFormat, locale: Locale): string {
  const day = pad(d.getUTCDate());
  const monthNum = pad(d.getUTCMonth() + 1);
  const monthName = formatMonth(d, locale, 'short');
  const year = String(d.getUTCFullYear());
  switch (format) {
    case 'YYYY-MM-DD':
      return year + '-' + monthNum + '-' + day;
    case 'DD MMM YYYY':
      return day + ' ' + monthName + ' ' + year;
    case 'DD.MM.YYYY':
      return day + '.' + monthNum + '.' + year;
    case 'MM/DD/YYYY':
      return monthNum + '/' + day + '/' + year;
  }
}

export function formatDateLong(d: Date, locale: Locale): string {
  const weekday = formatWeekday(d, locale);
  const day = d.getUTCDate();
  const month = formatMonth(d, locale, 'long');
  const year = d.getUTCFullYear();
  return weekday + ', ' + day + ' ' + month + ' ' + year;
}

export function endDayInclusive(start: Date, end: Date): Date {
  const ms = end.getTime() - 1;
  if (ms <= start.getTime()) return start;
  return new Date(ms);
}

export function durationDays(start: Date, end: Date): number {
  const last = endDayInclusive(start, end);
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  return Math.max(1, Math.round((endDay - startDay) / MS_PER_DAY) + 1);
}

export function formatRange(
  start: Date,
  end: Date,
  format: DateFormat,
  locale: Locale,
): string {
  const last = endDayInclusive(start, end);
  const sameDay =
    start.getUTCFullYear() === last.getUTCFullYear() &&
    start.getUTCMonth() === last.getUTCMonth() &&
    start.getUTCDate() === last.getUTCDate();
  if (sameDay) {
    return formatDate(start, format, locale);
  }
  const sameYear = start.getUTCFullYear() === last.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === last.getUTCMonth();
  const dash = ' — ';

  if (format === 'YYYY-MM-DD') {
    if (sameMonth) {
      const head = formatDate(start, format, locale);
      return head + dash + pad(last.getUTCDate());
    }
    return formatDate(start, format, locale) + dash + formatDate(last, format, locale);
  }

  if (format === 'DD MMM YYYY') {
    const sd = pad(start.getUTCDate());
    const ed = pad(last.getUTCDate());
    const sm = formatMonth(start, locale, 'short');
    const em = formatMonth(last, locale, 'short');
    const sy = String(start.getUTCFullYear());
    const ey = String(last.getUTCFullYear());
    if (sameMonth) return sd + dash + ed + ' ' + sm + ' ' + sy;
    if (sameYear) return sd + ' ' + sm + dash + ed + ' ' + em + ' ' + sy;
    return sd + ' ' + sm + ' ' + sy + dash + ed + ' ' + em + ' ' + ey;
  }

  if (format === 'DD.MM.YYYY') {
    const sd = pad(start.getUTCDate());
    const ed = pad(last.getUTCDate());
    const sm = pad(start.getUTCMonth() + 1);
    const em = pad(last.getUTCMonth() + 1);
    const sy = String(start.getUTCFullYear());
    const ey = String(last.getUTCFullYear());
    if (sameMonth) return sd + dash + ed + '.' + sm + '.' + sy;
    if (sameYear) return sd + '.' + sm + dash + ed + '.' + em + '.' + sy;
    return sd + '.' + sm + '.' + sy + dash + ed + '.' + em + '.' + ey;
  }

  if (format === 'MM/DD/YYYY') {
    const sd = pad(start.getUTCDate());
    const ed = pad(last.getUTCDate());
    const sm = pad(start.getUTCMonth() + 1);
    const em = pad(last.getUTCMonth() + 1);
    const sy = String(start.getUTCFullYear());
    const ey = String(last.getUTCFullYear());
    if (sameMonth) return sm + '/' + sd + dash + ed + '/' + sy;
    if (sameYear) return sm + '/' + sd + dash + em + '/' + ed + '/' + sy;
    return sm + '/' + sd + '/' + sy + dash + em + '/' + ed + '/' + ey;
  }

  return formatDate(start, format, locale) + dash + formatDate(last, format, locale);
}

function timezoneFor(tz: Timezone): string | undefined {
  if (tz === 'local') return undefined;
  return tz;
}

export function formatTime(d: Date, format: TimeFormat, tz: Timezone): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: format === '12h',
    timeZone: timezoneFor(tz),
  };
  const tag = format === '24h' ? 'en-GB' : 'en-US';
  return dtf(tag, options).format(d).replace(/\s+/g, ' ').trim();
}

export function formatUtcOffset(tz: string, at: Date = new Date(), dst: Dst = 'auto'): string {
  return offsetForTimezone(tz, at, dst);
}

// Short relative label for an upcoming event, calendar-day-first: events two or
// more calendar days out read as "IN N DAYS", the next day as "TOMORROW", and
// today as a soon-bucket (IN N MIN under an hour, IN NH up to HOURS_LABEL_MAX
// hours) or plain "TODAY" further out. Calendar boundaries use the local day,
// matching how the rest of the relative logic reads.
const HOURS_LABEL_MAX = 8;
export function formatNextRelative(start: Date, nowMs: number): string {
  const dayDiff = Math.round(
    (startOfDay(start).getTime() - startOfDay(new Date(nowMs)).getTime()) / MS_PER_DAY,
  );
  if (dayDiff >= 2) return `IN ${dayDiff} DAYS`;
  if (dayDiff === 1) return 'TOMORROW';
  const diffMs = start.getTime() - nowMs;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 60) return `IN ${Math.max(diffMin, 1)} MIN`;
  const diffHr = Math.round(diffMs / 3_600_000);
  if (diffHr <= HOURS_LABEL_MAX) return `IN ${diffHr}H`;
  return 'TODAY';
}

function rawOffsetMinutes(tz: string, at: Date = new Date()): number | null {
  try {
    const parts = dtf('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(at);
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (!raw) return null;
    if (raw === 'GMT' || raw === 'UTC') return 0;
    const m = raw.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
    if (!m) return null;
    const signMul = m[1]!.startsWith('-') ? -1 : 1;
    const hours = Math.abs(parseInt(m[1]!, 10));
    const mins = m[2] ? Number(m[2]) : 0;
    return signMul * (hours * 60 + mins);
  } catch {
    return null;
  }
}

// UTC offset (minutes) for a zone. With dst='auto' (default) this is the real
// offset at `at`. With 'on'/'off' the offset is resolved per zone to that zone's
// own daylight (max) or standard (min) offset — sampling January and July so the
// override is correct across US/EU non-alignment and southern-hemisphere flips,
// and a no-op for zones that don't observe DST.
export function offsetMinutes(tz: string, at: Date = new Date(), dst: Dst = 'auto'): number | null {
  const auto = rawOffsetMinutes(tz, at);
  if (dst === 'auto' || auto == null) return auto;
  const y = at.getUTCFullYear();
  const jan = rawOffsetMinutes(tz, new Date(Date.UTC(y, 0, 1)));
  const jul = rawOffsetMinutes(tz, new Date(Date.UTC(y, 6, 1)));
  if (jan == null || jul == null || jan === jul) return auto; // zone has no DST
  return dst === 'on' ? Math.max(jan, jul) : Math.min(jan, jul);
}

function offsetForTimezone(tz: string, at: Date = new Date(), dst: Dst = 'auto'): string {
  const total = offsetMinutes(tz, at, dst);
  if (total == null) return '';
  const sign = total < 0 ? '-' : '+';
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return mins === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${pad(mins)}`;
}

export function formatTzDiff(
  feedTz: string,
  currentTz: Timezone,
  at: Date = new Date(),
  dst: Dst = 'auto',
): string {
  const resolvedCurrent = currentTz === 'local' ? resolveLocalTz() : currentTz;
  const a = offsetMinutes(feedTz, at, dst);
  const b = offsetMinutes(resolvedCurrent, at, dst);
  if (a == null || b == null) return '';
  const diffMin = a - b;
  if (diffMin === 0) return '';
  const hours = diffMin / 60;
  const sign = hours > 0 ? '+' : '−';
  const abs = Math.abs(hours);
  const text = Number.isInteger(abs) ? abs.toString() : abs.toFixed(2).replace(/\.?0+$/, '');
  return sign + text;
}

// Signed minutes a feed's timezone is ahead (+) or behind (−) the display
// timezone — the basis for bending the current-time marker per row. Returns 0
// when either offset is unknown so the marker stays straight.
export function tzOffsetMinutesVsDisplay(
  feedTz: string,
  displayTz: Timezone,
  at: Date = new Date(),
  dst: Dst = 'auto',
): number {
  const resolved = displayTz === 'local' ? resolveLocalTz() : displayTz;
  const a = offsetMinutes(feedTz, at, dst);
  const b = offsetMinutes(resolved, at, dst);
  if (a == null || b == null) return 0;
  return a - b;
}

const TIMEZONE_CITY: Record<string, string> = {
  'Europe/London': 'London, GB',
  'Europe/Paris': 'Paris, FR',
  'Europe/Berlin': 'Berlin, DE',
  'Europe/Madrid': 'Madrid, ES',
  'Europe/Athens': 'Athens, GR',
  'America/New_York': 'New York, US',
  'America/Chicago': 'Chicago, US',
  'America/Denver': 'Denver, US',
  'America/Los_Angeles': 'Los Angeles, US',
  'Asia/Kolkata': 'Kolkata, IN',
  'Asia/Shanghai': 'Shanghai, CN',
  'Asia/Tokyo': 'Tokyo, JP',
  'Asia/Taipei': 'Taipei, TW',
  'Australia/Sydney': 'Sydney, AU',
  'Pacific/Auckland': 'Auckland, NZ',
};

// Short 2-letter code for a timezone — the ISO country code from the city map
// (e.g. Europe/Athens → "GR"), falling back to the first two letters of the IANA
// city for unmapped zones. Used as a compact, always-shown gutter label.
export function tzCountryCode(tz: string): string {
  if (!tz || tz === 'local') return '··';
  if (tz === 'UTC') return 'UT';
  const city = TIMEZONE_CITY[tz];
  const m = city?.match(/,\s*([A-Za-z]{2})$/);
  if (m) return m[1]!.toUpperCase();
  const seg = tz.split('/').pop()?.replace(/_/g, '') ?? tz;
  return seg.slice(0, 2).toUpperCase();
}

// Per-calendar timezone option label: "{offset} · {City, CC}" (city first, with
// a 2-letter ISO country code instead of the IANA continent).
export function formatTzOption(tz: string, dst: Dst = 'auto'): string {
  if (tz === 'UTC') return 'UTC';
  const offset = formatUtcOffset(tz, new Date(), dst);
  const city = TIMEZONE_CITY[tz] ?? tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  return offset ? offset + ' · ' + city : city;
}

// Label for an "Auto" timezone option, annotated with the zone it currently
// resolves to (device local, or a feed's detected tz). Null/empty → plain "Auto".
export function formatAutoLabel(resolvedTz: string | null, dst: Dst = 'auto'): string {
  if (!resolvedTz) return 'Auto';
  return `Auto (${formatTzOption(resolvedTz, dst)})`;
}

export function formatTimezoneLabel(tz: Timezone, dst: Dst = 'auto'): string {
  if (tz === 'local') return 'Local';
  if (tz === 'UTC') return 'UTC';
  const offset = offsetForTimezone(tz, new Date(), dst);
  const city = TIMEZONE_CITY[tz] ?? tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  return offset ? offset + ' · ' + city : city;
}

// Ordered, de-duplicated 1W gutter zones: the Current (display) zone first, then
// the #1 and #2 reference zones, dropping any that repeat one already listed. So
// a reference zone equal to Current collapses out (Current stays leftmost) and a
// third column only appears when Current differs from both #1 and #2.
export function orderedGutterZones(current: string, tz1: string, tz2: string): string[] {
  const out: string[] = [];
  for (const z of [current, tz1, tz2]) {
    if (z && !out.includes(z)) out.push(z);
  }
  return out;
}

// Parse a date string that was rendered by formatDate. Returns the calendar
// y/m/d so callers can build either UTC midnight (all-day) or a local wall-
// clock Date with their own time. Lenient on common separator variants.
export function parseFormattedDate(
  s: string,
  format: DateFormat,
  locale: Locale = 'en',
): { y: number; m: number; d: number } | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  let y: number, m: number, d: number;
  if (format === 'YYYY-MM-DD') {
    const parts = trimmed.split(/[-/.]/).map((p) => parseInt(p, 10));
    if (parts.length !== 3) return null;
    [y, m, d] = parts as [number, number, number];
  } else if (format === 'DD.MM.YYYY') {
    const parts = trimmed.split(/[.\-/]/).map((p) => parseInt(p, 10));
    if (parts.length !== 3) return null;
    [d, m, y] = parts as [number, number, number];
  } else if (format === 'MM/DD/YYYY') {
    const parts = trimmed.split(/[/.\-]/).map((p) => parseInt(p, 10));
    if (parts.length !== 3) return null;
    [m, d, y] = parts as [number, number, number];
  } else {
    // 'DD MMM YYYY' — match against MONTH_SHORT for the given locale,
    // accept upper or lower case.
    const tokens = trimmed.split(/\s+/);
    if (tokens.length !== 3) return null;
    const dn = parseInt(tokens[0]!, 10);
    const yn = parseInt(tokens[2]!, 10);
    const monName = tokens[1]!.toUpperCase();
    const table = MONTH_SHORT[locale] ?? MONTH_SHORT.en;
    const mi = table.findIndex((mm) => mm.toUpperCase() === monName);
    if (mi < 0 || Number.isNaN(dn) || Number.isNaN(yn)) return null;
    d = dn;
    m = mi + 1;
    y = yn;
  }
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

export function snippetFromText(text: string): string {
  const normalized = text.replace(/\\n/g, '\n').replace(/\\,/g, ',');
  const firstLine = normalized.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return firstLine.length > 80 ? firstLine.slice(0, 79) + '…' : firstLine;
}

// Calendar parts of an instant as seen in a given IANA zone ('local' = device).
// `minutes` is minutes since that zone's local midnight. One formatToParts call
// (via the cached dtf) yields all four fields, so the 1W grid can place an event
// in the right day column and at the right vertical offset from a single read.
export type ZonedParts = { y: number; m: number; d: number; minutes: number };

export function zonedParts(date: Date, tz: Timezone): ZonedParts {
  const tzStr = tz === 'local' ? undefined : tz;
  try {
    const parts = dtf('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: tzStr,
    }).formatToParts(date);
    const get = (t: string): number =>
      parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
    let hour = get('hour');
    // Intl can emit '24' for midnight under hour12:false; normalise to 0.
    if (hour === 24) hour = 0;
    return { y: get('year'), m: get('month'), d: get('day'), minutes: hour * 60 + get('minute') };
  } catch {
    return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), minutes: 0 };
  }
}

// A Date whose UTC calendar fields equal the wall-clock of `instant` in `tz`, so
// the UTC-based date/weekday formatters (formatDate/formatRange/formatWeekday)
// render an event's *local* date — keeping the shown date consistent with its
// tz-converted time even across midnight. All-day values are already UTC-midnight
// and timezone-agnostic, so callers pass them straight through.
export function zonedDateProxy(instant: Date, tz: Timezone): Date {
  const p = zonedParts(instant, tz);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.minutes / 60), p.minutes % 60));
}

// Stable "Y-M-D" key for the calendar day an instant falls on in `tz`, for
// matching events to the 1W grid's rolling day columns.
export function zonedDayKey(date: Date, tz: Timezone): string {
  const { y, m, d } = zonedParts(date, tz);
  return y + '-' + m + '-' + d;
}

export function resolveLocalTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatCurrentTzLabel(tz: Timezone, dst: Dst = 'auto'): string {
  if (tz === 'UTC') return 'UTC';
  const ianaTz = tz === 'local' ? resolveLocalTz() : tz;
  const city = TIMEZONE_CITY[ianaTz] ?? ianaTz.split('/').pop()?.replace(/_/g, ' ') ?? ianaTz;
  const offset = offsetForTimezone(ianaTz, new Date(), dst);
  return offset ? city + ' · ' + offset : city;
}

// Shared, curated timezone picker list used by every timezone field: the
// most-used zones pinned on top, then a divider, then the rest.
export const TZ_PINNED = ['UTC', 'Europe/Athens', 'America/New_York'] as const;
export const TZ_REST = [
  'Europe/London',
  'Europe/Paris',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Taipei',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

// Parse an "HH:MM" day-limit string into minutes since midnight, falling back
// to the given default when empty or malformed.
export function dayLimitMinutes(hhmm: string, fallbackMinutes: number): number {
  if (!hhmm) return fallbackMinutes;
  const [h, m] = hhmm.split(':');
  const hours = parseInt(h ?? '', 10);
  if (Number.isNaN(hours)) return fallbackMinutes;
  const mins = parseInt(m ?? '0', 10);
  return hours * 60 + (Number.isNaN(mins) ? 0 : mins);
}

export function isDaylight(
  tz: Timezone,
  at: Date = new Date(),
  morningMinutes = 8.5 * 60,
  eveningMinutes = 20.5 * 60,
): boolean {
  const ianaTz = tz === 'local' ? resolveLocalTz() : tz;
  try {
    const parts = dtf('en-GB', {
      timeZone: ianaTz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10);
    if (Number.isNaN(hour)) return true;
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    const cur = hour * 60 + (Number.isNaN(minute) ? 0 : minute);
    return cur >= morningMinutes && cur < eveningMinutes;
  } catch {
    const cur = at.getHours() * 60 + at.getMinutes();
    return cur >= morningMinutes && cur < eveningMinutes;
  }
}
