import { untrack } from 'svelte';
import { config, events, ui } from './state.svelte';
import { fetchAndParseFeed } from './ics';
import { saveEventsCache } from './storage';
import { guessTimezoneFromName } from './tz-guess';
import type { CalendarFeed } from './types';

export type FeedRange = { start: Date; end: Date };

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
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();
  for (const feed of remoteFeeds()) $state.snapshot(feed.source);
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
    saveEventsCache(events.byFeed, events.tzByFeed, events.lastSuccessAt, ui.feedErrors, events.validators);
  } finally {
    ui.loading = false;
  }
}

async function refreshFeed(feed: CalendarFeed, range: FeedRange): Promise<void> {
  ui.loadingFeeds[feed.id] = true;
  try {
    // Revalidate with the stored ETag/Last-Modified only while we still hold
    // the feed's parsed events — on 304 they are what stays shown. Read
    // `events` via untrack so the load effect doesn't re-run on this
    // function's own writes to it.
    const validators = untrack(() =>
      events.byFeed[feed.id] !== undefined ? events.validators[feed.id] : undefined,
    );
    const outcome = await fetchAndParseFeed(feed.source, range.start, range.end, { validators });
    if (outcome.kind === 'not-modified') {
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
    console.error('Failed to load feed', feed.id, err);
    const hadPrior = (untrack(() => events.byFeed[feed.id])?.length ?? 0) > 0;
    if (!hadPrior) events.byFeed[feed.id] = [];
    ui.feedErrors[feed.id] = (err as Error).message ?? String(err);
  } finally {
    delete ui.loadingFeeds[feed.id];
  }
}
