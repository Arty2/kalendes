import type { FeedFetch, FeedSource, FeedValidators } from './types';
import type { FeedParseResult } from './ics-core';
import { isGoogleCalendarFeed } from './feed-url';
import { discardBody, fetchFeed, readFeedText } from './feed-transport';

export type { FeedParseResult } from './ics-core';

// Outcome of a feed refresh: either freshly parsed events plus the raw feed
// text (kept for the event modal's on-demand source view) and the response's
// revalidation headers, or a 304 telling the caller its cached events are
// still current (no download, no parse).
export type FeedFetchOutcome =
  | { kind: 'parsed'; result: FeedParseResult; text: string; validators: FeedValidators | null }
  | { kind: 'not-modified' }
  // A full 200 whose body matches the last parse: the cached events stand, but
  // the text (for the source view) and validators are fresh.
  | { kind: 'unchanged'; text: string; validators: FeedValidators };

// Bump when the parser starts reading something new from a VEVENT: the key
// gates conditional requests and the unchanged-body skip, so a new revision
// makes every cached feed re-parse once instead of keeping events that lack it.
const PARSER_REV = 4;

export function rangeKeyFor(rangeStart: Date, rangeEnd: Date): string {
  return 'p' + PARSER_REV + ':' + rangeStart.toISOString() + '..' + rangeEnd.toISOString();
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

// What a fetch error names: the feed's own address, not the proxy's.
function sourceLabel(source: FeedSource): string {
  if (source.kind === 'secret') return 'feed ' + source.id;
  if (source.kind === 'user') return source.url;
  return 'scratchpad';
}

// Recurring-event expansion is the heaviest synchronous work on a refresh and
// can block the main thread for hundreds of ms. Run it in a module worker so
// the UI stays responsive; structured clone preserves the Date fields. Falls
// back to main-thread parsing where Worker is unavailable or errors.
let worker: Worker | null = null;
let workerSeq = 0;
const pendingWorker = new Map<
  number,
  { resolve: (r: FeedParseResult) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./ics.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent) => {
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
    worker.onerror = () => resetWorker(new Error('ICS worker error'));
    worker.onmessageerror = () => resetWorker(new Error('ICS worker error'));
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

// The abort reason for a feed whose source changed: unlike a timeout, it says
// nothing about the worker's health.
export class FeedCancelled extends Error {
  constructor() {
    super('Feed source changed');
    this.name = 'FeedCancelled';
  }
}

// Drop the worker and fail everything it holds; getWorker() makes a fresh one.
// The other feeds' parses fall back to the main thread.
function resetWorker(reason: Error): void {
  const pending = [...pendingWorker.values()];
  pendingWorker.clear();
  worker?.terminate();
  worker = null;
  for (const p of pending) p.reject(reason);
}

// Eagerly spin up the parse worker (and let it start loading ical.js /
// ical-expander) at app startup, so the first refresh doesn't pay Worker
// creation + module compile on its critical path before any events appear.
// Safe to call repeatedly and in non-worker environments (no-op there).
export function warmParser(): void {
  getWorker();
}

function parseInWorker(
  w: Worker,
  ics: string,
  feedId: string,
  rangeStart: Date,
  rangeEnd: Date,
  signal?: AbortSignal,
): Promise<FeedParseResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const id = ++workerSeq;
    // Out of time: a worker still busy on (or stuck in) this parse would hold
    // up every feed after it, so it goes, not just this request. A feed that
    // was merely cancelled (its source changed) only drops its own request —
    // the worker finishes the parse and its answer is ignored.
    const onAbort = (): void => {
      if (!pendingWorker.has(id)) return;
      if (signal!.reason instanceof FeedCancelled) {
        pendingWorker.get(id)!.reject(signal!.reason);
        pendingWorker.delete(id);
      } else {
        resetWorker(signal!.reason);
      }
    };
    const settle = (): void => signal?.removeEventListener('abort', onAbort);
    pendingWorker.set(id, {
      resolve: (r) => { settle(); resolve(r); },
      reject: (e) => { settle(); reject(e); },
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    w.postMessage({ id, ics, feedId, rangeStart, rangeEnd });
  });
}

// Fetch just the feed body, unconditionally. The raw text backing the event
// modal's source view is session-only, so after a reload whose refresh
// revalidated with 304 it's gone — this restores it on demand.
export async function fetchFeedText(
  source: FeedSource,
  // `mode` is required: the Fetch calendars setting decides where the request
  // goes, and no caller may fall back to a route the user didn't choose.
  opts: { signal?: AbortSignal; mode: FeedFetch },
): Promise<string> {
  return (await fetchFeedBody(source, opts)).text;
}

// A feed's body and the validators it came with, fetched unconditionally.
export type FetchedFeedBody = { text: string; etag: string | null; lastModified: string | null };

export async function fetchFeedBody(
  source: FeedSource,
  opts: { signal?: AbortSignal; mode: FeedFetch },
): Promise<FetchedFeedBody> {
  const fetched = await fetchFeed(source, { mode: opts.mode, signal: opts.signal });
  const { response } = fetched;
  if (!response.ok) {
    void discardBody(response);
    throw fetchError(source, response.status);
  }
  return {
    text: await readFeedText(fetched, opts.signal),
    etag: response.headers.get('ETag'),
    lastModified: response.headers.get('Last-Modified'),
  };
}

// A failed fetch, named by the feed's own address. A 404 on a Google iCal feed
// almost always means the calendar isn't shared publicly (Google only serves
// basic.ics for public calendars), so it points at the fix.
function fetchError(source: FeedSource, status: number): Error {
  let message = 'Failed to fetch ' + sourceLabel(source) + ': ' + status;
  if (status === 404 && source.kind === 'user' && isGoogleCalendarFeed(source.url)) {
    message +=
      ' — this Google calendar may not be shared publicly. In Google Calendar open' +
      ' Settings → your calendar → Access permissions and enable' +
      ' “Make available to public”.';
  }
  return new Error(message);
}

// Parse a feed's text: in the worker, else (no worker, or it failed) on the
// main thread — but never start the main-thread parse once time is up.
export async function parseFeedText(
  text: string,
  feedId: string,
  rangeStart: Date,
  rangeEnd: Date,
  signal?: AbortSignal,
): Promise<FeedParseResult> {
  const w = getWorker();
  if (w) {
    try {
      return await parseInWorker(w, text, feedId, rangeStart, rangeEnd, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      /* else fall through to main-thread parsing */
    }
  }
  const { parseIcsExtended } = await import('./ics-core');
  // The main-thread parse can't be interrupted once it starts.
  signal?.throwIfAborted();
  return parseIcsExtended(text, feedId, rangeStart, rangeEnd);
}

// A feed fetched (and maybe parsed) ahead of its first load — while it was
// being added (feed-prefetch.ts). `parse` is a parse of `body` over the range
// `rangeKey` names, its events stamped with a placeholder feed id.
export type PrefetchedFeed = {
  body: Promise<FetchedFeedBody>;
  parse: { rangeKey: string; result: Promise<FeedParseResult> } | null;
};

// Wait for a promise, but give up when the signal fires.
function untilAborted<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

// Fingerprint of a feed body for the unchanged-feed check. DTSTAMP lines are
// dropped first: servers such as Google stamp every VEVENT with the time of the
// request, which would make each refresh look new while no event changed (the
// parser never reads DTSTAMP). Null where SubtleCrypto is unavailable (an
// insecure context) — the feed is then always parsed, as before.
export async function feedBodyHash(text: string): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const body = text.replace(/^DTSTAMP[;:].*$/gim, '');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    let hex = '';
    for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
    return hex;
  } catch {
    return null;
  }
}

