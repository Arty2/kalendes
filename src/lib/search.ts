import type FuseType from 'fuse.js';
import type { DisplayEvent } from './types';

export type SearchMatch = { event: DisplayEvent; score: number };
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

// What Fuse indexes per event: the text as shown (after filters rename it),
// plus the text as the feed sent it only where a filter changed it — most
// events have no rule, and indexing every field twice doubled build and
// search time for nothing.
type SearchDoc = { event: DisplayEvent; t: string; rt: string; d: string; rd: string; l: string; rl: string };
export type SearchIndex = FuseType<SearchDoc>;

function toDoc(e: DisplayEvent): SearchDoc {
  return {
    event: e,
    t: e.displayTitle,
    rt: e.title !== e.displayTitle ? e.title : '',
    d: e.displayDescription,
    rd: e.description !== e.displayDescription ? e.description : '',
    l: e.displayLocation,
    rl: e.location !== e.displayLocation ? e.location : '',
  };
}

export function buildIndex(events: DisplayEvent[]): SearchIndex | null {
  if (!FuseClass) {
    void loadFuse();
    return null;
  }
  return new FuseClass(events.map(toDoc), {
    keys: [
      { name: 't', weight: 0.35 },
      { name: 'rt', weight: 0.15 },
      { name: 'd', weight: 0.2 },
      { name: 'rd', weight: 0.1 },
      { name: 'l', weight: 0.15 },
      { name: 'rl', weight: 0.05 },
    ],
    threshold: 0.4,
    includeScore: true,
  });
}

export function search(index: SearchIndex, query: string): SearchMatch[] {
  if (!query.trim()) return [];
  const results = index.search(query);
  return results
    .map((r) => ({ event: r.item.event, score: r.score ?? 1 }))
    .sort((a, b) => a.event.start.getTime() - b.event.start.getTime());
}

export function nextMatch(matches: SearchMatch[], current: number, dir: 1 | -1): number {
  if (matches.length === 0) return 0;
  return (current + dir + matches.length) % matches.length;
}
