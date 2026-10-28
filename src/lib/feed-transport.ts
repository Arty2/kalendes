import type { FeedFetch, FeedSource } from './types';

// How a remote feed's bytes reach the app. A user feed is fetched straight from
// its host when the host allows cross-origin reads (CORS): our server then
// never sees the feed's URL or contents. Where the host doesn't allow it (in
// Auto mode), or the user chose to always use the proxy, the request goes
// through `/api/ics`, with the URL in a header so it stays out of the server's
// access logs. Secret (`?id=`) feeds only exist on the server, and public
// holiday feeds are shared through its cache; both always use the proxy.

export type FeedRoute = 'direct' | 'proxy';

export type FeedResponse = { response: Response; via: FeedRoute };

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

// Whether a direct read could work at all: https (an http:// feed would be
// blocked as mixed content on an https page) and not a host known to refuse.
function isDirectCandidate(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return !KNOWN_BLOCKED.some((re) => re.test(host));
}

// Whether a direct read of this URL is worth trying now (Auto mode): a
// candidate whose host hasn't refused one lately.
export function canTryDirect(url: string, now = Date.now()): boolean {
  if (!isDirectCandidate(url)) return false;
  const blockedAt = loadMemory()[new URL(url).hostname.toLowerCase()];
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
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = timeoutMs == null ? undefined : setTimeout(() => controller.abort(new DirectTimeout()), timeoutMs);
  try {
    return await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-cache',
      signal: controller.signal,
    });
  } finally {
    // Only the wait for headers is limited here; the body read still follows
    // the caller's signal through `controller`.
    clearTimeout(timer);
  }
}

// Google's public holiday calendars (`en.greek#holiday@group.v.calendar.google.com`
// and the like): the same few feeds for everyone, published openly. They go
// through the proxy as `?url=` whatever the setting — Google doesn't allow
// direct reads, the address says nothing about the user — so the proxy's edge
// cache can share one copy among all users. `api/ics.ts` keeps its own copy of
// this test (it can't import app code); `api/ics.test.ts` checks they agree.
const HOLIDAY_ID_RE = /^[a-z]{2,3}(?:[-_][a-z0-9]+)?\.[a-z0-9_.-]+#holiday@group\.v\.calendar\.google\.com$/i;

export function isPublicHolidayFeed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'calendar.google.com' || u.search) return false;
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

// A 200 that is a web page, not a calendar: a sign-in or bot-check page, or a
// captive portal. The proxy refuses these (415); a direct read must too.
function isWebPage(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* noop */ }
}

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
  if (isPublicHolidayFeed(url)) return viaProxy(PROXY_PATH + '?url=' + encodeURIComponent(url), {}, opts);
  // Percent-encoded: header values are Latin-1, and a feed URL may not be.
  const proxied = (): Promise<FeedResponse> =>
    viaProxy(PROXY_PATH, { 'X-Feed-Url': encodeURIComponent(url) }, opts);
  if (opts.mode === 'proxy') return proxied();

  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* not a candidate */ }
  if (opts.mode === 'direct') return fetchDirectOnly(url, host, opts.signal);

  if (!canTryDirect(url)) return proxied();
  let blocked = false;
  try {
    const response = await fetchDirect(url, opts.signal, DIRECT_TIMEOUT_MS);
    if (response.ok && !isWebPage(response)) {
      markHostOk(host);
      return { response, via: 'direct' };
    }
    // The host answered, but with an error or a web page. Some refuse a
    // browser's request (bot checks on Origin) yet serve the proxy, so the
    // proxy gets a turn; the host does allow direct reads, so it isn't marked.
    await discard(response);
  } catch (err) {
    // The caller's own time ran out or the feed was cancelled: stop here.
    if (opts.signal?.aborted) throw opts.signal.reason ?? err;
    // Blocked by CORS — or the connection failed: a TypeError either way, by
    // design — or too slow.
    blocked = true;
  }
  const answer = await proxied();
  // Remember the host only once the proxy got the feed: on a dead connection
  // (a captive portal, a train's Wi-Fi) it fails too, and the direct failure
  // said nothing about the host.
  // A proxy error (the host down) says nothing about CORS either.
  const { status } = answer.response;
  if (blocked && (answer.response.ok || status === 304)) markHostBlocked(host);
  return answer;
}

// Direct mode: no fallback and no timeout of its own. A host remembered as
// blocked is asked again — it may have opened up — but not one sure to refuse.
async function fetchDirectOnly(url: string, host: string, signal: AbortSignal | undefined): Promise<FeedResponse> {
  if (!host) throw new Error('Invalid calendar address: ' + url);
  if (!url.toLowerCase().startsWith('https:')) {
    throw new DirectFetchUnavailable('Only https:// calendars can load directly.');
  }
  if (!isDirectCandidate(url)) throw new DirectFetchUnavailable(host + ' doesn’t allow calendars to load directly.');
  let response: Response;
  try {
    response = await fetchDirect(url, signal, null);
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    throw new DirectFetchUnavailable(
      'Couldn’t load ' + host + ' directly: it may not allow it, or the connection failed.',
    );
  }
  if (response.ok && isWebPage(response)) {
    await discard(response);
    throw new DirectFetchUnavailable(host + ' answered with a web page, not a calendar.');
  }
  return { response, via: 'direct' };
}

// The proxy caps a body at 5MB; a direct read gets the same limit.
export const MAX_FEED_BYTES = 5 * 1024 * 1024;

export async function readFeedText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_FEED_BYTES) {
    try { await response.body?.cancel(); } catch { /* noop */ }
    throw new Error('Feed is larger than 5MB');
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      try { await reader.cancel(); } catch { /* noop */ }
      throw new Error('Feed is larger than 5MB');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
