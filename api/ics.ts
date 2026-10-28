import type { VercelRequest, VercelResponse } from '@vercel/node';
import dnsCb from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { isIP, type LookupFunction } from 'node:net';
import { Readable, pipeline } from 'node:stream';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const PRIVATE_V4 = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['0.0.0.0', 8],
  ['100.64.0.0', 10],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const;

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  for (const [base, bits] of PRIVATE_V4) {
    const baseInt = ipv4ToInt(base);
    const mask = ((~0 << (32 - bits)) >>> 0) >>> 0;
    if ((ipInt & mask) === (baseInt & mask)) return true;
  }
  return false;
}

// The 16 bytes of an IPv6 literal (a dotted IPv4 tail allowed), or null.
function ipv6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase();
  if (s.includes('.')) {
    const at = s.lastIndexOf(':');
    const v4 = s.slice(at + 1);
    if (isIP(v4) !== 4) return null;
    const [a, b, c, d] = v4.split('.').map(Number) as [number, number, number, number];
    s = s.slice(0, at + 1) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

function isPrivateIPv6(ip: string): boolean {
  const b = ipv6Bytes(ip);
  if (!b) return true; // unparseable: refuse
  const v4At = (i: number): string => b.slice(i, i + 4).join('.');
  const zeroUntil = (n: number): boolean => b.slice(0, n).every((x) => x === 0);
  if (zeroUntil(15) && b[15]! <= 1) return true; // :: and ::1
  if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && b[1]! >= 0x80) return true; // fe80::/10 link-local, fec0::/10 site-local
  if (b[0] === 0xff) return true; // multicast
  // IPv4 inside IPv6: judge the embedded address.
  if (zeroUntil(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIPv4(v4At(12)); // ::ffff:0:0/96
  if (zeroUntil(12)) return isPrivateIPv4(v4At(12)); // ::/96 IPv4-compatible
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
    return isPrivateIPv4(v4At(12)); // 64:ff9b::/96 NAT64
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIPv4(v4At(2)); // 2002::/16 6to4
  return false;
}

// The cheap, DNS-free half of the guard: an IP-literal host (brackets
// allowed, as URL.hostname writes IPv6) judged directly — sockets dial literals
// without a lookup, so guardedLookup never sees them. Names pass here; their
// addresses are judged as the socket dials (guardedLookup), which a separate
// lookup up front would only repeat.
export function isPrivateLiteral(hostname: string): boolean {
  const h = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const kind = isIP(h);
  if (kind === 4) return isPrivateIPv4(h);
  if (kind === 6) return isPrivateIPv6(h);
  return h !== hostname; // bracketed but not an address: refuse
}


function isPrivateAddress(address: string, family: number): boolean {
  return family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
}

// DNS for the connection itself, refusing private addresses. A separate lookup
// up front isn't enough: the connection would resolve the name again, and a
// rebinding DNS server can answer the second time with an internal address.
// Judging the very addresses the socket dials closes that gap.
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsCb.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err, '', 0);
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address, a.family))) {
      const e = Object.assign(new Error('host not allowed'), { code: 'EHOSTNOTALLOWED' });
      return callback(e as NodeJS.ErrnoException, '', 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: dnsCb.LookupAddress[]) => void)(null, addrs);
    callback(null, addrs[0]!.address, addrs[0]!.family);
  });
};

// fetch's own defaults, which upstreams have always seen from this proxy: some
// bot filters refuse a request with no User-Agent.
const USER_AGENT = 'kalendes-feed-proxy (+https://github.com/Arty2/kalendes)';
// Not deflate: servers disagree on raw vs zlib-wrapped, so it isn't asked for.
const ACCEPT_ENCODING = 'gzip, br';

