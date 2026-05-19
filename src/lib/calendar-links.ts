import type { ParsedEvent } from './types';
import { MS_PER_DAY } from './time';

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatDateBasic(d: Date): string {
  return (
    d.getUTCFullYear().toString().padStart(4, '0') +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate())
  );
}

function formatDateTimeBasic(d: Date): string {
  return (
    formatDateBasic(d) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    'Z'
  );
}

function formatDateTimeIso(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

function googleDates(ev: ParsedEvent): string {
  if (ev.allDay) {
    return formatDateBasic(ev.start) + '/' + formatDateBasic(ev.end);
  }
  return formatDateTimeBasic(ev.start) + '/' + formatDateTimeBasic(ev.end);
}

export function buildGoogleAddUrl(ev: ParsedEvent): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', ev.title);
  params.set('dates', googleDates(ev));
  if (ev.description) params.set('details', ev.description);
  if (ev.location) params.set('location', ev.location);
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

export function buildOutlookAddUrl(ev: ParsedEvent): string {
  const params = new URLSearchParams();
  params.set('path', '/calendar/action/compose');
  params.set('rru', 'addevent');
  params.set('subject', ev.title);
  params.set('startdt', formatDateTimeIso(ev.start));
  params.set('enddt', formatDateTimeIso(ev.end));
  if (ev.description) params.set('body', ev.description);
  if (ev.location) params.set('location', ev.location);
  if (ev.allDay) params.set('allday', 'true');
  return 'https://outlook.office.com/calendar/0/deeplink/compose?' + params.toString();
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'event';
}

function veventLines(ev: ParsedEvent, dtstamp: string): string[] {
  const lines: string[] = [
    'BEGIN:VEVENT',
    'UID:' + (ev.uid || dtstamp + '@calendari'),
    'DTSTAMP:' + dtstamp,
    'SUMMARY:' + escapeIcsText(ev.title),
  ];
  if (ev.allDay) {
    lines.push('DTSTART;VALUE=DATE:' + formatDateBasic(ev.start));
    lines.push('DTEND;VALUE=DATE:' + formatDateBasic(ev.end));
  } else {
    lines.push('DTSTART:' + formatDateTimeBasic(ev.start));
    lines.push('DTEND:' + formatDateTimeBasic(ev.end));
  }
  if (ev.description) lines.push('DESCRIPTION:' + escapeIcsText(ev.description));
  if (ev.location) lines.push('LOCATION:' + escapeIcsText(ev.location));
  if (ev.url) lines.push('URL:' + ev.url);
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(ev: ParsedEvent): string {
  const dtstamp = formatDateTimeBasic(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//calendari//EN',
    ...veventLines(ev, dtstamp),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

export function buildIcsBundle(evs: ParsedEvent[]): string {
  const dtstamp = formatDateTimeBasic(new Date());
  const sorted = [...evs].sort((a, b) => a.start.getTime() - b.start.getTime());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//calendari//EN',
  ];
  for (const ev of sorted) lines.push(...veventLines(ev, dtstamp));
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function isoDate(d: Date): string {
  return (
    d.getUTCFullYear().toString().padStart(4, '0') +
    '-' +
    pad2(d.getUTCMonth() + 1) +
    '-' +
    pad2(d.getUTCDate())
  );
}

function lastInclusiveDay(ev: ParsedEvent): Date {
  if (ev.allDay) {
    const ms = ev.end.getTime() - MS_PER_DAY;
    if (ms <= ev.start.getTime()) return ev.start;
    return new Date(ms);
  }
  return ev.end;
}

export function buildIcsDownload(ev: ParsedEvent): { dataUrl: string; filename: string } {
  const ics = buildIcs(ev);
  const dataUrl =
    'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  const startKey = isoDate(ev.start);
  const endKey = isoDate(lastInclusiveDay(ev));
  const slug = slugify(ev.title);
  const filename =
    startKey === endKey
      ? startKey + '_' + slug + '.ics'
      : startKey + '_to_' + endKey + '_' + slug + '.ics';
  return { dataUrl, filename };
}

export function buildIcsBundleDownload(evs: ParsedEvent[]): {
  blob: Blob;
  filename: string;
} {
  const ics = buildIcsBundle(evs);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  let startKey: string;
  let endKey: string;
  if (evs.length === 0) {
    const today = isoDate(new Date());
    startKey = today;
    endKey = today;
  } else {
    let minStart = evs[0]!.start.getTime();
    let maxEnd = lastInclusiveDay(evs[0]!).getTime();
    for (const ev of evs) {
      const s = ev.start.getTime();
      if (s < minStart) minStart = s;
      const e = lastInclusiveDay(ev).getTime();
      if (e > maxEnd) maxEnd = e;
    }
    startKey = isoDate(new Date(minStart));
    endKey = isoDate(new Date(maxEnd));
  }
  const filename = startKey + '--' + endKey + '_' + evs.length + '-events.ics';
  return { blob, filename };
}
