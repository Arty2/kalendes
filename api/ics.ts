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

const RATE_BUCKETS = new Map<string, { tokens: number; refilledAt: number }>();
const RATE_PER_MIN = 60;

function rateLimit(ip: string): boolean {
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

function pickClientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0]!.trim();
  if (Array.isArray(fwd) && fwd[0]) return fwd[0]!.split(',')[0]!.trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'If-None-Match, If-Modified-Since');

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
    res.status(429).json({ error: 'rate limited' });
    return;
  }

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  const url = typeof req.query.url === 'string' ? req.query.url : null;

  let upstream: string;
  if (id) {
    const u = secretFeedUrl(id);
    if (!u) { res.status(404).json({ error: 'unknown feed id' }); return; }
    upstream = u;
  } else if (url) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { res.status(400).json({ error: 'invalid url' }); return; }
    if (parsed.protocol !== 'https:') { res.status(400).json({ error: 'https required' }); return; }
    if (await isPrivateHost(parsed.hostname)) {
      res.status(400).json({ error: 'host not allowed' });
      return;
    }
    upstream = parsed.toString();
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
    upstreamRes = await fetch(upstream, { headers, signal: controller.signal, redirect: 'follow' });
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
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');

  if (upstreamRes.status === 304) {
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

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.status(200).send(body);
}
