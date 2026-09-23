import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler, { rateLimit, resetRateLimit } from './ics';

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

function upstream(body: string | null, init: ResponseInit = {}): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, init)));
}

beforeEach(() => resetRateLimit());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('api/ics cache headers', () => {
  it('lets the edge cache a good URL feed', async () => {
    upstream(ICS, { status: 200, headers: { 'content-type': 'text/calendar' } });
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toMatch(/^public, s-maxage=/);
  });

  it('never caches an upstream error', async () => {
    upstream('not found', { status: 404 });
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

  it('keeps a secret feed out of shared caches', async () => {
    vi.stubEnv('SECRET_FEED_IDS', 'team');
    vi.stubEnv('FEED_TEAM_URL', FEED_URL);
    upstream(ICS, { status: 200, headers: { 'content-type': 'text/calendar' } });
    const res = mockRes();
    await handler(mockReq({ id: 'team' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-cache');
  });

  it('marks a secret feed 304 private too', async () => {
    vi.stubEnv('SECRET_FEED_IDS', 'team');
    vi.stubEnv('FEED_TEAM_URL', FEED_URL);
    upstream(null, { status: 304 });
    const res = mockRes();
    await handler(mockReq({ id: 'team' }, { 'if-none-match': '"v1"' }), res);
    expect(res.statusCode).toBe(304);
    expect(res.headers['cache-control']).toBe('private, no-cache');
  });
});

describe('api/ics rate limit', () => {
  it('allows a burst of 60 per minute per client, then refills', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) expect(rateLimit('a', t0)).toBe(true);
    expect(rateLimit('a', t0)).toBe(false);
    expect(rateLimit('b', t0)).toBe(true);
    expect(rateLimit('a', t0 + 1_000)).toBe(true);
  });

  it('answers 429 with Retry-After', async () => {
    for (let i = 0; i < 60; i++) rateLimit('198.51.100.7');
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }), res);
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
  });

  it('keys on the edge-set client IP, not a spoofable forwarded-for hop', async () => {
    for (let i = 0; i < 60; i++) rateLimit('198.51.100.7');
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }, { 'x-forwarded-for': '203.0.113.9' }), res);
    expect(res.statusCode).toBe(429);
  });

  it('stays bounded under many distinct clients', () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 6_000; i++) rateLimit('ip' + i, t0);
    // A fresh client still gets a full bucket once idle buckets are pruned.
    expect(rateLimit('late', t0 + 60_000)).toBe(true);
  });
});
