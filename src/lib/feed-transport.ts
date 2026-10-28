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

// How long a host that turned a direct read away goes through the proxy before
// direct is tried again. Every failed attempt still reaches the host (the
// browser sends the request, it only withholds the answer), costing a
// round-trip and showing the host the device's IP for nothing. A refusal (a
// refusing status, a web page) holds for BLOCKED_RETRY_MS. No answer at all —
// a CORS block, but also what a dropped connection or a slow link looks like —
// holds for UNREACHABLE_RETRY_MS the first time and for BLOCKED_RETRY_MS once
// it happens again in a row, so one hiccup doesn't send a calendar through the
// server for a week, and a host that never allows it is asked only twice.
export const BLOCKED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
export const UNREACHABLE_RETRY_MS = 60 * 60 * 1000;

// Hosts known not to send CORS headers on calendar feeds, so the first refresh
// doesn't knock on them for nothing.
const KNOWN_BLOCKED = [/(^|\.)google\.com$/, /^outlook\.(office365|live)\.com$/, /(^|\.)icloud\.com$/];

const STORE_KEY = 'calendar-timeline:feed-hosts';
const MAX_HOSTS = 100;

// host → when direct may be tried again, and how many no-answer failures in a row.
type HostMark = { until: number; misses: number };
type HostMemory = Record<string, HostMark>;

// Read once per page and kept here: a refresh asks about every feed, and the
// list changes only through this module (another tab's write is picked up on
// the next page load).
let memory: HostMemory | null = null;

function loadMemory(): HostMemory {
  if (memory) return memory;
  memory = {};
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const m = v as Partial<HostMark> | null;
        if (m && typeof m.until === 'number' && typeof m.misses === 'number') memory[k] = { until: m.until, misses: m.misses };
      }
    }
  } catch {
    /* unreadable: start empty */
  }
  return memory;
}

function saveMemory(): void {
  const mem = loadMemory();
  const entries = Object.entries(mem).sort((a, b) => b[1].until - a[1].until);
  for (const [k] of entries.slice(MAX_HOSTS)) delete mem[k];
  try {
    if (entries.length === 0) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_HOSTS))));
  } catch {
    /* storage full or blocked — the mark lasts for this page only */
  }
}

// `how`: 'refused' — the host answered, but not with a calendar it lets a
// browser read; 'unreachable' — no answer at all (see the retry note above).
export function markHostBlocked(host: string, how: 'refused' | 'unreachable' = 'refused', now = Date.now()): void {
  if (!host) return;
  const mem = loadMemory();
  const misses = how === 'unreachable' ? (mem[host]?.misses ?? 0) + 1 : 0;
  const wait = how === 'refused' || misses >= 2 ? BLOCKED_RETRY_MS : UNREACHABLE_RETRY_MS;
  mem[host] = { until: now + wait, misses };
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

// A host on the device's own network: loopback, private and link-local IP
// literals, and names only a local resolver knows. The proxy refuses these
// (`isPrivateLiteral` / `guardedLookup` in api/ics.ts); the browser must not be
// the way round that — a shared link would otherwise have it poke devices on
// the recipient's network on every refresh.
export function isPrivateHost(u: URL): boolean {
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host.includes('.') && !host.includes(':')) return true; // localhost, intranet names
  if (/(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(host)) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (host.includes(':')) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (mapped) return isPrivateHost(new URL('https://' + mapped[1]));
    return host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }
  return false;
}

// Whether a direct read could work at all: https (an http:// feed would be
// blocked as mixed content on an https page) and not a host known to refuse.
function isDirectCandidate(u: URL): boolean {
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return !KNOWN_BLOCKED.some((re) => re.test(host));
}

