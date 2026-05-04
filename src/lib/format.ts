import type { DateFormat, Locale, TimeFormat, Timezone } from './types';
import { MS_PER_DAY } from './time';

const MONTH_LONG: Record<Locale, string[]> = {
  en: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  el: [
    'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
    'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος',
  ],
};

const MONTH_SHORT: Record<Locale, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  el: ['Ιαν', 'Φεβ', 'Μάρ', 'Απρ', 'Μάι', 'Ιούν', 'Ιούλ', 'Αύγ', 'Σεπ', 'Οκτ', 'Νοέ', 'Δεκ'],
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
    case 'DD/MM/YYYY':
      return day + '/' + monthNum + '/' + year;
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

function endDayInclusive(start: Date, end: Date, allDay: boolean): Date {
  if (!allDay) return end;
  const ms = end.getTime() - 1;
  if (ms <= start.getTime()) return start;
  return new Date(ms);
}

export function durationDays(start: Date, end: Date, allDay: boolean): number {
  const last = endDayInclusive(start, end, allDay);
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  return Math.max(1, Math.round((endDay - startDay) / MS_PER_DAY) + 1);
}

export function formatRange(
  start: Date,
  end: Date,
  format: DateFormat,
  locale: Locale,
  allDay: boolean,
): string {
  const last = endDayInclusive(start, end, allDay);
  const sameDay =
    start.getUTCFullYear() === last.getUTCFullYear() &&
    start.getUTCMonth() === last.getUTCMonth() &&
    start.getUTCDate() === last.getUTCDate();
  const days = durationDays(start, end, allDay);
  if (sameDay) {
    return formatDate(start, format, locale);
  }
  const sameMonth =
    start.getUTCFullYear() === last.getUTCFullYear() &&
    start.getUTCMonth() === last.getUTCMonth();
  if (sameMonth && format === 'YYYY-MM-DD') {
    const head = formatDate(start, format, locale);
    return head + '--' + pad(last.getUTCDate()) + ' (' + days + ')';
  }
  const head = formatDate(start, format, locale);
  const tail = formatDate(last, format, locale);
  return head + '–' + tail + ' (' + days + ')';
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

export function formatTimezoneLabel(tz: Timezone): string {
  if (tz === 'local') return 'Local time';
  if (tz === 'UTC') return 'UTC';
  try {
    const offset = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
    return offset ? offset + ' · ' + city : city;
  } catch {
    return tz;
  }
}
