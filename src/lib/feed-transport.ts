import type { FeedFetch, FeedSource } from './types';

// How a remote feed's bytes reach the app. A user feed is fetched straight from
// its host when the host allows cross-origin reads (CORS): our server then
// never sees the feed's URL or contents. Where the host doesn't allow it (in
// Auto mode), or the user chose to always use the proxy, the request goes
// through `/api/ics`, with the URL in a header so it stays out of the server's
// access logs. Secret (`?id=`) feeds only exist on the server, and public
// holiday feeds are shared through its cache; both always use the proxy.

export type FeedRoute = 'direct' | 'proxy';

// `text`: the body, when the transport already had to read it (a direct
// answer labelled text/html is judged by its body).
export type FeedResponse = { response: Response; via: FeedRoute; text?: string };

const PROXY_PATH = '/api/ics';

// How long a direct attempt may take to answer before the proxy is tried. A
// host that blocks cross-origin reads fails at once; this covers hosts that
// hang. It bounds the response headers only — the body then has the whole
// per-feed budget, as through the proxy.
export const DIRECT_TIMEOUT_MS = 6_000;

// A host that blocked a direct read goes through the proxy for this long
// before direct is tried again: every failed attempt still reaches the host
// (the browser sends the request, it only withholds the answer), costing a
// round-trip and showing the host the device's IP for nothing.
export const BLOCKED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

// Hosts known not to send CORS headers on calendar feeds, so the first refresh
// doesn't knock on them for nothing.
const KNOWN_BLOCKED = [/(^|\.)google\.com$/, /^outlook\.(office365|live)\.com$/, /(^|\.)icloud\.com$/];

const STORE_KEY = 'calendar-timeline:feed-hosts';
const MAX_HOSTS = 100;

type HostMemory = Record<string, number>; // host → when a direct read was last blocked

// Read once per page and kept here: a refresh asks about every feed, and the
// list changes only through this module (another tab's write is picked up on
// the next page load, which is soon enough for a week-long mark).
let memory: HostMemory | null = null;

function loadMemory(): HostMemory {
  if (memory) return memory;
  memory = {};
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'number') memory[k] = v;
    }
  } catch {
    /* unreadable: start empty */
  }
  return memory;
}

function saveMemory(): void {
  const mem = loadMemory();
  const entries = Object.entries(mem).sort((a, b) => b[1] - a[1]);
  for (const [k] of entries.slice(MAX_HOSTS)) delete mem[k];
  try {
    if (entries.length === 0) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_HOSTS))));
  } catch {
    /* storage full or blocked — the mark lasts for this page only */
  }
}

export function markHostBlocked(host: string, now = Date.now()): void {
  if (!host) return;
  loadMemory()[host] = now;
  saveMemory();
}

function markHostOk(host: string): void {
  const mem = loadMemory();
  if (!(host in mem)) return;
  delete mem[host];
  saveMemory();
}

// Tests: forget the in-memory copy so the next read comes from storage.
export function resetHostMemory(): void {
  memory = null;
}

function parseUrl(url: string | URL): URL | null {
  if (url instanceof URL) return url;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// Whether a direct read could work at all: https (an http:// feed would be
// blocked as mixed content on an https page) and not a host known to refuse.
function isDirectCandidate(u: URL): boolean {
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return !KNOWN_BLOCKED.some((re) => re.test(host));
}

// Whether a direct read of this URL is worth trying now (Auto mode): a
// candidate whose host hasn't refused one lately.
export function canTryDirect(url: string | URL, now = Date.now()): boolean {
  const u = parseUrl(url);
  if (!u || !isDirectCandidate(u)) return false;
  const blockedAt = loadMemory()[u.hostname.toLowerCase()];
  return blockedAt == null || now - blockedAt >= BLOCKED_RETRY_MS;
}

class DirectTimeout extends Error {
  constructor() {
    super('direct fetch timed out');
    this.name = 'DirectTimeout';
  }
}

// One direct attempt: no cookies, no referrer, no custom headers (those would
// make the browser send a CORS preflight first, which many hosts refuse).
// `cache: 'no-cache'` lets the browser revalidate its own copy instead.
// `timeoutMs` bounds the wait for headers (Auto mode, so a hung host doesn't
// hold up the fallback); null leaves only the caller's own budget.
async function fetchDirect(
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs: number | null,
): Promise<Response> {
  const init: RequestInit = {
    mode: 'cors',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-cache',
  };
  // No timeout of our own: the caller's signal is all the request needs.
  if (timeoutMs == null) return fetch(url, { ...init, signal });

  // A timeout too: one controller fed by both. The caller's signal must still
  // reach the body read after the headers, so its listener stays until the
  // body is done — then it goes, rather than living as long as the signal.
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  const release = (): void => signal?.removeEventListener('abort', onAbort);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DirectTimeout()), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    release();
    throw err;
  } finally {
    clearTimeout(timer);
  }
  return signal ? onBodySettled(response, release) : response;
}

