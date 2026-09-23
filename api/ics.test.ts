import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, {
  safeFetch,
  isPrivateHost,
  UnsafeRedirectError,
  pickClientIp,
  rateLimit,
  RATE_BUCKETS,
  MAX_BUCKETS,
} from './ics';

// A fake fetch driven by a scripted list of responses (one per hop). Each entry
// is either a redirect (status + location) or a terminal body. Records the URLs
// it was asked to fetch so we can assert the loop stopped where expected.
function scriptedFetch(
  steps: Array<{ status: number; location?: string; body?: string }>,
) {
  const calls: string[] = [];
  let i = 0;
  const impl = async (url: string): Promise<Response> => {
    calls.push(url);
    const step = steps[i++] ?? { status: 200, body: 'END:VCALENDAR' };
    const headers = new Headers();
    if (step.location) headers.set('location', step.location);
    return new Response(step.body ?? null, { status: step.status, headers });
  };
  return { impl, calls };
}

// Treat these hostnames as private for the test, without touching real DNS.
const fakeIsPrivate = async (hostname: string): Promise<boolean> =>
  hostname === '169.254.169.254' || hostname === '127.0.0.1' || hostname === 'internal.local';

const ac = () => new AbortController().signal;

describe('safeFetch redirect validation', () => {
  it('returns the response for a non-redirect (0 hops)', async () => {
    const { impl, calls } = scriptedFetch([{ status: 200, body: 'BEGIN:VCALENDAR' }]);
    const res = await safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
      fetchImpl: impl,
      isPrivate: fakeIsPrivate,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('BEGIN:VCALENDAR');
    expect(calls).toEqual(['https://feed.example.com/cal.ics']);
  });

  it('follows a redirect to another public https host', async () => {
    const { impl, calls } = scriptedFetch([
      { status: 302, location: 'https://cdn.example.net/real.ics' },
      { status: 200, body: 'BEGIN:VCALENDAR' },
    ]);
    const res = await safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
      fetchImpl: impl,
      isPrivate: fakeIsPrivate,
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      'https://feed.example.com/cal.ics',
      'https://cdn.example.net/real.ics',
    ]);
  });

  it('rejects a redirect to a private/link-local host (cloud metadata SSRF)', async () => {
    const { impl } = scriptedFetch([
      { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
    ]);
    await expect(
      safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
        fetchImpl: impl,
        isPrivate: fakeIsPrivate,
      }),
    ).rejects.toBeInstanceOf(UnsafeRedirectError);
  });

  it('rejects a redirect that downgrades to http, even to a public host', async () => {
    const { impl } = scriptedFetch([
      { status: 302, location: 'http://feed.example.com/cal.ics' },
    ]);
    await expect(
      safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
        fetchImpl: impl,
        isPrivate: fakeIsPrivate,
      }),
    ).rejects.toBeInstanceOf(UnsafeRedirectError);
  });

  it('rejects a redirect to a private https host', async () => {
    const { impl } = scriptedFetch([{ status: 301, location: 'https://127.0.0.1/cal.ics' }]);
    await expect(
      safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
        fetchImpl: impl,
        isPrivate: fakeIsPrivate,
      }),
    ).rejects.toBeInstanceOf(UnsafeRedirectError);
  });

  it('rejects a chain longer than the hop cap', async () => {
    // Seven redirects, each to a fresh public host — exceeds MAX_REDIRECTS (5).
    const steps = Array.from({ length: 7 }, (_, i) => ({
      status: 302,
      location: `https://hop${i + 1}.example.com/cal.ics`,
    }));
    const { impl } = scriptedFetch(steps);
    await expect(
      safeFetch('https://feed.example.com/cal.ics', { Accept: '*/*' }, ac(), {
        fetchImpl: impl,
        isPrivate: fakeIsPrivate,
      }),
    ).rejects.toBeInstanceOf(UnsafeRedirectError);
  });

  it('drops conditional headers when following a redirect', async () => {
    const seen: Array<Record<string, string>> = [];
    const impl = async (_url: string, init: RequestInit): Promise<Response> => {
      seen.push({ ...(init.headers as Record<string, string>) });
      if (seen.length === 1) {
        return new Response(null, { status: 302, headers: new Headers({ location: 'https://cdn.example.net/x.ics' }) });
      }
      return new Response('BEGIN:VCALENDAR', { status: 200 });
    };
    await safeFetch(
      'https://feed.example.com/cal.ics',
      { Accept: 'text/calendar', 'If-None-Match': '"abc"' },
      ac(),
      { fetchImpl: impl, isPrivate: fakeIsPrivate },
    );
    expect(seen[0]!['If-None-Match']).toBe('"abc"');
    expect(seen[1]!['If-None-Match']).toBeUndefined();
  });
});

describe('isPrivateHost (literal IPs, no DNS)', () => {
  it('flags loopback, link-local, and private ranges', async () => {
    expect(await isPrivateHost('127.0.0.1')).toBe(true);
    expect(await isPrivateHost('169.254.169.254')).toBe(true);
    expect(await isPrivateHost('10.1.2.3')).toBe(true);
    expect(await isPrivateHost('192.168.0.1')).toBe(true);
    expect(await isPrivateHost('::1')).toBe(true);
  });
});

