import Fuse from 'fuse.js';
import type { ParsedEvent } from './types';

export type SearchMatch = { event: ParsedEvent; score: number };

export function buildIndex(events: ParsedEvent[]): Fuse<ParsedEvent> {
  return new Fuse(events, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'description', weight: 0.3 },
      { name: 'location', weight: 0.2 },
    ],
    threshold: 0.4,
    includeScore: true,
  });
}

export function search(index: Fuse<ParsedEvent>, query: string): SearchMatch[] {
  if (!query.trim()) return [];
  const results = index.search(query);
  return results
    .map((r) => ({ event: r.item, score: r.score ?? 1 }))
    .sort((a, b) => a.event.start.getTime() - b.event.start.getTime());
}

export function nextMatch(matches: SearchMatch[], current: number, dir: 1 | -1): number {
  if (matches.length === 0) return 0;
  return (current + dir + matches.length) % matches.length;
}
