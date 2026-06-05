import type { FeedSource } from './types';
import type { FeedParseResult } from './ics-core';
import { isGoogleCalendarFeed } from './feed-url';

export type { FeedParseResult } from './ics-core';

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
    worker.onerror = () => {
      for (const p of pendingWorker.values()) p.reject(new Error('ICS worker error'));
      pendingWorker.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    worker = null;
    return null;
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
    pendingWorker.set(id, { resolve, reject });
    w.postMessage({ id, ics, feedId, rangeStart, rangeEnd });
  });
}

export async function fetchAndParseFeed(
  source: FeedSource,
  rangeStart: Date,
  rangeEnd: Date,
  signal?: AbortSignal,
): Promise<FeedParseResult> {
  const url = buildSourceUrl(source);
  const response = await fetch(url, { signal });
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

  const w = getWorker();
  if (w) {
    try {
      return await parseInWorker(w, text, feedId, rangeStart, rangeEnd);
    } catch {
      /* fall through to main-thread parsing */
    }
  }
  const { parseIcsExtended } = await import('./ics-core');
  return parseIcsExtended(text, feedId, rangeStart, rangeEnd);
}
