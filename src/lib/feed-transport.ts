import type { FeedFetch, FeedSource } from './types';
import { isPrivateHost } from './private-host';

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
// Two misses count as "in a row" only when the second comes within this long
// of the first mark running out (the next refresh or two) — not a month later.
const MISS_STREAK_MS = 24 * 60 * 60 * 1000;

// Hosts known not to send CORS headers on calendar feeds, so the first refresh
// doesn't knock on them for nothing.
const KNOWN_BLOCKED = [/(^|\.)google\.com$/, /^outlook\.(office365|live)\.com$/, /(^|\.)icloud\.com$/];

const STORE_KEY = 'calendar-timeline:feed-hosts';
const MAX_HOSTS = 100;

// host → when direct may be tried again, and how many no-answer failures in a row.
type HostMark = { until: number; misses: number };
type HostMemory = Record<string, HostMark>;

// Read once per page and kept here: a refresh asks about every feed. A write
// re-reads storage first and changes only its own host, so another tab (or the
// installed app) marking a host meanwhile isn't overwritten.
let memory: HostMemory | null = null;

function readStored(): HostMemory {
  const out: HostMemory = {};
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const m = v as Partial<HostMark> | null;
        if (m && typeof m.until === 'number' && typeof m.misses === 'number') out[k] = { until: m.until, misses: m.misses };
      }
    }
  } catch {
    /* unreadable: start empty */
  }
  return out;
}

function loadMemory(): HostMemory {
  return (memory ??= readStored());
}

function updateMemory(change: (mem: HostMemory) => void): void {
  const mem = readStored();
  change(mem);
  const entries = Object.entries(mem).sort((a, b) => b[1].until - a[1].until).slice(0, MAX_HOSTS);
  memory = Object.fromEntries(entries);
  try {
    if (entries.length === 0) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify(memory));
  } catch {
    /* storage full or blocked — the mark lasts for this page only */
  }
}

// `how`: 'refused' — the host answered, but not with a calendar it lets a
// browser read; 'unreachable' — no answer at all (see the retry note above).
export function markHostBlocked(host: string, how: 'refused' | 'unreachable' = 'refused', now = Date.now()): void {
  if (!host) return;
  updateMemory((mem) => {
    const prev = mem[host];
    const streak = prev != null && now < prev.until + MISS_STREAK_MS ? prev.misses : 0;
    const misses = how === 'unreachable' ? streak + 1 : 0;
    const wait = how === 'refused' || misses >= 2 ? BLOCKED_RETRY_MS : UNREACHABLE_RETRY_MS;
    mem[host] = { until: now + wait, misses };
  });
}

