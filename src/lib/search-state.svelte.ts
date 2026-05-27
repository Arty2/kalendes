import { config, search, getDisplayByFeed } from './state.svelte';
import { today } from './today.svelte';
import { buildIndex, search as runSearch } from './search';
import type { DisplayEvent } from './types';

const _allVisibleEvents = $derived.by<DisplayEvent[]>(() => {
  const ordered = [...config.feeds].sort((a, b) => a.order - b.order);
  const all = getDisplayByFeed();
  const out: DisplayEvent[] = [];
  for (const feed of ordered) {
    if (feed.hidden) continue;
    if (feed.collapsed) continue;
    const arr = all[feed.id] ?? [];
    for (const e of arr) {
      if (!e.hidden) out.push(e);
    }
  }
  return out;
});

const _searchableEvents = $derived.by<DisplayEvent[]>(() => {
  if (search.includesPast) return _allVisibleEvents;
  const cutoff = today.value.getTime();
  return _allVisibleEvents.filter((e) => e.end.getTime() >= cutoff);
});

// Only (re)build the Fuse index when a query is active — otherwise the index
// is unused (_matches is []), and rebuilding on every visible-set change
// (including the hourly `today` tick) is wasted work on slow devices.
const _searchIndex = $derived(
  search.query.trim().length > 0 ? buildIndex(_searchableEvents) : null,
);

const _matches = $derived(
  _searchIndex ? runSearch(_searchIndex, search.query) : [],
);

const _matchUids = $derived(new Set(_matches.map((m) => m.event.uid)));

const _currentMatchUid = $derived(_matches[search.currentIndex]?.event.uid ?? null);

export function getMatches() { return _matches; }
export function getMatchUids() { return _matchUids; }
export function getCurrentMatchUid() { return _currentMatchUid; }
