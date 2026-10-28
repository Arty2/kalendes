import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import http from 'node:http';
import zlib from 'node:zlib';
import handler, {
  safeFetch,
  UnsafeRedirectError,
  pickClientIp,
  rateLimit,
  RATE_BUCKETS,
  MAX_BUCKETS,
  upstream,
  guardedLookup,
  isPrivateLiteral,
  isPublicHolidayFeed,
} from './ics';
import { isPublicHolidayFeed as appIsPublicHolidayFeed } from '../src/lib/feed-transport';
import { isPrivateHost as appIsPrivateHost } from '../src/lib/private-host';

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

describe('isPrivateLiteral ranges', () => {
  it('flags loopback, link-local, and private ranges', async () => {
    expect(isPrivateLiteral('127.0.0.1')).toBe(true);
    expect(isPrivateLiteral('169.254.169.254')).toBe(true);
    expect(isPrivateLiteral('10.1.2.3')).toBe(true);
    expect(isPrivateLiteral('192.168.0.1')).toBe(true);
    expect(isPrivateLiteral('::1')).toBe(true);
  });

  it('flags every private IPv6 range, and IPv4 hidden inside IPv6', async () => {
    for (const ip of [
      '::', 'fe80::1', 'febf::1', 'fec0::1', 'fd12:3456::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::10.0.0.1',
      '64:ff9b::a9fe:a9fe', '64:ff9b::192.168.1.1', '2002:7f00:1::',
    ]) expect(isPrivateLiteral(ip), ip).toBe(true);
  });

  it('lets public IPv6 through, including public IPv4 inside it', async () => {
    for (const ip of ['2606:4700::1111', '2001:db9::1', '::ffff:93.184.215.14', '64:ff9b::5db8:d70e', '2002:5db8:d70e::'])
      expect(isPrivateLiteral(ip), ip).toBe(false);
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
// An IP literal: judged up front, no DNS.
const FEED_URL = 'https://93.184.215.14/feed.ics';

type MockRes = VercelResponse & { statusCode: number; headers: Record<string, string>; body: unknown };

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) { res.headers[name.toLowerCase()] = value; return res; },
    removeHeader(name: string) { delete res.headers[name.toLowerCase()]; },
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
  upstream.fetch = fetchMock;
  return fetchMock;
}

describe('isPrivateLiteral', () => {
  it('judges IP literals, bracketed IPv6 included, and leaves names to the dial', () => {
    expect(isPrivateLiteral('127.0.0.1')).toBe(true);
    expect(isPrivateLiteral('[::1]')).toBe(true);
    expect(isPrivateLiteral('[::ffff:10.0.0.1]')).toBe(true);
    expect(isPrivateLiteral('[nope]')).toBe(true);
    expect(isPrivateLiteral('93.184.215.14')).toBe(false);
    expect(isPrivateLiteral('[2606:4700::1111]')).toBe(false);
    expect(isPrivateLiteral('example.com')).toBe(false);
  });
});

describe('guardedLookup', () => {
  const look = (host: string, all: boolean) =>
    new Promise<{ err: NodeJS.ErrnoException | null; addr: unknown }>((resolve) =>
      guardedLookup(host, { all } as never, ((err: NodeJS.ErrnoException | null, addr: unknown) =>
        resolve({ err, addr })) as never),
    );
  it('refuses a name that resolves to a private address, as the socket dials it', async () => {
    for (const all of [false, true]) {
      const { err } = await look('localhost', all);
      expect(err?.message).toMatch(/not allowed|ENOTFOUND/);
    }
  });
});

describe('upstream fetch', () => {
  it('decodes, identifies itself, and guards every hop but a secret feed\'s own URL', async () => {
    let ua: string | undefined;
    const srv = http.createServer((req, res) => {
      ua = req.headers['user-agent'];
      res.writeHead(200, { 'content-type': 'text/calendar', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync('BEGIN:VCALENDAR'));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const url = 'http://localhost:' + (srv.address() as { port: number }).port + '/';
    const init = { headers: { Accept: '*/*' }, signal: new AbortController().signal };
    try {
      const ok = await upstream.fetch(url, init, 0, true);
      expect(await ok.text()).toBe('BEGIN:VCALENDAR');
      expect(ok.headers.get('content-encoding')).toBeNull();
      expect(ua).toMatch(/kalendes/);
      // Any other hop is guarded, and guarded hops are https only.
      await expect(upstream.fetch(url, init, 1, true)).rejects.toThrow(/https required/);
      await expect(upstream.fetch(url, init, 0, false)).rejects.toThrow(/https required/);
      // A guarded https hop resolves through guardedLookup as it dials (no
      // server needed: the lookup refuses localhost before connecting); the
      // trusted hop dials it and is refused by the closed port instead.
      await expect(upstream.fetch('https://localhost:1/', init, 0, false)).rejects.toMatchObject({ code: 'EHOSTNOTALLOWED' });
      await expect(upstream.fetch('https://localhost:1/', init, 0, true)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    } finally {
      srv.closeAllConnections();
      srv.close();
    }
  });
});

describe('handler', () => {
  const realFetch = upstream.fetch;
  beforeEach(() => RATE_BUCKETS.clear());
  afterEach(() => {
    upstream.fetch = realFetch;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serves the app's own requests and refuses other sites'", async () => {
    const fetchMock = routes({ [FEED_URL]: { body: ICS } });
    const ask = async (headers: Record<string, string>) => {
      const res = mockRes();
      await handler(mockReq({}, { 'x-feed-url': encodeURIComponent(FEED_URL), host: 'kalendes.example', ...headers }), res);
      return res;
    };
    expect((await ask({ 'sec-fetch-site': 'same-origin' })).statusCode).toBe(200);
    expect((await ask({ 'sec-fetch-site': 'none' })).statusCode).toBe(200);
    // No fetch metadata: an Origin naming this host passes, as does none at all.
    expect((await ask({ origin: 'https://kalendes.example' })).statusCode).toBe(200);
    expect((await ask({})).statusCode).toBe(200);
    const calls = fetchMock.mock.calls.length;
    for (const headers of <Record<string, string>[]>[
      { 'sec-fetch-site': 'cross-site', origin: 'https://kalendes.example' },
      { 'sec-fetch-site': 'same-site' },
      { origin: 'https://evil.example' },
      { origin: 'null' },
    ]) {
      const res = await ask(headers);
      expect(res.statusCode).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    // Refused before any upstream request.
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('sends no CORS headers and answers no preflight', async () => {
    routes({ [FEED_URL]: { body: ICS } });
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }), res);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const pre = mockRes();
    await handler({ ...mockReq({}), method: 'OPTIONS' } as VercelRequest, pre);
    expect(pre.statusCode).toBe(405);
  });

  it('keeps a URL feed out of every shared cache', async () => {
    routes({ [FEED_URL]: { body: ICS } });
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vary']).toBe('X-Feed-Url, X-Feed-Id');
  });

  it('shares a public holiday feed asked for by ?url= through the edge cache', async () => {
    const HOLIDAYS =
      'https://calendar.google.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/public/basic.ics';
    routes({ [HOLIDAYS]: { body: ICS } });
    const res = mockRes();
    await handler(mockReq({ url: HOLIDAYS }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toMatch(/^public, s-maxage=/);
    expect(res.headers['vary']).toBeUndefined();
    // The same feed by header shares one path with every other feed: never cached.
    const viaHeader = mockRes();
    await handler(mockReq({}, { 'x-feed-url': encodeURIComponent(HOLIDAYS) }), viaHeader);
    expect(viaHeader.headers['cache-control']).toBe('no-store');
  });

  it('judges holiday feeds exactly as the app does', () => {
    const urls = [
      'https://calendar.google.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/public/basic.ics',
      'https://calendar.google.com/calendar/ical/el.greek%23holiday%40group.v.calendar.google.com/public/basic.ics',
      'https://calendar.google.com/calendar/ical/en-gb.uk%23holiday%40group.v.calendar.google.com/public/basic.ics',
      'https://calendar.google.com/calendar/ical/en.gr.official%23holiday%40group.v.calendar.google.com/public/basic.ics',
      'https://calendar.google.com/calendar/ical/me%40gmail.com/public/basic.ics',
      'https://calendar.google.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/private-x/basic.ics',
      'https://calendar.google.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/public/basic.ics?a=1',
      'http://calendar.google.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/public/basic.ics',
      'https://example.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/public/basic.ics',
      'not a url',
    ];
    for (const u of urls) expect([u, isPublicHolidayFeed(u)]).toEqual([u, appIsPublicHolidayFeed(u)]);
    expect(urls.filter(isPublicHolidayFeed)).toHaveLength(4);
  });

  it('refuses the same address literals the app refuses', () => {
    const literals = [
      '10.1.2.3', '172.16.0.1', '172.32.0.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '0.0.0.0',
      '100.64.0.1', '100.128.0.1', '192.0.0.8', '192.0.2.1', '198.18.0.1', '198.20.0.1', '198.51.100.1',
      '203.0.113.9', '224.0.0.1', '240.0.0.1', '8.8.8.8', '1.1.1.1',
      '[::]', '[::1]', '[fc00::1]', '[fd12::1]', '[fe80::1]', '[fec0::1]', '[ff02::1]',
      '[::ffff:192.168.1.1]', '[::ffff:8.8.8.8]', '[::7f00:1]', '[64:ff9b::a00:1]', '[64:ff9b::808:808]',
      '[2002:c0a8:101::]', '[2002:808:808::]', '[2001:4860:4860::8888]', '[2606:4700::1111]',
    ];
    for (const lit of literals) {
      const host = new URL('https://' + lit + '/').hostname;
      expect([lit, appIsPrivateHost(new URL('https://' + lit + '/'))]).toEqual([lit, isPrivateLiteral(host)]);
    }
  });

  it('takes the feed URL from the X-Feed-Url header', async () => {
    const odd = 'https://cal.example.com/ical/καλ.ics?k=a b';
    const target = new URL(odd).toString();
    routes({ [target]: { body: ICS } });
    const res = mockRes();
    await handler(mockReq({}, { 'x-feed-url': encodeURIComponent(odd) }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('prefers the header over a query url', async () => {
    routes({ [FEED_URL]: { body: ICS } });
    const res = mockRes();
    await handler(
      mockReq({ url: 'https://other.example.com/x.ics' }, { 'x-feed-url': encodeURIComponent(FEED_URL) }),
      res,
    );
    expect(res.statusCode).toBe(200);
  });

  it('rejects a header that is not percent-encoded properly', async () => {
    const res = mockRes();
    await handler(mockReq({}, { 'x-feed-url': '%E0%A4%A' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('applies the same guards to a header URL', async () => {
    const res = mockRes();
    await handler(mockReq({}, { 'x-feed-url': encodeURIComponent('http://127.0.0.1/x.ics') }), res);
    expect(res.statusCode).toBe(400);
  });

  it('logs an error code, never the host name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    upstream.fetch = vi.fn(async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND secret-host.example.com'), { code: 'ENOTFOUND' });
    });
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }), res);
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret-host');
    expect(spy.mock.calls[0]).toContain('ENOTFOUND');
    spy.mockRestore();
  });

  it('times out an upstream that drips its body', async () => {
    vi.useFakeTimers();
    try {
      upstream.fetch = vi.fn(async (_u: string, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n'));
            init?.signal?.addEventListener('abort', () => c.error(new Error('aborted')));
          },
        });
        return new Response(body, { headers: { 'content-type': 'text/calendar' } });
      });
      const res = mockRes();
      const done = handler(mockReq({ url: FEED_URL }), res);
      await vi.advanceTimersByTimeAsync(10_000);
      await done;
      expect(res.statusCode).toBe(502);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never caches an upstream error', async () => {
    routes({ [FEED_URL]: { body: 'not found', status: 404 } });
    const res = mockRes();
    await handler(mockReq({ url: FEED_URL }), res);
    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 400 when the dial-time guard refuses the host', async () => {
    upstream.fetch = vi.fn(async () => {
      throw Object.assign(new Error('host not allowed'), { code: 'EHOSTNOTALLOWED' });
    });
    const res = mockRes();
    await handler(mockReq({ url: 'https://rebind.example/feed.ics' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('refuses a private IP literal up front', async () => {
    const res = mockRes();
    await handler(mockReq({ url: 'https://[::1]/feed.ics' }), res);
    expect(res.statusCode).toBe(400);
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

  it('takes a secret feed id from X-Feed-Id and stores none of it', async () => {
    vi.stubEnv('SECRET_FEED_IDS', 'team');
    vi.stubEnv('FEED_TEAM_URL', FEED_URL);
    routes({ [FEED_URL]: { body: ICS } });
    const res = mockRes();
    await handler(mockReq({}, { 'x-feed-id': 'team' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vary']).toBe('X-Feed-Url, X-Feed-Id');
    const unknown = mockRes();
    await handler(mockReq({}, { 'x-feed-id': 'other' }), unknown);
    expect(unknown.statusCode).toBe(404);
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