export async function fetchAndParseFeed(
  source: FeedSource,
  rangeStart: Date,
  rangeEnd: Date,
  // `feedId` stamps the events with the config feed's id (the default, the
  // URL hash, differs for seeded feeds and feeds whose URL was edited).
  // `mode`: the Fetch calendars setting (see feed-transport.ts) — required, as
  // for fetchFeedText. `prefetched`: the body (and parse) fetched while the
  // feed was being added, used instead of a request when it arrived.
  opts: { signal?: AbortSignal; validators?: FeedValidators; feedId?: string; mode: FeedFetch; prefetched?: PrefetchedFeed | null },
): Promise<FeedFetchOutcome> {
  const rangeKey = rangeKeyFor(rangeStart, rangeEnd);
  const feedId = opts.feedId ?? feedIdFor(source);
  const v = opts.validators;
  let body: FetchedFeedBody | null = null;
  if (opts.prefetched) {
    // A failed prefetch just means a normal request below, with its own error.
    body = await untilAborted(opts.prefetched.body, opts.signal).catch((err) => {
      if (opts.signal?.aborted) throw err;
      return null;
    });
  }
  let usePrefetchedParse = body !== null;
  if (!body) {
    const headers: Record<string, string> = {};
    if (v && v.rangeKey === rangeKey) {
      if (v.etag) headers['If-None-Match'] = v.etag;
      if (v.lastModified) headers['If-Modified-Since'] = v.lastModified;
    }
    const conditional = Object.keys(headers).length > 0;
    const fetched = await fetchFeed(source, { mode: opts.mode, signal: opts.signal, conditional: headers });
    const { response } = fetched;
    if (conditional && response.status === 304) return { kind: 'not-modified' };
    if (!response.ok) {
      void discardBody(response);
      throw fetchError(source, response.status);
    }
    body = {
      text: await readFeedText(fetched, opts.signal),
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
    };
    usePrefetchedParse = false;
  }
  const { text, etag, lastModified } = body;
  const bodyHash = await feedBodyHash(text);
  const validators: FeedValidators | null =
    etag || lastModified || bodyHash
      ? {
          rangeKey,
          ...(etag ? { etag } : {}),
          ...(lastModified ? { lastModified } : {}),
          ...(bodyHash ? { bodyHash } : {}),
        }
      : null;
  // Same body, same expansion range: the events already shown are exactly what
  // a parse would produce, so skip the worker round-trip and the re-render.
  if (validators && bodyHash && v?.rangeKey === rangeKey && v.bodyHash === bodyHash) {
    return { kind: 'unchanged', text, validators };
  }
  const early = usePrefetchedParse ? opts.prefetched?.parse : null;
  if (early && early.rangeKey === rangeKey) {
    try {
      const r = await untilAborted(early.result, opts.signal);
      return { kind: 'parsed', result: { ...r, events: r.events.map((e) => ({ ...e, feedId })) }, text, validators };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      /* else parse it again below */
    }
  }
  const result = await parseFeedText(text, feedId, rangeStart, rangeEnd, opts.signal);
  return { kind: 'parsed', result, text, validators };
}