// The same response, calling `settled` once its body is read to the end,
// fails or is cancelled.
function onBodySettled(response: Response, settled: () => void): Response {
  if (!response.body) {
    settled();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          settled();
          c.close();
        } else {
          c.enqueue(value);
        }
      } catch (err) {
        settled();
        c.error(err);
      }
    },
    cancel(reason) {
      settled();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Google's public holiday calendars (`en.greek#holiday@group.v.calendar.google.com`
// and the like): the same few feeds for everyone, published openly. They go
// through the proxy as `?url=` whatever the setting — Google doesn't allow
// direct reads, the address says nothing about the user — so the proxy's edge
// cache can share one copy among all users. `api/ics.ts` keeps its own copy of
// this test (it can't import app code); `api/ics.test.ts` checks they agree.
const HOLIDAY_ID_RE = /^[a-z]{2,3}(?:[-_][a-z0-9]+)?\.[a-z0-9_.-]+#holiday@group\.v\.calendar\.google\.com$/i;

export function isPublicHolidayFeed(url: string | URL): boolean {
  try {
    const u = parseUrl(url);
    if (!u || u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'calendar.google.com' || u.search) return false;
    const m = /^\/calendar\/ical\/([^/]+)\/public\/basic\.ics$/.exec(u.pathname);
    return m != null && HOLIDAY_ID_RE.test(decodeURIComponent(m[1]!));
  } catch {
    return false;
  }
}

export class DirectFetchUnavailable extends Error {
  constructor(message: string) {
    super(message + ' Set Fetch calendars to Auto or Via server in Settings to load it.');
    this.name = 'DirectFetchUnavailable';
  }
}

async function viaProxy(
  url: string,
  headers: Record<string, string>,
  opts: { signal?: AbortSignal; conditional?: Record<string, string> },
): Promise<FeedResponse> {
  const response = await fetch(url, { signal: opts.signal, headers: { ...headers, ...(opts.conditional ?? {}) } });
  return { response, via: 'proxy' };
}

async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* noop */ }
}

// A direct answer the app can use, or null. A 200 labelled `text/html` is
// usually a sign-in or bot-check page or a captive portal — but some CMS
// calendar plugins serve real ICS that way, and the proxy accepts a body that
// starts with BEGIN:VCALENDAR whatever its label, so judge the body as it does
// (and hand on the text read for it, rather than read it twice).
async function usableDirect(response: Response): Promise<FeedResponse | null> {
  if (!response.ok) {
    await discard(response);
    return null;
  }
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
    return { response, via: 'direct' };
  }
  const text = await readCapped(response);
  return text.trimStart().startsWith('BEGIN:VCALENDAR') ? { response, via: 'direct', text } : null;
}

// Statuses that say the host turns a browser away while it may well serve the
// proxy (an Origin check, a bot wall). A 5xx or 429 is a passing state of the
// host (or a rate limit on this device): no reason to send the calendar
// through the server for a week.
const REFUSING_STATUSES = new Set([401, 403, 405, 406, 451]);

