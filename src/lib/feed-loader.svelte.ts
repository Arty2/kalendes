import { untrack } from 'svelte';
import { config, events, ui } from './state.svelte';
import { fetchAndParseFeed } from './ics';
import { saveEventsCache } from './storage';
import { guessTimezoneFromName } from './tz-guess';
import type { CalendarFeed } from './types';

export type FeedRange = { start: Date; end: Date };

// A request that never settles (a stalled mobile connection, which the proxy's
// own 10s limit can't see, or a stuck parse worker) would hold the pass open
// forever, and every later refresh joins it — so nothing, not even a newly
// added feed, would load again. The limit covers download and parse together.
export const FEED_FETCH_TIMEOUT_MS = 30_000;

let lastRefreshMs = 0;
let inFlight: Promise<void> | null = null;
let queued: FeedRange | null = null;

// When the last refresh pass started (0 = never), for the interval/focus/
// reconnect throttles.
export function lastFeedRefreshMs(): number {
  return lastRefreshMs;
}

function remoteFeeds(): CalendarFeed[] {
  return config.feeds.filter((f) => f.source.kind !== 'scratchpad' && !f.hidden);
}

// Refresh every visible remote feed. Each feed lands in `events` as soon as it
// resolves, so one slow calendar never holds the others back; `ui.loadingFeeds`
// says which are still in flight.
//
// Calls that arrive mid-refresh join it and queue ONE follow-up pass with the
// newest range, rather than fetching every feed twice in parallel. The load
// $effect in App.svelte tracks what this reads synchronously, so the feed list
// and sources are read up front on every call — including a joining one — or
// the effect would stop re-running on feed edits.
export function loadAllFeeds(range: FeedRange): Promise<void> {
  // Skip network refresh while offline; cached events stay shown. A reconnect
  // effect re-runs this once back online if the refresh interval has elapsed.
  // Sources are read first even offline, so the load effect still tracks them.
  for (const feed of remoteFeeds()) $state.snapshot(feed.source);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();
  if (inFlight) {
    queued = range;
    return inFlight;
  }
  inFlight = (async () => {
    let next: FeedRange | null = range;
    while (next) {
      queued = null;
      await refreshPass(next);
      next = queued;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function refreshPass(range: FeedRange): Promise<void> {
  lastRefreshMs = Date.now();
  ui.loading = true;
  ui.error = null;
  try {
    await Promise.all(remoteFeeds().map((feed) => refreshFeed(feed, range)));
    pruneRemovedFeeds();
    saveEventsCache(events.byFeed, events.tzByFeed, events.lastSuccessAt, ui.feedErrors, events.validators);
  } finally {
    ui.loading = false;
  }
}

// Drop what a deleted URL feed left behind — including a fetch that finished
// after its deletion — so the persisted cache doesn't carry it forever. Hidden
// feeds keep theirs; local lanes live in the scratchpad store, not here.
function pruneRemovedFeeds(): void {
  const live = new Set(config.feeds.map((f) => f.id));
  const gone = (id: string): boolean => !live.has(id) && !id.startsWith('scratchpad:');
  untrack(() => {
    for (const map of [events.byFeed, events.tzByFeed, events.rawTextByFeed, events.lastSuccessAt, events.validators, ui.feedErrors]) {
      for (const id of Object.keys(map)) if (gone(id)) delete map[id];
    }
  });
}

// Each feed's in-flight request, so a source change can cancel it.
const feedAborts = new Map<string, AbortController>();

async function withTimeout<T>(feedId: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  feedAborts.set(feedId, ctrl);
  const timer = setTimeout(
    () => ctrl.abort(new Error('Feed request timed out')),
    FEED_FETCH_TIMEOUT_MS,
  );
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
    if (feedAborts.get(feedId) === ctrl) feedAborts.delete(feedId);
  }
}

const sourceKey = (feed: CalendarFeed): string => JSON.stringify($state.snapshot(feed.source));

// A feed now points somewhere else (URL edited, or an import / reset gave its id
// a new source): cancel its request and drop everything held for the old source
// — events, validators (whose ETag / body hash would let the new server answer
// 304 over the old events), raw text, zone, error — in the persisted cache too,
// so a reload (offline, say) doesn't bring them back.
export function forgetFeedData(feedId: string): void {
  feedAborts.get(feedId)?.abort(new Error('Feed source changed'));
  untrack(() => {
    for (const map of [events.byFeed, events.tzByFeed, events.rawTextByFeed, events.lastSuccessAt, events.validators, ui.feedErrors]) {
      delete map[feedId];
    }
    saveEventsCache(events.byFeed, events.tzByFeed, events.lastSuccessAt, ui.feedErrors, events.validators);
  });
}

// forgetFeedData for every id whose source differs between two feed lists.
export function forgetChangedFeeds(before: readonly CalendarFeed[], after: readonly CalendarFeed[]): void {
  const was = new Map(before.map((f) => [f.id, sourceKey(f)]));
  for (const f of after) {
    const prev = was.get(f.id);
    if (prev !== undefined && prev !== sourceKey(f)) forgetFeedData(f.id);
  }
}

async function refreshFeed(feed: CalendarFeed, range: FeedRange): Promise<void> {
  ui.loadingFeeds[feed.id] = true;
  // The feed's URL can be edited while this fetch is out: its answer (events,
  // validators, an error) belongs to the old source and must not land.
  // Looked up by id: an import or reset replaces the feed objects themselves.
  const fetchedKey = sourceKey(feed);
  const stale = (): boolean =>
    untrack(() => {
      const now = config.feeds.find((f) => f.id === feed.id);
      return !now || sourceKey(now) !== fetchedKey;
    });
  try {
    // Revalidate with the stored ETag/Last-Modified only while we still hold
    // the feed's parsed events — on 304 they are what stays shown. Read
    // `events` via untrack so the load effect doesn't re-run on this
    // function's own writes to it.
    const validators = untrack(() =>
      events.byFeed[feed.id] !== undefined ? events.validators[feed.id] : undefined,
    );
    const outcome = await withTimeout(feed.id, (signal) =>
      fetchAndParseFeed(feed.source, range.start, range.end, { validators, signal, feedId: feed.id }),
    );
    if (stale()) return;
    if (outcome.kind === 'not-modified') {
      events.lastSuccessAt[feed.id] = Date.now();
      delete ui.feedErrors[feed.id];
      return;
    }
    if (outcome.kind === 'unchanged') {
      // Body identical to the last parse — keep the events (and their array
      // identity, so nothing downstream recomputes); refresh the rest.
      events.rawTextByFeed[feed.id] = outcome.text;
      events.validators[feed.id] = outcome.validators;
      events.lastSuccessAt[feed.id] = Date.now();
      delete ui.feedErrors[feed.id];
      return;
    }
    const parsed = outcome.result;
    events.byFeed[feed.id] = parsed.events;
    events.rawTextByFeed[feed.id] = outcome.text;
    if (outcome.validators) events.validators[feed.id] = outcome.validators;
    else delete events.validators[feed.id];
    const fromFeed = parsed.timezone && parsed.timezone !== 'UTC' ? parsed.timezone : null;
    const detectedTz = fromFeed ?? guessTimezoneFromName(feed.name) ?? parsed.timezone;
    if (detectedTz) events.tzByFeed[feed.id] = detectedTz;
    else delete events.tzByFeed[feed.id];
    events.lastSuccessAt[feed.id] = Date.now();
    delete ui.feedErrors[feed.id];
  } catch (err) {
    if (stale()) return;
    console.error('Failed to load feed', feed.id, err);
    const hadPrior = (untrack(() => events.byFeed[feed.id])?.length ?? 0) > 0;
    if (!hadPrior) events.byFeed[feed.id] = [];
    ui.feedErrors[feed.id] = (err as Error).message ?? String(err);
  } finally {
    delete ui.loadingFeeds[feed.id];
  }
}