// Whether a direct read of this URL is worth trying now (Auto mode): a
// candidate whose host hasn't turned one away lately.
export function canTryDirect(url: string | URL, now = Date.now()): boolean {
  const u = parseUrl(url);
  if (!u || !isDirectCandidate(u)) return false;
  const mark = loadMemory()[u.hostname.toLowerCase()];
  return mark == null || now >= mark.until;
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
// hold up the fallback); null leaves only the caller's own budget. Either way
// the body read watches the caller's signal itself (`readCapped`), so nothing
// here outlives the wait for headers.
async function fetchDirect(
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs: number | null,
): Promise<Response> {
  const init: RequestInit = { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache' };
  if (timeoutMs == null) return fetch(url, { ...init, signal });
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(new DirectTimeout()), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// Google's public holiday calendars (`en.greek#holiday@group.v.calendar.google.com`
// and the like): the same few feeds for everyone, published openly. They go
// through the proxy as `?url=` whatever the setting — Google doesn't allow
// direct reads, the address says nothing about the user — so the proxy's edge
// cache can share one copy among all users. `api/ics.ts` keeps its own copy of
// this test rather than importing app code into the function (an ESM import
// there is only proven by a Vercel build, which nothing here runs);
// `api/ics.test.ts` checks the two agree.
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

// A 200 from the host as a feed, or null when it isn't a calendar. The same
// rule as the proxy's: a calendar or plain-text type (or none) passes, anything
// else — a sign-in or bot-check page, a captive portal, a JSON error — only if
// the body starts with BEGIN:VCALENDAR (some CMS plugins serve real ICS as
// text/html). The text read to judge it is handed on, not read twice.
async function usableDirect(response: Response, signal: AbortSignal | undefined): Promise<FeedResponse | null> {
  const ctype = (response.headers.get('content-type') ?? '').toLowerCase();
  if (ctype === '' || ctype.includes('text/calendar') || ctype.includes('text/plain')) {
    return { response, via: 'direct' };
  }
  const text = await readCapped(response, signal);
  return text.trimStart().startsWith('BEGIN:VCALENDAR') ? { response, via: 'direct', text } : null;
}

// Statuses that say the host turns a browser away while it may well serve the
// proxy (an Origin check, a bot wall): those go to the proxy. Any other error
// (404, 410, 429, 5xx) is the host's own answer — it does allow direct reads —
// and is shown as the feed's error, as in Direct mode, rather than handing the
// calendar's address to the server for the same answer.
const REFUSING_STATUSES = new Set([401, 403, 405, 406, 451]);

export class PrivateNetworkFeed extends Error {
  constructor(host: string) {
    super(host + ' is on a private network; calendars there can’t be loaded.');
    this.name = 'PrivateNetworkFeed';
  }
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
  const parsed = parseUrl(url);
  // Neither route may reach the device's own network (the proxy refuses it
  // too, so asking it would only hand it the address).
  if (parsed && isPrivateHost(parsed)) throw new PrivateNetworkFeed(parsed.hostname);
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
  let failure: 'refused' | 'unreachable';
  try {
    const raw = await fetchDirect(url, opts.signal, DIRECT_TIMEOUT_MS);
    if (raw.ok || !REFUSING_STATUSES.has(raw.status)) {
      const usable = raw.ok ? await usableDirect(raw, opts.signal) : { response: raw, via: 'direct' as const };
      if (usable) {
        markHostOk(host);
        return usable;
      }
    } else {
      await discard(raw);
    }
    failure = 'refused';
  } catch (err) {
    // The caller's own time ran out or the feed was cancelled: stop here.
    if (opts.signal?.aborted) throw opts.signal.reason ?? err;
    // Blocked by CORS — or the connection failed: a TypeError either way, by
    // design — or too slow.
    failure = 'unreachable';
  }
  const answer = await proxied();
  // Remember the host only once the proxy got the feed, so later refreshes go
  // straight there instead of paying two round-trips: on a dead connection (a
  // captive portal, a train's Wi-Fi) the proxy fails too, and when it can't
  // reach the host either, the direct failure said nothing about the host.
  if (answer.response.ok || answer.response.status === 304) markHostBlocked(host, failure);
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
  const usable = await usableDirect(response, signal);
  if (!usable) throw new DirectFetchUnavailable(host + ' didn’t answer with a calendar.');
  // It works: Auto may try it directly again too.
  markHostOk(host);
  return usable;
}

// The proxy caps a body at 5MB (and has read it already); a direct read gets
// the same limit here. `signal` stops a direct body read (the proxy's request
// carries the signal itself).
export const MAX_FEED_BYTES = 5 * 1024 * 1024;

export function readFeedText({ response, via, text }: FeedResponse, signal?: AbortSignal): Promise<string> {
  if (text != null) return Promise.resolve(text);
  return via === 'proxy' ? response.text() : readCapped(response, signal);
}

async function readCapped(response: Response, signal?: AbortSignal): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_FEED_BYTES) {
    await discard(response);
    throw new Error('Feed is larger than 5MB');
  }
  if (!response.body) return response.text();
  signal?.throwIfAborted();
  const reader = response.body.getReader();
  const onAbort = (): void => void reader.cancel(signal?.reason).catch(() => {});
  signal?.addEventListener('abort', onAbort);
  try {
    const decoder = new TextDecoder();
    let total = 0;
    const parts: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      // A cancel ends the stream as if it were done: don't take a cut-off
      // body for the whole feed.
      signal?.throwIfAborted();
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
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
