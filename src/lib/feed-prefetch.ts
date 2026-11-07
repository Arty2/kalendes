// A calendar being added is fetched while its form is still open: a moment
// after its URL is typed, so the form can show the name the feed gives itself
// (X-WR-CALNAME), and parsed straight away over the timeline's range, so once
// saved its first load takes that work instead of starting over. One feed at a
// time; a new URL, another fetch mode or Cancel drops the old one.
import { FeedCancelled, fetchFeedBody, parseFeedText, rangeKeyFor, type FetchedFeedBody, type PrefetchedFeed } from './ics';
import { calNameFromIcs } from './scratchpad';
import type { FeedFetch, FeedSource } from './types';

// How long a prefetch waits to be saved before it's dropped as stale.
export const PREFETCH_KEEP_MS = 2 * 60_000;
// How long the download may take. Only the download: a parse cut short by
// anything but a cancel resets the shared worker, failing other calendars' parses.
export const PREFETCH_FETCH_TIMEOUT_MS = 20_000;
// The parse runs before the feed has its id; its events are restamped on use.
const PREFETCH_FEED_ID = 'prefetch';

type Entry = {
  url: string;
  mode: FeedFetch;
  at: number;
  ctrl: AbortController;
  body: Promise<FetchedFeedBody>;
  parse: PrefetchedFeed['parse'];
};

let entry: Entry | null = null;
let range: { start: Date; end: Date } | null = null;

/** The range the timeline last loaded feeds for (feed-loader passes it). */
export function noteFeedRange(r: { start: Date; end: Date }): void {
  range = r;
}

const fresh = (e: Entry): boolean => Date.now() - e.at < PREFETCH_KEEP_MS;

/**
 * Fetch (and parse) a feed ahead of saving it. Resolves to the name the feed
 * gives itself, or null (none, or the fetch failed — saving shows the error).
 * Asking again for the same URL and mode reuses the request.
 */
export function prefetchFeed(url: string, mode: FeedFetch): Promise<string | null> {
  if (!entry || entry.url !== url || entry.mode !== mode || !fresh(entry)) {
    dropPrefetch();
    const ctrl = new AbortController();
    const download = new AbortController();
    const onCancel = (): void => download.abort(ctrl.signal.reason);
    ctrl.signal.addEventListener('abort', onCancel, { once: true });
    const timer = setTimeout(() => download.abort(new Error('Feed request timed out')), PREFETCH_FETCH_TIMEOUT_MS);
    const body = fetchFeedBody({ kind: 'user', url }, { mode, signal: download.signal }).finally(() => {
      clearTimeout(timer);
      ctrl.signal.removeEventListener('abort', onCancel);
    });
    const e: Entry = { url, mode, at: Date.now(), ctrl, body, parse: null };
    entry = e;
    body.then(
      ({ text }) => {
        if (entry !== e || !range) return;
        const result = parseFeedText(text, PREFETCH_FEED_ID, range.start, range.end, ctrl.signal);
        result.catch(() => {}); // a failed early parse is redone on load
        e.parse = { rangeKey: rangeKeyFor(range.start, range.end), result };
      },
      () => {},
    );
  }
  return entry!.body.then((b) => calNameFromIcs(b.text), () => null);
}

/** Forget the feed being added (Cancel, or a different URL). */
export function dropPrefetch(): void {
  entry?.ctrl.abort(new FeedCancelled());
  entry = null;
}

/** The prefetched feed for this source, once: the first load takes it. */
export function takePrefetched(source: FeedSource, mode: FeedFetch): PrefetchedFeed | null {
  const e = entry;
  if (!e || source.kind !== 'user' || source.url !== e.url || mode !== e.mode) return null;
  entry = null;
  if (!fresh(e)) {
    e.ctrl.abort(new FeedCancelled());
    return null;
  }
  return { body: e.body, parse: e.parse };
}
