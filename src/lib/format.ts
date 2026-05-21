import type { DateFormat, Locale, TimeFormat, Timezone } from './types';
import { MS_PER_DAY } from './time';

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

function endDayInclusive(start: Date, end: Date): Date {
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

  if (format === 'YYYY-MM-DD') {
    if (sameMonth) {
      const head = formatDate(start, format, locale);
      return head + '–' + pad(last.getUTCDate());
    }
    return formatDate(start, format, locale) + '–' + formatDate(last, format, locale);
  }

  if (format === 'DD MMM YYYY') {
    const sd = pad(start.getUTCDate());
    const ed = pad(last.getUTCDate());
    const sm = formatMonth(start, locale, 'short');
    const em = formatMonth(last, locale, 'short');
    const sy = String(start.getUTCFullYear());
    const ey = String(last.getUTCFullYear());
    if (sameMonth) return sd + '–' + ed + ' ' + sm + ' ' + sy;
    if (sameYear) return sd + ' ' + sm + '–' + ed + ' ' + em + ' ' + sy;
    return sd + ' ' + sm + ' ' + sy + '–' + ed + ' ' + em + ' ' + ey;
  }

  if (format === 'DD.MM.YYYY') {
    const sd = pad(start.getUTCDate());
    const ed = pad(last.getUTCDate());
    const sm = pad(start.getUTCMonth() + 1);
    const em = pad(last.getUTCMonth() + 1);
    const sy = String(start.getUTCFullYear());
    const ey = String(last.getUTCFullYear());
    if (sameMonth) return sd + '–' + ed + '.' + sm + '.' + sy;
    if (sameYear) return sd + '.' + sm + '–' + ed + '.' + em + '.' + sy;
    return sd + '.' + sm + '.' + sy + '–' + ed + '.' + em + '.' + ey;
  }

  if (format === 'MM/DD/YYYY') {
    const sd = pad(start.getUTCDate());
    const ed = pad(last.getUTCDate());
    const sm = pad(start.getUTCMonth() + 1);
    const em = pad(last.getUTCMonth() + 1);
    const sy = String(start.getUTCFullYear());
    const ey = String(last.getUTCFullYear());
    if (sameMonth) return sm + '/' + sd + '–' + ed + '/' + sy;
    if (sameYear) return sm + '/' + sd + '–' + em + '/' + ed + '/' + sy;
    return sm + '/' + sd + '/' + sy + '–' + em + '/' + ed + '/' + ey;
  }

  return formatDate(start, format, locale) + '–' + formatDate(last, format, locale);
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
  return new Intl.DateTimeFormat(tag, options).format(d).replace(/\s+/g, ' ').trim();
}

export function formatUtcOffset(tz: string, at: Date = new Date()): string {
  return offsetForTimezone(tz, at);
}

export function offsetMinutes(tz: string, at: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
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

function offsetForTimezone(tz: string, at: Date = new Date()): string {
  const total = offsetMinutes(tz, at);
  if (total == null) return '';
  const sign = total < 0 ? '-' : '+';
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return mins === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${pad(mins)}`;
}

export function formatTzDiff(feedTz: string, currentTz: Timezone, at: Date = new Date()): string {
  const resolvedCurrent = currentTz === 'local' ? resolveLocalTz() : currentTz;
  const a = offsetMinutes(feedTz, at);
  const b = offsetMinutes(resolvedCurrent, at);
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
): number {
  const resolved = displayTz === 'local' ? resolveLocalTz() : displayTz;
  const a = offsetMinutes(feedTz, at);
  const b = offsetMinutes(resolved, at);
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
  'Australia/Sydney': 'Sydney, AU',
  'Pacific/Auckland': 'Auckland, NZ',
};

// Per-calendar timezone option label: "{offset} · {City, CC}" (city first, with
// a 2-letter ISO country code instead of the IANA continent).
export function formatTzOption(tz: string): string {
  if (tz === 'UTC') return 'UTC';
  const offset = formatUtcOffset(tz);
  const city = TIMEZONE_CITY[tz] ?? tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  return offset ? offset + ' · ' + city : city;
}

export function formatTimezoneLabel(tz: Timezone): string {
  if (tz === 'local') return 'Local';
  if (tz === 'UTC') return 'UTC';
  const offset = offsetForTimezone(tz);
  const city = TIMEZONE_CITY[tz] ?? tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  return offset ? offset + ' · ' + city : city;
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

export function resolveLocalTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatCurrentTzLabel(tz: Timezone): string {
  if (tz === 'UTC') return 'UTC';
  const ianaTz = tz === 'local' ? resolveLocalTz() : tz;
  const city = TIMEZONE_CITY[ianaTz] ?? ianaTz.split('/').pop()?.replace(/_/g, ' ') ?? ianaTz;
  const offset = offsetForTimezone(ianaTz);
  return offset ? city + ' · ' + offset : city;
}

export const TZ_OVERRIDE_OPTIONS = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Athens',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

export function isDaylight(tz: Timezone, at: Date = new Date(), morningHour = 8, eveningHour = 20): boolean {
  const ianaTz = tz === 'local' ? resolveLocalTz() : tz;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: ianaTz,
      hour: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const raw = parts.find((p) => p.type === 'hour')?.value ?? '';
    const hour = parseInt(raw, 10);
    if (Number.isNaN(hour)) return true;
    return hour >= morningHour && hour < eveningHour;
  } catch {
    const hour = at.getHours();
    return hour >= morningHour && hour < eveningHour;
  }
}
