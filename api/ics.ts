import type { VercelRequest, VercelResponse } from '@vercel/node';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

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

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('ff')) return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
}

async function isPrivateHost(hostname: string): Promise<boolean> {
  const direct = isIP(hostname);
  if (direct === 4) return isPrivateIPv4(hostname);
  if (direct === 6) return isPrivateIPv6(hostname);
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    for (const a of addrs) {
      if (a.family === 4 && isPrivateIPv4(a.address)) return true;
      if (a.family === 6 && isPrivateIPv6(a.address)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

// Per-instance token bucket. Serverless instances don't share memory, so this
// only caps a burst that lands on one warm instance — a per-client brake, not a
// global quota. Idle buckets refill to full, so they are dropped rather than
// kept forever.
const RATE_BUCKETS = new Map<string, { tokens: number; refilledAt: number }>();
const RATE_PER_MIN = 60;
const RATE_MAX_BUCKETS = 5_000;

export function rateLimit(ip: string, now = Date.now()): boolean {
  if (RATE_BUCKETS.size >= RATE_MAX_BUCKETS && !RATE_BUCKETS.has(ip)) pruneRateBuckets(now);
  const bucket = RATE_BUCKETS.get(ip) ?? { tokens: RATE_PER_MIN, refilledAt: now };
  const elapsed = (now - bucket.refilledAt) / 60_000;
  bucket.tokens = Math.min(RATE_PER_MIN, bucket.tokens + elapsed * RATE_PER_MIN);
  bucket.refilledAt = now;
  RATE_BUCKETS.set(ip, bucket);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

// A bucket idle for a minute has refilled completely, so forgetting it changes
// nothing. If every bucket is live, drop the oldest to stay bounded.
function pruneRateBuckets(now: number): void {
  for (const [key, b] of RATE_BUCKETS) {
    if (now - b.refilledAt >= 60_000) RATE_BUCKETS.delete(key);
  }
  while (RATE_BUCKETS.size >= RATE_MAX_BUCKETS) {
    const oldest = RATE_BUCKETS.keys().next().value;
    if (oldest === undefined) break;
    RATE_BUCKETS.delete(oldest);
  }
}

export function resetRateLimit(): void {
  RATE_BUCKETS.clear();
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Why a URL may not be fetched, or null when it may: https only, and never a
// host that resolves to a private/loopback/link-local address.
async function blockedReason(url: URL): Promise<string | null> {
  if (url.protocol !== 'https:') return 'https required';
  if (await isPrivateHost(url.hostname)) return 'host not allowed';
  return null;
}

type UpstreamResult =
  | { ok: true; response: Response }
  | { ok: false; status: number; error: string };

// fetch() with redirect:'follow' would chase a Location to any address, so a
// public URL answering `302 Location: http://169.254.169.254/` would get the
// proxy to fetch cloud metadata (or localhost) for the caller. Follow redirects
// by hand instead and put every hop through the same check as the first URL.
// The operator's own secret-feed URL skips the first check (it may legitimately
// point anywhere); its redirects are still checked.
export async function fetchUpstream(
  start: URL,
  init: { headers: Record<string, string>; signal: AbortSignal },
  opts: { trustStart: boolean },
): Promise<UpstreamResult> {
  let url = start;
  for (let hop = 0; ; hop++) {
    if (hop > 0 || !opts.trustStart) {
      const reason = await blockedReason(url);
      if (reason) {
        return hop > 0
          ? { ok: false, status: 502, error: 'redirect ' + reason }
          : { ok: false, status: 400, error: reason };
      }
    }
    const response = await fetch(url, { ...init, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) return { ok: true, response };
    try { await response.body?.cancel(); } catch { /* noop */ }
    const location = response.headers.get('location');
    if (!location) return { ok: false, status: 502, error: 'redirect without location' };
    if (hop >= MAX_REDIRECTS) return { ok: false, status: 502, error: 'too many redirects' };
    try {
      url = new URL(location, url);
    } catch {
      return { ok: false, status: 502, error: 'invalid redirect location' };
    }
  }
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

// Vercel's edge overwrites x-real-ip / x-vercel-forwarded-for with the real
// client address; the first x-forwarded-for hop is client-supplied and only a
// fallback for other hosts.
function pickClientIp(req: VercelRequest): string {
  for (const name of ['x-real-ip', 'x-vercel-forwarded-for', 'x-forwarded-for']) {
    const raw = req.headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const first = value?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'If-None-Match, If-Modified-Since');
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
  const url = typeof req.query.url === 'string' ? req.query.url : null;

  let upstream: URL;
  if (id) {
    const u = secretFeedUrl(id);
    if (!u) { res.status(404).json({ error: 'unknown feed id' }); return; }
    try { upstream = new URL(u); } catch { res.status(500).json({ error: 'invalid feed configuration' }); return; }
  } else if (url) {
    try { upstream = new URL(url); } catch { res.status(400).json({ error: 'invalid url' }); return; }
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
    const result = await fetchUpstream(upstream, { headers, signal: controller.signal }, { trustStart: !!id });
    if (!result.ok) {
      clearTimeout(timer);
      res.status(result.status).json({ error: result.error });
      return;
    }
    upstreamRes = result.response;
  } catch (err) {
    clearTimeout(timer);
    res.status(502).json({ error: 'upstream fetch failed', detail: String((err as Error).message ?? err) });
    return;
  }
  clearTimeout(timer);

  const etag = upstreamRes.headers.get('etag');
  const lastMod = upstreamRes.headers.get('last-modified');
  if (etag) res.setHeader('ETag', etag);
  if (lastMod) res.setHeader('Last-Modified', lastMod);
  // A secret feed's id is its only credential, so its body must never sit in a
  // shared cache where the URL alone retrieves it; the browser still caches
  // and revalidates it privately.
  const cacheControl = id
    ? 'private, no-cache'
    : 'public, s-maxage=600, stale-while-revalidate=3600';

  if (upstreamRes.status === 304) {
    res.setHeader('Cache-Control', cacheControl);
    res.status(304).end();
    return;
  }
  if (!upstreamRes.ok) {
    res.status(upstreamRes.status).json({ error: 'upstream error' });
    return;
  }

  const ctype = (upstreamRes.headers.get('content-type') ?? '').toLowerCase();
  const result = await readWithCap(upstreamRes);
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
