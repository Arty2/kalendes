import type { FeedSource, FeedValidators } from './types';
import type { FeedParseResult } from './ics-core';
import { isGoogleCalendarFeed } from './feed-url';

export type { FeedParseResult } from './ics-core';

// Outcome of a feed refresh: either freshly parsed events plus the raw feed
// text (kept for the event modal's on-demand source view) and the response's
// revalidation headers, or a 304 telling the caller its cached events are
// still current (no download, no parse).
export type FeedFetchOutcome =
  | { kind: 'parsed'; result: FeedParseResult; text: string; validators: FeedValidators | null }
  | { kind: 'not-modified' };

export function rangeKeyFor(rangeStart: Date, rangeEnd: Date): string {
  return rangeStart.toISOString() + '..' + rangeEnd.toISOString();
}

export function feedIdFor(source: FeedSource): string {
  if (source.kind === 'secret') return 'secret:' + source.id;
  if (source.kind === 'scratchpad') return 'scratchpad:' + (source.id ?? 'default');
  return 'user:' + hashString(source.url);
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(36);
}

function buildSourceUrl(source: FeedSource): string {
  if (source.kind === 'secret') return '/api/ics?id=' + encodeURIComponent(source.id);
  if (source.kind === 'scratchpad') throw new Error('Scratchpad has no remote source');
  return '/api/ics?url=' + encodeURIComponent(source.url);
}

// Recurring-event expansion is the heaviest synchronous work on a refresh and
// can block the main thread for hundreds of ms. Run it in module workers so the
// UI stays responsive; structured clone preserves the Date fields. Feed fetches
// already run concurrently (Promise.all in App.svelte), but a single worker
// would serialize the parses, making N feeds take the SUM of their parse times.
// A small worker pool with round-robin dispatch overlaps them toward the MAX
// instead. Falls back to main-thread parsing where Worker is unavailable or a
// worker errors.
type WorkerPending = {
  resolve: (r: FeedParseResult) => void;
  reject: (e: Error) => void;
  worker: Worker;
};
let workerSeq = 0;
const pendingWorker = new Map<number, WorkerPending>();
let pool: Worker[] = [];
let poolCursor = 0;

// Keep the pool small (2-4) so parses overlap without oversubscribing the CPU,
// leaving a core for the main thread. Unknown core counts assume a modest machine.
function poolSize(): number {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.min(4, Math.max(2, cores - 1));
}

function makeWorker(): Worker {
  const w = new Worker(new URL('./ics.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent) => {
    const { id, result, error } = ev.data as {
      id: number;
      result?: FeedParseResult;
      error?: string;
    };
    const pending = pendingWorker.get(id);
    if (!pending) return;
    pendingWorker.delete(id);
    if (error) pending.reject(new Error(error));
    else pending.resolve(result as FeedParseResult);
  };
  w.onerror = () => {
    // Reject just this worker's in-flight parses and drop it from the pool; the
    // next dispatch lazily recreates a replacement, so one crash can't kill the
    // pool (each pending parse then falls back to the main thread).
    for (const [id, p] of pendingWorker) {
      if (p.worker === w) {
        pendingWorker.delete(id);
        p.reject(new Error('ICS worker error'));
      }
    }
    w.terminate();
    pool = pool.filter((x) => x !== w);
  };
  return w;
}

// A worker to parse on: grow the pool up to poolSize (so a burst of feeds each
// gets its own worker), then round-robin across it. null when Workers are
// unavailable (SSR / older engines) → the caller parses on the main thread.
function acquireWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    if (pool.length < poolSize()) {
      const w = makeWorker();
      pool.push(w);
      return w;
    }
    const w = pool[poolCursor % pool.length]!;
    poolCursor++;
    return w;
  } catch {
    return null;
  }
}

// Eagerly spin up the whole pool at app startup so the workers' ical.js modules
// compile while the initial feed fetches are in flight, off the first parses'
// critical path. Safe to call repeatedly and in non-worker environments (no-op).
export function warmParser(): void {
  if (typeof Worker === 'undefined') return;
  try {
    while (pool.length < poolSize()) pool.push(makeWorker());
  } catch {
    /* ignore — parses fall back to the main thread */
  }
}

function parseInWorker(
  w: Worker,
  ics: string,
  feedId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<FeedParseResult> {
  return new Promise((resolve, reject) => {
    const id = ++workerSeq;
    pendingWorker.set(id, { resolve, reject, worker: w });
    w.postMessage({ id, ics, feedId, rangeStart, rangeEnd });
  });
}

// Fetch just the feed body, unconditionally. The raw text backing the event
// modal's source view is session-only, so after a reload whose refresh
// revalidated with 304 it's gone — this restores it on demand.
export async function fetchFeedText(source: FeedSource, signal?: AbortSignal): Promise<string> {
  const url = buildSourceUrl(source);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Failed to fetch ' + url + ': ' + response.status);
  return response.text();
}

export async function fetchAndParseFeed(
  source: FeedSource,
  rangeStart: Date,
  rangeEnd: Date,
  opts: { signal?: AbortSignal; validators?: FeedValidators } = {},
): Promise<FeedFetchOutcome> {
  const url = buildSourceUrl(source);
  const rangeKey = rangeKeyFor(rangeStart, rangeEnd);
  const headers: Record<string, string> = {};
  const v = opts.validators;
  if (v && v.rangeKey === rangeKey) {
    if (v.etag) headers['If-None-Match'] = v.etag;
    if (v.lastModified) headers['If-Modified-Since'] = v.lastModified;
  }
  const conditional = Object.keys(headers).length > 0;
  const response = await fetch(url, { signal: opts.signal, headers });
  if (conditional && response.status === 304) return { kind: 'not-modified' };
  if (!response.ok) {
    let message = 'Failed to fetch ' + url + ': ' + response.status;
    // A 404 on a Google iCal feed almost always means the calendar isn't shared
    // publicly (Google only serves basic.ics for public calendars). Point the
    // user at the fix instead of a bare status code.
    if (
      response.status === 404 &&
      source.kind === 'user' &&
      isGoogleCalendarFeed(source.url)
    ) {
      message +=
        ' — this Google calendar may not be shared publicly. In Google Calendar open' +
        ' Settings → your calendar → Access permissions and enable' +
        ' “Make available to public”.';
    }
    throw new Error(message);
  }
  const text = await response.text();
  const feedId = feedIdFor(source);
  const etag = response.headers.get('ETag');
  const lastModified = response.headers.get('Last-Modified');
  const validators: FeedValidators | null =
    etag || lastModified
      ? {
          rangeKey,
          ...(etag ? { etag } : {}),
          ...(lastModified ? { lastModified } : {}),
        }
      : null;

  const w = acquireWorker();
  if (w) {
    try {
      const result = await parseInWorker(w, text, feedId, rangeStart, rangeEnd);
      return { kind: 'parsed', result, text, validators };
    } catch {
      /* fall through to main-thread parsing */
    }
  }
  const { parseIcsExtended } = await import('./ics-core');
  return { kind: 'parsed', result: parseIcsExtended(text, feedId, rangeStart, rangeEnd), text, validators };
}
