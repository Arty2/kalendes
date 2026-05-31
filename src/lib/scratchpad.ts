import type { FeedCategory, ParsedEvent } from './types';
import { FEED_CATEGORIES, SCRATCHPAD_FEED_ID } from './types';
import { snippetFromText } from './format';

export const SCRATCHPAD_KEY = 'calendar-timeline:scratchpad';

// The Draft lane keeps the original key for backward compatibility; every other
// local lane (imported .ics) gets a suffixed key.
function keyForLane(id: string): string {
  return id === 'default' ? SCRATCHPAD_KEY : SCRATCHPAD_KEY + ':' + id;
}

type SerializedScratchEvent = {
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
};

export function loadScratchpad(id: string = 'default'): ParsedEvent[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(keyForLane(id));
  if (!raw) return [];
  const feedId = 'scratchpad:' + id;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is SerializedScratchEvent => e && typeof e === 'object')
      .map((e) => {
        const cat = typeof e.category === 'string' && (FEED_CATEGORIES as string[]).includes(e.category)
          ? (e.category as FeedCategory)
          : undefined;
        return {
          uid: String(e.uid ?? ''),
          feedId,
          title: String(e.title ?? ''),
          description: String(e.description ?? ''),
          descriptionSnippet: String(e.descriptionSnippet ?? ''),
          location: String(e.location ?? ''),
          start: new Date(e.start),
          end: new Date(e.end),
          allDay: Boolean(e.allDay),
          ...(e.url ? { url: String(e.url) } : {}),
          ...(cat ? { category: cat } : {}),
        };
      });
  } catch {
    return [];
  }
}

export function saveScratchpad(events: ParsedEvent[], id: string = 'default'): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const serialized: SerializedScratchEvent[] = events.map((e) => ({
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
    }));
    localStorage.setItem(keyForLane(id), JSON.stringify(serialized));
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

function newUid(): string {
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
  };
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

// Serialize local-lane events to an RFC 5545 VCALENDAR. Recurring events were
// already expanded to a static snapshot at import time, so each is a plain VEVENT.
export function eventsToIcs(events: ParsedEvent[], calName?: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//almanacs//local//EN', 'CALSCALE:GREGORIAN'];
  if (calName) lines.push('X-WR-CALNAME:' + escapeIcsText(calName));
  const dtstamp = icsDateTime(new Date());
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + escapeIcsText(ev.uid));
    lines.push('DTSTAMP:' + dtstamp);
    if (ev.allDay) {
      lines.push('DTSTART;VALUE=DATE:' + icsDate(ev.start));
      lines.push('DTEND;VALUE=DATE:' + icsDate(ev.end));
    } else {
      lines.push('DTSTART:' + icsDateTime(ev.start));
      lines.push('DTEND:' + icsDateTime(ev.end));
    }
    if (ev.title) lines.push('SUMMARY:' + escapeIcsText(ev.title));
    if (ev.description) lines.push('DESCRIPTION:' + escapeIcsText(ev.description));
    if (ev.location) lines.push('LOCATION:' + escapeIcsText(ev.location));
    if (ev.url) lines.push('URL:' + escapeIcsText(ev.url));
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