// Storage too, not just this page's copy: another tab may have marked the host
// since this one read the marks.
function markHostOk(host: string): void {
  if (!(host in loadMemory()) && !(host in readStored())) return;
  updateMemory((mem) => {
    delete mem[host];
  });
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
// A URL with a username or password isn't one either: fetch() refuses it
// outright (a TypeError that would read as the host not answering).
function isDirectCandidate(u: URL): boolean {
  if (u.protocol !== 'https:' || u.username || u.password) return false;
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
// `redirect`: Auto passes 'manual' — a redirect could lead anywhere, the
// device's own network included, and the page can't see where before going —
// so it comes back as an opaque response (`isRedirect`), which Auto hands to
// the proxy (it re-checks every hop). Direct, which has no proxy to hand it
// to, passes 'follow', and judges where it ended up (`landedPrivate`).
// `timeoutMs` bounds the wait for headers (Auto mode, so a hung host doesn't
// hold up the fallback); null leaves only the caller's own budget. Either way
// the body read watches the caller's signal itself (`readCapped`), so nothing
// here outlives the wait for headers.
async function fetchDirect(
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs: number | null,
  redirect: RequestRedirect,
): Promise<Response> {
  const init: RequestInit = {
    mode: 'cors',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-cache',
    redirect,
  };
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

// Whether a user feed's route depends on the Fetch calendars mode: not a
// public holiday feed (always the proxy), nor one refused before any request
// (a private host, http://, an address that doesn't parse).
export function followsFetchMode(url: string): boolean {
  const u = parseUrl(url);
  return u != null && u.protocol === 'https:' && !isPrivateHost(u) && !isPublicHolidayFeed(u);
}

export class DirectFetchUnavailable extends Error {
  constructor(message: string) {
    super(message + ' Set Fetch calendars to Auto or Proxy in Settings to load it.');
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

// Drop a body nobody will read, freeing its connection.
export async function discardBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* noop */ }
}

function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect';
}

// Whether a followed redirect ended on the device's own network. The request
// has been made by then — a page can't see a redirect's target before going —
// but its answer isn't used.
function landedPrivate(response: Response): boolean {
  if (!response.redirected || !response.url) return false;
  const final = parseUrl(response.url);
  return final == null || isPrivateHost(final);
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
  const text = await readCapped(response, signal, (head) => head.startsWith('BEGIN:VCALENDAR'));
  return text == null ? null : { response, via: 'direct', text };
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
    // In a header, like a feed URL: the id is the feed's only credential, and
    // request lines are what access logs keep.
    return viaProxy(PROXY_PATH, { 'X-Feed-Id': encodeURIComponent(source.id) }, opts);
  }
  if (source.kind === 'scratchpad') throw new Error('Scratchpad has no remote source');
  const url = source.url;
  const parsed = parseUrl(url);
  // The proxy parses the address the same way, so one that doesn't parse here
  // would only come back as its 400.
  if (!parsed) throw new Error('Invalid calendar address: ' + url);
  // Neither route may reach the device's own network (the proxy refuses it
  // too, so asking it would only hand it the address).
  if (isPrivateHost(parsed)) throw new PrivateNetworkFeed(parsed.hostname);
  // Neither route can load http:// (mixed content in the browser; the proxy
  // requires https), so say so up front — no mode switch would help.
  if (parsed.protocol !== 'https:') {
    throw new Error('Only https:// calendars can be loaded: try this calendar’s https:// address.');
  }
  if (isPublicHolidayFeed(parsed)) {
    return viaProxy(PROXY_PATH + '?url=' + encodeURIComponent(url), {}, opts);
  }
  if (opts.mode === 'direct') {
    return fetchDirectOnly(url, parsed, opts.signal);
  }
  // Percent-encoded: header values are Latin-1, and a feed URL may not be.
  const proxied = (): Promise<FeedResponse> =>
    viaProxy(PROXY_PATH, { 'X-Feed-Url': encodeURIComponent(url) }, opts);
  if (opts.mode === 'proxy' || !canTryDirect(parsed)) return proxied();

  const host = parsed.hostname.toLowerCase();
  let failure: 'refused' | 'unreachable';
  try {
    const raw = await fetchDirect(url, opts.signal, DIRECT_TIMEOUT_MS, 'manual');
    if (raw.ok || (!isRedirect(raw) && !REFUSING_STATUSES.has(raw.status))) {
      const usable = raw.ok ? await usableDirect(raw, opts.signal) : { response: raw, via: 'direct' as const };
      if (usable) {
        markHostOk(host);
        return usable;
      }
    } else {
      await discardBody(raw);
    }
    // A refusing status, a redirect, or a 200 that isn't a calendar.
    failure = 'refused';
  } catch (err) {
    // The caller's own time ran out or the feed was cancelled: stop here.
    if (opts.signal?.aborted) throw opts.signal.reason ?? err;
    // Blocked by CORS — or the connection failed: a TypeError either way, by
    // design — or too slow.
    failure = 'unreachable';
  }
  const answer = await proxied();
  // Remember the host so later refreshes go straight to the proxy instead of
  // paying two round-trips. A refusal is the host's own word, whatever the
  // proxy then gets. No answer is only blamed on the host once the proxy got
  // the feed: on a dead connection (a captive portal, a train's Wi-Fi) the
  // proxy fails too, and when the host is down the direct failure said
  // nothing about CORS.
  const { status } = answer.response;
  if (failure === 'refused' || answer.response.ok || status === 304) markHostBlocked(host, failure);
  return answer;
}

// Direct mode: no fallback and no timeout of its own, and redirects are
// followed (there is no proxy to hand them to), as long as they don't end on
// the device's own network. A host remembered as blocked is asked again — it
// may have opened up — but not one sure to refuse.
async function fetchDirectOnly(url: string, parsed: URL, signal: AbortSignal | undefined): Promise<FeedResponse> {
  const host = parsed.hostname.toLowerCase();
  if (parsed.username || parsed.password) {
    throw new DirectFetchUnavailable('A calendar address with a username or password can’t load directly.');
  }
  if (!isDirectCandidate(parsed)) throw new DirectFetchUnavailable(host + ' doesn’t allow calendars to load directly.');
  let response: Response;
  try {
    response = await fetchDirect(url, signal, null, 'follow');
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    throw new DirectFetchUnavailable(
      'Couldn’t load ' + host + ' directly: it may not allow it, or the connection failed.',
    );
  }
  if (landedPrivate(response)) {
    await discardBody(response);
    throw new PrivateNetworkFeed(parseUrl(response.url)?.hostname ?? host);
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

// `accept`, when given, judges the body's start (leading whitespace dropped)
// as soon as there's enough of it to tell: a body it rejects is cancelled
// there and null returned, rather than downloaded whole for nothing.
async function readCapped(response: Response, signal?: AbortSignal): Promise<string>;
async function readCapped(
  response: Response,
  signal: AbortSignal | undefined,
  accept: (head: string) => boolean,
): Promise<string | null>;
async function readCapped(
  response: Response,
  signal?: AbortSignal,
  accept?: (head: string) => boolean,
): Promise<string | null> {
  const SNIFF_CHARS = 15; // 'BEGIN:VCALENDAR'.length
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_FEED_BYTES) {
    await discardBody(response);
    throw new Error('Feed is larger than 5MB');
  }
  if (!response.body) {
    const text = await response.text();
    return accept && !accept(text.trimStart()) ? null : text;
  }
  signal?.throwIfAborted();
  const reader = response.body.getReader();
  const onAbort = (): void => void reader.cancel(signal?.reason).catch(() => {});
  signal?.addEventListener('abort', onAbort);
  try {
    const decoder = new TextDecoder();
    let total = 0;
    const parts: string[] = [];
    let judged = accept == null;
    let head = '';
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
      const chunk = decoder.decode(value, { stream: true });
      parts.push(chunk);
      if (!judged) {
        head = (head + chunk).trimStart();
        if (head.length >= SNIFF_CHARS) {
          judged = true;
          if (!accept!(head)) {
            try { await reader.cancel(); } catch { /* noop */ }
            return null;
          }
        }
      }
    }
    parts.push(decoder.decode());
    const text = parts.join('');
    return judged || accept!(text.trimStart()) ? text : null;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
