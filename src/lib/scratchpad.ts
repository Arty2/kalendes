import type { FeedCategory, ParsedEvent } from './types';
import { FEED_CATEGORIES, SCRATCHPAD_FEED_ID } from './types';
import { snippetFromText } from './format';

export const SCRATCHPAD_KEY = 'calendar-timeline:scratchpad';

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

export function loadScratchpad(): ParsedEvent[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(SCRATCHPAD_KEY);
  if (!raw) return [];
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
          feedId: SCRATCHPAD_FEED_ID,
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

export function saveScratchpad(events: ParsedEvent[]): void {
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
    localStorage.setItem(SCRATCHPAD_KEY, JSON.stringify(serialized));
  } catch {
    /* storage full or unavailable */
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
