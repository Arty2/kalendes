import type FuseType from 'fuse.js';
import type { ParsedEvent } from './types';

export type SearchMatch = { event: ParsedEvent; score: number };
type FuseCtor = typeof import('fuse.js').default;

// fuse.js is only needed once the user actually searches, so load it on demand
// to keep it out of the initial bundle/parse cost on slow devices.
let FuseClass: FuseCtor | null = null;
let loading: Promise<void> | null = null;

export function loadFuse(): Promise<void> {
  if (FuseClass) return Promise.resolve();
  if (!loading) loading = import('fuse.js').then((m) => { FuseClass = m.default; });
  return loading;
}

export function isFuseReady(): boolean {
  return FuseClass !== null;
}

export function buildIndex(events: ParsedEvent[]): FuseType<ParsedEvent> | null {
  if (!FuseClass) {
    void loadFuse();
    return null;
  }
  return new FuseClass(events, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'description', weight: 0.3 },
      { name: 'location', weight: 0.2 },
    ],
    threshold: 0.4,
    includeScore: true,
  });
}

export function search(index: FuseType<ParsedEvent>, query: string): SearchMatch[] {
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
