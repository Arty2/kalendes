import { config, search, getDisplayByFeed, markerRange } from './state.svelte';
import { today, todayStartMs } from './today.svelte';
import { buildIndex, search as runSearch, loadFuse, isFuseReady, type SearchMatch } from './search';
import { parseSearchQuery, hasOperators, queryFilter, overlapsDays, type SearchQuery } from './search-query';
import { dateOrderFor, localDayMs, parseDateQuery } from './date-words';
import type { DisplayEvent } from './types';

// Collapsed calendars are searched too (their row shows a match count, and
// stepping onto a match there expands it); hidden ones are not.
const _allSearchableEvents = $derived.by<DisplayEvent[]>(() => {
  const ordered = [...config.feeds].sort((a, b) => a.order - b.order);
  const all = getDisplayByFeed();
  const out: DisplayEvent[] = [];
  for (const feed of ordered) {
    if (feed.hidden) continue;
    const arr = all[feed.id] ?? [];
    for (const e of arr) {
      if (!e.hidden) out.push(e);
    }
  }
  return out;
});

// The viewer's own day for typed dates; reading today.value re-derives it when
// the day turns.
const _todayMs = $derived.by(() => {
  void today.value;
  return localDayMs();
});

const _query = $derived<SearchQuery>(
  parseSearchQuery(search.query, _todayMs, dateOrderFor(config.dateFormat)),
);

// The parts of the query that decide the candidate set, as primitives: a
// derived only notifies when its value changes, so typing more fuzzy text
// leaves the candidates — and the Fuse index built over them — alone.
const _active = $derived(search.query.trim().length > 0);
const _hasText = $derived(_query.text.length > 0);
const _operatorsKey = $derived(
  JSON.stringify([_query.phrases, _query.calendars, _query.locations, _query.afterMs, _query.beforeMs]),
);
const _operators = $derived.by<SearchQuery>(() => {
  const [phrases, calendars, locations, afterMs, beforeMs] = JSON.parse(_operatorsKey) as [
    string[], string[], string[], number | null, number | null,
  ];
  return { text: '', phrases, calendars, locations, afterMs, beforeMs };
});

// A marked span (two days or more) scopes the search to those days.
export function searchSpan(): { startMs: number; endMs: number; days: number } | null {
  const span = markerRange();
  return span && span.days > 1 ? span : null;
}

// What the query can match at all: the span when one is marked; else upcoming
// events, or everything with the past toggle or an explicit after:/before:.
// Then the operators. The fuzzy text narrows this further below.
const _candidates = $derived.by<DisplayEvent[]>(() => {
  if (!_active) return [];
  const q = _operators;
  const span = searchSpan();
  let list = _allSearchableEvents;
  if (span) {
    list = list.filter((e) => overlapsDays(e, span.startMs, span.endMs));
  } else if (!search.includesPast && q.afterMs == null && q.beforeMs == null) {
    list = list.filter((e) => e.end.getTime() >= todayStartMs(e.allDay));
  }
  if (!hasOperators(q)) return list;
  const names = new Map(config.feeds.map((f) => [f.id, f.name]));
  return list.filter(queryFilter(q, (id) => names.get(id) ?? ''));
});

// Only (re)build the Fuse index when there is fuzzy text to match — otherwise
// the index is unused, and rebuilding on every visible-set change (including
// the hourly `today` tick) is wasted work on slow devices. fuse.js is loaded
// lazily; fuseReady flips once it's available so the index rebuilds.
let fuseReady = $state(false);
const _searchIndex = $derived.by(() => {
  if (!_hasText) return null;
  void fuseReady; // re-derive once fuse.js lands
  if (!isFuseReady()) {
    void loadFuse().then(() => { fuseReady = true; });
    return null;
  }
  return buildIndex(_candidates);
});

const _matches = $derived.by<SearchMatch[]>(() => {
  if (_hasText) return _searchIndex ? runSearch(_searchIndex, _query.text) : [];
  // Operators alone: every candidate matches, in time order.
  if (!hasOperators(_operators)) return [];
  return [..._candidates]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((event) => ({ event, score: 0 }));
});

const _matchUids = $derived(new Set(_matches.map((m) => m.event.uid)));

const _matchCountByFeed = $derived.by(() => {
  const out = new Map<string, number>();
  for (const m of _matches) out.set(m.event.feedId, (out.get(m.event.feedId) ?? 0) + 1);
  return out;
});

const _currentMatchUid = $derived(_matches[search.currentIndex]?.event.uid ?? null);

// The whole query as one date ("2027-03", "next fri"): Enter jumps there.
const _jumpDateMs = $derived(
  parseDateQuery(search.query, _todayMs, dateOrderFor(config.dateFormat)),
);

export function getMatches() { return _matches; }
export function getMatchUids() { return _matchUids; }
export function getCurrentMatchUid() { return _currentMatchUid; }
export function getMatchCountByFeed() { return _matchCountByFeed; }
export function getJumpDateMs() { return _jumpDateMs; }