// Fetch a feed. `mode` is the user's Fetch calendars setting:
// - 'auto': try the host directly, fall back to the proxy;
// - 'direct': the host only — a calendar it can't load reports an error rather
//   than reaching our server (secret and public holiday feeds still use it);
// - 'proxy': always the proxy.
// `conditional` (If-None-Match / If-Modified-Since from the app's stored
// validators) only rides the proxy route: on a direct read those headers would
// force a preflight.
export async function fetchFeed(
  source: FeedSource,
  opts: { mode: FeedFetch; signal?: AbortSignal; conditional?: Record<string, string> },
): Promise<FeedResponse> {
  if (source.kind === 'secret') {
    return viaProxy(PROXY_PATH + '?id=' + encodeURIComponent(source.id), {}, opts);
  }
  if (source.kind === 'scratchpad') throw new Error('Scratchpad has no remote source');
  const url = source.url;
  const parsed = parseUrl(url);
  if (parsed && isPublicHolidayFeed(parsed)) {
    return viaProxy(PROXY_PATH + '?url=' + encodeURIComponent(url), {}, opts);
  }
  // Percent-encoded: header values are Latin-1, and a feed URL may not be.
  const proxied = (): Promise<FeedResponse> =>
    viaProxy(PROXY_PATH, { 'X-Feed-Url': encodeURIComponent(url) }, opts);
  if (opts.mode === 'proxy' || !parsed) return proxied();
  if (opts.mode === 'direct') return fetchDirectOnly(url, parsed, opts.signal);
  if (!canTryDirect(parsed)) return proxied();

  const host = parsed.hostname.toLowerCase();
  // Whether this failure says something lasting about the host.
  let refused = true;
  try {
    const raw = await fetchDirect(url, opts.signal, DIRECT_TIMEOUT_MS);
    if (!raw.ok && !REFUSING_STATUSES.has(raw.status)) refused = false;
    const usable = await usableDirect(raw);
    if (usable) {
      markHostOk(host);
      return usable;
    }
  } catch (err) {
    // The caller's own time ran out or the feed was cancelled: stop here.
    if (opts.signal?.aborted) throw opts.signal.reason ?? err;
    // Otherwise blocked by CORS — or the connection failed: a TypeError either
    // way, by design — or too slow.
  }
  // No direct answer: blocked, or an error or a web page (some hosts refuse a
  // browser's request — bot checks on Origin — yet serve the proxy).
  const answer = await proxied();
  // Remember the host only once the proxy got the feed, so later refreshes go
  // straight there instead of paying two round-trips: on a dead connection (a
  // captive portal, a train's Wi-Fi) the proxy fails too, and when it can't
  // reach the host either, the direct failure said nothing about the host.
  if (refused && (answer.response.ok || answer.response.status === 304)) markHostBlocked(host);
  return answer;
}

// Direct mode: no fallback and no timeout of its own. A host remembered as
// blocked is asked again — it may have opened up — but not one sure to refuse.
async function fetchDirectOnly(url: string, parsed: URL, signal: AbortSignal | undefined): Promise<FeedResponse> {
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:') throw new DirectFetchUnavailable('Only https:// calendars can load directly.');
  if (!isDirectCandidate(parsed)) throw new DirectFetchUnavailable(host + ' doesn’t allow calendars to load directly.');
  let response: Response;
  try {
    response = await fetchDirect(url, signal, null);
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    throw new DirectFetchUnavailable(
      'Couldn’t load ' + host + ' directly: it may not allow it, or the connection failed.',
    );
  }
  // An error status is the host's own answer: shown as such.
  if (!response.ok) return { response, via: 'direct' };
  const usable = await usableDirect(response);
  if (!usable) throw new DirectFetchUnavailable(host + ' answered with a web page, not a calendar.');
  return usable;
}

// The proxy caps a body at 5MB (and has read it already); a direct read gets
// the same limit here.
export const MAX_FEED_BYTES = 5 * 1024 * 1024;

export function readFeedText({ response, via, text }: FeedResponse): Promise<string> {
  if (text != null) return Promise.resolve(text);
  return via === 'proxy' ? response.text() : readCapped(response);
}

async function readCapped(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_FEED_BYTES) {
    await discard(response);
    throw new Error('Feed is larger than 5MB');
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  const parts: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      try { await reader.cancel(); } catch { /* noop */ }
      throw new Error('Feed is larger than 5MB');
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
}