type IpHeaders = Record<string, string | string[] | undefined>;
const reqWith = (headers: IpHeaders, remote?: string) =>
  ({ headers, socket: { remoteAddress: remote } }) as Parameters<typeof pickClientIp>[0];

describe('pickClientIp', () => {
  it('prefers the platform-set x-real-ip over a spoofable x-forwarded-for', () => {
    const ip = pickClientIp(
      reqWith({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }),
    );
    expect(ip).toBe('203.0.113.9');
  });

  it('ignores a non-IP x-real-ip and falls back to the first forwarded value', () => {
    const ip = pickClientIp(reqWith({ 'x-real-ip': 'not-an-ip', 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }));
    expect(ip).toBe('198.51.100.7');
  });

  it('falls back to the socket address when no headers are present', () => {
    expect(pickClientIp(reqWith({}, '192.0.2.44'))).toBe('192.0.2.44');
    expect(pickClientIp(reqWith({}))).toBe('unknown');
  });
});

describe('rateLimit', () => {
  beforeEach(() => RATE_BUCKETS.clear());

  it('allows up to the per-minute cap then blocks', () => {
    let allowed = 0;
    for (let i = 0; i < 65; i++) if (rateLimit('203.0.113.1')) allowed++;
    expect(allowed).toBe(60);
    expect(rateLimit('203.0.113.1')).toBe(false);
  });

  it('keeps the bucket map bounded under a flood of distinct IPs', () => {
    for (let i = 0; i < MAX_BUCKETS + 500; i++) rateLimit(`10.9.${(i >> 8) & 255}.${i & 255}`);
    expect(RATE_BUCKETS.size).toBeLessThanOrEqual(MAX_BUCKETS);
  });
});

// --- Handler-level: what the proxy answers, and what may be cached ---

const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
// An IP literal skips the DNS lookup in isPrivateHost.
const FEED_URL = 'https://93.184.215.14/feed.ics';

type MockRes = VercelResponse & { statusCode: number; headers: Record<string, string>; body: unknown };

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) { res.headers[name.toLowerCase()] = value; return res; },
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
    send(body: unknown) { res.body = body; return res; },
    end() { return res; },
  };
  return res as unknown as MockRes;
}

function mockReq(query: Record<string, string>, headers: Record<string, string> = {}): VercelRequest {
  return { method: 'GET', query, headers: { 'x-real-ip': '198.51.100.7', ...headers } } as unknown as VercelRequest;
}

// Answer by URL: each entry is a redirect Location or a final response.
function routes(map: Record<string, { location: string; status?: number } | { body: string | null; status?: number }>) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    expect(init?.redirect).toBe('manual');
    const hit = map[String(input)];
    if (!hit) throw new Error('unexpected fetch ' + String(input));
    if ('location' in hit) return new Response(null, { status: hit.status ?? 302, headers: { location: hit.location } });
    return new Response(hit.body, { status: hit.status ?? 200, headers: { 'content-type': 'text/calendar' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('handler', () => {
  beforeEach(() => RATE_BUCKETS.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('lets the edge cache a good URL feed', async () => {
    routes({ [FEED_URL]: { body: ICS } });
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toMatch(/^public, s-maxage=/);
  });

  it('never caches an upstream error', async () => {
    routes({ [FEED_URL]: { body: 'not found', status: 404 } });
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }), res);
    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('never caches a rejected request', async () => {
    const res = mockRes();
    await handler(mockReq({ url: 'http://example.com/feed.ics' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps a secret feed out of shared caches, 200 and 304 alike', async () => {
    vi.stubEnv('SECRET_FEED_IDS', 'team');
    vi.stubEnv('FEED_TEAM_URL', FEED_URL);
    routes({ [FEED_URL]: { body: ICS } });
    const ok = mockRes();
    await handler(mockReq({ id: 'team' }), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('private, no-cache');

    routes({ [FEED_URL]: { body: null, status: 304 } });
    const notModified = mockRes();
    await handler(mockReq({ id: 'team' }, { 'if-none-match': '"v1"' }), notModified);
    expect(notModified.statusCode).toBe(304);
    expect(notModified.headers['cache-control']).toBe('private, no-cache');
  });

  it('answers 429 with Retry-After once a client runs out', async () => {
    for (let i = 0; i < 60; i++) rateLimit('198.51.100.7');
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }), res);
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
  });

  it('refuses a redirect to cloud metadata without caching the refusal', async () => {
    const fetchMock = routes({ [FEED_URL]: { location: 'https://169.254.169.254/latest/meta-data/' } });
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'redirect not allowed' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("checks a secret feed's redirects too", async () => {
    vi.stubEnv('SECRET_FEED_IDS', 'team');
    vi.stubEnv('FEED_TEAM_URL', FEED_URL);
    routes({ [FEED_URL]: { location: 'https://192.168.1.1/' } });
    const res = mockRes();
    await handler(mockReq({ id: 'team' }), res);
    expect(res.statusCode).toBe(400);
  });
});