function decoderFor(encoding: string | undefined): NodeJS.ReadWriteStream | null {
  switch ((encoding ?? '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

// One GET over node:http(s), shaped like fetch's Response so safeFetch and
// readWithCap don't care. Redirects aren't followed (safeFetch does that); the
// body is decompressed as fetch would, so readWithCap's cap counts decoded bytes.
// `guard` dials only addresses guardedLookup approves; it is off just for a
// secret feed's own URL, which the operator configured and the old fetch path
// never host-checked (its redirects are still guarded).
// Kept-alive sockets skip the lookup when reused, so guarded and unguarded
// requests never share a pool.
// Guarded hops are always https (the handler and safeFetch require it).
const AGENTS = {
  guarded: { https: new https.Agent({ keepAlive: true }) },
  trusted: { http: new http.Agent({ keepAlive: true }), https: new https.Agent({ keepAlive: true }) },
};

function pinnedFetch(url: string, init: RequestInit, guard = true): Promise<Response> {
  return new Promise((resolve, reject) => {
    const plain = url.startsWith('http:');
    if (plain && guard) {
      reject(new UnsafeRedirectError('https required'));
      return;
    }
    const client = plain ? http : https;
    const req = client.request(
      url,
      {
        agent: guard ? AGENTS.guarded.https : plain ? AGENTS.trusted.http : AGENTS.trusted.https,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Encoding': ACCEPT_ENCODING,
          ...(init.headers as Record<string, string>),
        },
        signal: init.signal ?? undefined,
        ...(guard ? { lookup: guardedLookup } : {}),
      },
      (msg) => {
        const status = msg.statusCode ?? 0;
        if (status < 200 || status > 599) {
          msg.resume();
          reject(new Error('unexpected upstream status ' + status));
          return;
        }
        const decoder = decoderFor(msg.headers['content-encoding'] as string | undefined);
        const headers = new Headers();
        for (const [k, v] of Object.entries(msg.headers)) {
          // The body below is the decoded one: its encoding and length no longer apply.
          if (decoder && (k === 'content-encoding' || k === 'content-length')) continue;
          if (Array.isArray(v)) for (const x of v) headers.append(k, x);
          else if (v !== undefined) headers.set(k, v);
        }
        const nullBody = status === 204 || status === 304;
        if (nullBody) {
          msg.resume();
          resolve(new Response(null, { status, headers }));
          return;
        }
        let stream: NodeJS.ReadableStream = msg;
        if (decoder) {
          // pipeline ties both ends: a corrupt body, an abort, or the reader
          // cancelling (over the cap) destroys msg too, freeing its socket.
          pipeline(msg, decoder, () => {});
          stream = decoder;
        }
        const body = Readable.toWeb(stream as Readable) as unknown as ReadableStream<Uint8Array>;
        resolve(new Response(body, { status, headers }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// The upstream fetch the handler uses; tests swap it for a stub. `hop` counts
// redirects followed; `trusted` marks a secret feed's configured URL.
type UpstreamFetch = (url: string, init: RequestInit, hop: number, trusted: boolean) => Promise<Response>;
export const upstream: { fetch: UpstreamFetch } = {
  fetch: (url, init, hop, trusted) => pinnedFetch(url, init, !(trusted && hop === 0)),
};

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// A redirect hop that failed the host/scheme guard, or a chain that ran too long.
// The handler maps this to a 400 so an attacker's feed can't use a redirect to
// reach an address the initial-URL check would have rejected (SSRF).
export class UnsafeRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeRedirectError';
  }
}

type FetchLike = (url: string, init: RequestInit, hop: number) => Promise<Response>;
type SafeFetchDeps = {
  fetchImpl?: FetchLike;
  isPrivate?: (hostname: string) => Promise<boolean>;
};

// Fetch `initialUrl`, following redirects manually so every hop is re-validated
// with the same https + private-host guard the initial URL passed. Without this,
// a public feed could 302 to http://169.254.169.254/ (cloud metadata) or an
// internal host and the proxy would return the body. Conditional-request headers
// travel on the first hop only — a redirect shouldn't carry the caller's ETag to
// a different resource.
export async function safeFetch(
  initialUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  deps: SafeFetchDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const isPrivate = deps.isPrivate ?? (async (h: string) => isPrivateLiteral(h));
  let currentUrl = initialUrl;
  let currentHeaders = headers;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchImpl(currentUrl, {
      headers: currentHeaders,
      signal,
      redirect: 'manual',
    }, hop);
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    const location = res.headers.get('location');
    if (!location) return res; // a 3xx without a target — treat as a normal response
    try { await res.body?.cancel(); } catch { /* noop */ }
    let next: URL;
    try {
      next = new URL(location, currentUrl);
    } catch {
      throw new UnsafeRedirectError('invalid redirect target');
    }
    if (next.protocol !== 'https:') throw new UnsafeRedirectError('redirect not allowed');
    if (await isPrivate(next.hostname)) throw new UnsafeRedirectError('redirect not allowed');
    currentUrl = next.toString();
    // Drop conditional headers before following — they belong to the first
    // resource, not the redirect target.
    currentHeaders = { Accept: currentHeaders.Accept ?? '*/*' };
  }
  throw new UnsafeRedirectError('too many redirects');
}

// Best-effort, per-instance token bucket. Serverless spreads requests across
// instances, so this caps abuse per warm instance rather than globally — a
// distributed limit would need an external store (e.g. Vercel KV). The map is
// bounded (MAX_BUCKETS) so a flood of distinct/spoofed client IPs can't grow it
// without limit; once full, fully-refilled (idle) buckets are dropped first,
// then the oldest entries, since evicting a full bucket only resets someone to
// their starting allowance.
export const RATE_BUCKETS = new Map<string, { tokens: number; refilledAt: number }>();
const RATE_PER_MIN = 60;
export const MAX_BUCKETS = 10_000;

function evictBuckets(now: number): void {
  // Drop idle buckets that have fully refilled — they carry no useful state.
  for (const [ip, b] of RATE_BUCKETS) {
    const refilled = Math.min(RATE_PER_MIN, b.tokens + ((now - b.refilledAt) / 60_000) * RATE_PER_MIN);
    if (refilled >= RATE_PER_MIN) RATE_BUCKETS.delete(ip);
  }
  // Still at/over the cap (all buckets active): drop oldest-inserted entries
  // until there's room for the incoming one (size < MAX_BUCKETS).
  for (const ip of RATE_BUCKETS.keys()) {
    if (RATE_BUCKETS.size < MAX_BUCKETS) return;
    RATE_BUCKETS.delete(ip);
  }
}

export function rateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = RATE_BUCKETS.get(ip) ?? { tokens: RATE_PER_MIN, refilledAt: now };
  const elapsed = (now - bucket.refilledAt) / 60_000;
  bucket.tokens = Math.min(RATE_PER_MIN, bucket.tokens + elapsed * RATE_PER_MIN);
  bucket.refilledAt = now;
  if (bucket.tokens < 1) {
    RATE_BUCKETS.set(ip, bucket);
    return false;
  }
  bucket.tokens -= 1;
  if (!RATE_BUCKETS.has(ip) && RATE_BUCKETS.size >= MAX_BUCKETS) evictBuckets(now);
  RATE_BUCKETS.set(ip, bucket);
  return true;
}

function secretFeedUrl(id: string): string | null {
  const ids = (process.env.SECRET_FEED_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.includes(id)) return null;
  const key = 'FEED_' + id.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_URL';
  return process.env[key] ?? null;
}

async function readWithCap(response: Response): Promise<{ ok: true; body: string } | { ok: false; reason: string }> {
  if (!response.body) return { ok: true, body: await response.text() };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* noop */ }
        return { ok: false, reason: 'response too large' };
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, body: new TextDecoder('utf-8').decode(merged) };
}

function headerValue(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v[0]) return v[0]!;
  return null;
}

// Prefer the platform-set `x-real-ip` (Vercel writes the true client IP here)
// over the left-most `x-forwarded-for`, which a client can prepend to forge a
// rate-limit key. Fall back to XFF, then the socket address. The value is only
// used as a bucket key, never trusted for authorization.
export function pickClientIp(req: Pick<VercelRequest, 'headers' | 'socket'>): string {
  const realIp = headerValue(req.headers['x-real-ip']);
  if (realIp && isIP(realIp.trim())) return realIp.trim();
  const fwd = headerValue(req.headers['x-forwarded-for']);
  if (fwd) {
    const first = fwd.split(',')[0]!.trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

// Google's public holiday calendars (`en.greek#holiday@group.v.calendar.google.com`
// and the like). A copy of `isPublicHolidayFeed` in src/lib/feed-transport.ts —
// a serverless function can't import app code; api/ics.test.ts checks the two
// agree.
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

// Logs name the failure, never its message: Node's network errors carry the
// host name (`getaddrinfo ENOTFOUND calendar.example.com`).
export function errorCode(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  if (typeof code === 'string') return code;
  return typeof e?.name === 'string' ? e.name : 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'If-None-Match, If-Modified-Since, X-Feed-Url');
  // The feed URL arrives in a header, so every feed shares this one path: no
  // cache may answer one feed's request with another's body.
  res.setHeader('Vary', 'X-Feed-Url');
  // Only a good feed response is cacheable (set below). Errors must not stick
  // at the edge: a 404 from a calendar that was private a minute ago would
  // otherwise keep failing for everyone after it is made public.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const ip = pickClientIp(req);
  if (!rateLimit(ip)) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'rate limited' });
    return;
  }

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  // The app sends the feed URL in `X-Feed-Url` (percent-encoded, as header
  // values are Latin-1) so it never appears in a request line, and request
  // lines are what access logs keep — a calendar's secret address is a
  // credential. `?url=` is the older form, kept for installs not yet updated.
  let url: string | null = null;
  let fromQuery = false;
  const headerUrl = headerValue(req.headers['x-feed-url']);
  if (headerUrl) {
    try { url = decodeURIComponent(headerUrl); } catch { res.status(400).json({ error: 'invalid url' }); return; }
  } else if (typeof req.query.url === 'string') {
    url = req.query.url;
    fromQuery = true;
  }

  let upstreamUrl: string;
  if (id) {
    const u = secretFeedUrl(id);
    if (!u) { res.status(404).json({ error: 'unknown feed id' }); return; }
    upstreamUrl = u;
  } else if (url) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { res.status(400).json({ error: 'invalid url' }); return; }
    if (parsed.protocol !== 'https:') { res.status(400).json({ error: 'https required' }); return; }
    if (isPrivateLiteral(parsed.hostname)) {
      res.status(400).json({ error: 'host not allowed' });
      return;
    }
    upstreamUrl = parsed.toString();
  } else {
    res.status(400).json({ error: 'missing id or url' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1' };
  const inm = req.headers['if-none-match'];
  const ims = req.headers['if-modified-since'];
  if (typeof inm === 'string') headers['If-None-Match'] = inm;
  if (typeof ims === 'string') headers['If-Modified-Since'] = ims;

  let upstreamRes: Response;
  try {
    const trusted = id != null;
    upstreamRes = await safeFetch(upstreamUrl, headers, controller.signal, {
      fetchImpl: (u, init, hop) => upstream.fetch(u, init, hop, trusted),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof UnsafeRedirectError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if ((err as NodeJS.ErrnoException).code === 'EHOSTNOTALLOWED') {
      res.status(400).json({ error: 'host not allowed' });
      return;
    }
    // Log the underlying cause server-side, but don't leak internal DNS /
    // connection detail (host names, resolver errors) back to the caller.
    console.error('upstream fetch failed:', errorCode(err));
    res.status(502).json({ error: 'upstream fetch failed' });
    return;
  }

  const etag = upstreamRes.headers.get('etag');
  const lastMod = upstreamRes.headers.get('last-modified');
  if (etag) res.setHeader('ETag', etag);
  if (lastMod) res.setHeader('Last-Modified', lastMod);
  // Only public holiday feeds sit in the shared cache: the same few feeds for
  // everyone, addressed by their own `?url=` (the edge keys on the request
  // URL). Otherwise what a calendar holds is the user's business, and a secret
  // feed's id is its only credential: a secret feed's URL is its own, so the
  // browser may still keep and revalidate it; a header-addressed feed's isn't
  // (they all share this path), so it is never stored — the app keeps its own
  // copy and sends its own validators.
  const sharedCache = fromQuery && isPublicHolidayFeed(upstreamUrl);
  const cacheControl = id
    ? 'private, no-cache'
    : sharedCache
      ? 'public, s-maxage=600, stale-while-revalidate=3600'
      : 'no-store';
  if (sharedCache) res.removeHeader('Vary');

  if (upstreamRes.status === 304) {
    clearTimeout(timer);
    res.setHeader('Cache-Control', cacheControl);
    res.status(304).end();
    return;
  }
  if (!upstreamRes.ok) {
    clearTimeout(timer);
    try { await upstreamRes.body?.cancel(); } catch { /* noop */ }
    res.status(upstreamRes.status).json({ error: 'upstream error' });
    return;
  }

  const ctype = (upstreamRes.headers.get('content-type') ?? '').toLowerCase();
  // The timeout covers the body too (the same signal aborts the stream), or
  // an upstream dripping bytes would hold the function until the platform kills it.
  let result: Awaited<ReturnType<typeof readWithCap>>;
  try {
    result = await readWithCap(upstreamRes);
  } catch (err) {
    console.error('upstream body failed:', errorCode(err));
    res.status(502).json({ error: 'upstream fetch failed' });
    return;
  } finally {
    clearTimeout(timer);
  }
  if (!result.ok) {
    res.status(413).json({ error: result.reason });
    return;
  }
  const body = result.body;
  const ctypeOk =
    ctype.includes('text/calendar') ||
    ctype.includes('text/plain') ||
    ctype === '' ||
    body.trimStart().startsWith('BEGIN:VCALENDAR');
  if (!ctypeOk) {
    res.status(415).json({ error: 'unsupported content-type', got: ctype });
    return;
  }

  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.status(200).send(body);
}
