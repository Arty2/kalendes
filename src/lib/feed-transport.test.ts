// @vitest-environment happy-dom
import {
  BLOCKED_RETRY_MS,
  DIRECT_TIMEOUT_MS,
  MAX_FEED_BYTES,
  DirectFetchUnavailable,
  followsFetchMode,
  PrivateNetworkFeed,
  UNREACHABLE_RETRY_MS,
  canTryDirect,
  isPublicHolidayFeed,
  fetchFeed,
  markHostBlocked,
  readFeedText,
  resetHostMemory,
} from './feed-transport';

const FEED = 'https://cal.example.com/team.ics';
const user = { kind: 'user', url: FEED } as const;

type Call = { url: string; init: RequestInit };

function stubFetch(answer: (url: string, init: RequestInit) => Promise<Response> | Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return answer(url, init);
  }));
  return calls;
}

const corsBlocked = (): never => {
  throw new TypeError('Failed to fetch');
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  resetHostMemory();
});

describe('fetchFeed', () => {
  it('reads a feed straight from a host that allows it', async () => {
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    const { via, response } = await fetchFeed(user, { mode: 'auto', conditional: { 'If-None-Match': '"x"' } });
    expect(via).toBe('direct');
    expect(await response.text()).toBe('BEGIN:VCALENDAR');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(FEED);
    // No cookies, no referrer, and no custom headers (they would need a preflight).
    expect(calls[0]!.init.credentials).toBe('omit');
    expect(calls[0]!.init.referrerPolicy).toBe('no-referrer');
    expect(calls[0]!.init.headers).toBeUndefined();
  });

  it('falls back to the proxy, URL in a header, when the host blocks it — and remembers', async () => {
    const calls = stubFetch((url) => (url === FEED ? corsBlocked() : new Response('BEGIN:VCALENDAR')));
    const first = await fetchFeed(user, { mode: 'auto', conditional: { 'If-None-Match': '"x"' } });
    expect(first.via).toBe('proxy');
    expect(calls.map((c) => c.url)).toEqual([FEED, '/api/ics']);
    const headers = calls[1]!.init.headers as Record<string, string>;
    expect(decodeURIComponent(headers['X-Feed-Url']!)).toBe(FEED);
    expect(headers['If-None-Match']).toBe('"x"');

    // The next refresh doesn't knock on the host again.
    await fetchFeed(user, { mode: 'auto' });
    expect(calls.map((c) => c.url)).toEqual([FEED, '/api/ics', '/api/ics']);
  });

  it('doesn\'t blame the host when the connection is down', async () => {
    stubFetch(corsBlocked);
    await expect(fetchFeed(user, { mode: 'auto' })).rejects.toThrow(TypeError);
    expect(canTryDirect(FEED)).toBe(true);
  });

  it('doesn\'t blame the host when the proxy can\'t reach it either', async () => {
    stubFetch((url) => (url === FEED ? corsBlocked() : new Response('', { status: 502 })));
    expect((await fetchFeed(user, { mode: 'auto' })).response.status).toBe(502);
    expect(canTryDirect(FEED)).toBe(true);
  });

  it('treats a web page as no answer and asks the proxy, then goes there first', async () => {
    const calls = stubFetch((url) =>
      url === FEED
        ? new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
        : new Response('BEGIN:VCALENDAR'),
    );
    expect((await fetchFeed(user, { mode: 'auto' })).via).toBe('proxy');
    expect(calls).toHaveLength(2);
    // One round-trip from now on, not two.
    await fetchFeed(user, { mode: 'auto' });
    expect(calls).toHaveLength(3);
  });

  it('keeps a calendar a host labels text/html', async () => {
    const calls = stubFetch(() =>
      new Response('\r\nBEGIN:VCALENDAR\r\nEND:VCALENDAR', { headers: { 'content-type': 'text/html' } }),
    );
    for (const mode of ['auto', 'direct'] as const) {
      const fetched = await fetchFeed(user, { mode });
      expect(fetched.via).toBe('direct');
      expect(await readFeedText(fetched)).toContain('BEGIN:VCALENDAR');
    }
    expect(calls).toHaveLength(2);
  });

  it('goes to the proxy first after the host refused a browser but served the proxy', async () => {
    const calls = stubFetch((url) =>
      url === FEED ? new Response('nope', { status: 403 }) : new Response('BEGIN:VCALENDAR'),
    );
    expect((await fetchFeed(user, { mode: 'auto' })).via).toBe('proxy');
    expect(calls).toHaveLength(2);
    expect(canTryDirect(FEED)).toBe(false);
  });

  it("doesn't blame the host when both routes get an error", async () => {
    stubFetch(() => new Response('gone', { status: 404 }));
    expect((await fetchFeed(user, { mode: 'auto' })).response.status).toBe(404);
    expect(canTryDirect(FEED)).toBe(true);
  });

  it('gives up on a host that hangs and uses the proxy', async () => {
    vi.useFakeTimers();
    stubFetch((url, init) =>
      url === FEED
        ? new Promise<Response>((_, reject) =>
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
          )
        : new Response('BEGIN:VCALENDAR'),
    );
    const pending = fetchFeed(user, { mode: 'auto' });
    await vi.advanceTimersByTimeAsync(DIRECT_TIMEOUT_MS);
    expect((await pending).via).toBe('proxy');
  });

  it('stops when the caller cancels, without trying the proxy', async () => {
    const outer = new AbortController();
    const calls = stubFetch((_url, init) =>
      new Promise<Response>((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
      ),
    );
    const pending = fetchFeed(user, { mode: 'auto', signal: outer.signal });
    outer.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
    expect(calls).toHaveLength(1);
    expect(canTryDirect(FEED)).toBe(true);
  });

  it('still aborts a body read when the caller gives up', async () => {
    const outer = new AbortController();
    stubFetch((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n'));
          init.signal!.addEventListener('abort', () => c.error(init.signal!.reason));
        },
      });
      return new Response(body);
    });
    const fetched = await fetchFeed(user, { mode: 'auto', signal: outer.signal });
    const reading = readFeedText(fetched, outer.signal);
    outer.abort(new Error('timed out'));
    await expect(reading).rejects.toThrow('timed out');
  });

  it('passes the signal straight through in Direct mode', async () => {
    const outer = new AbortController();
    const add = vi.spyOn(outer.signal, 'addEventListener');
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    await fetchFeed(user, { mode: 'direct', signal: outer.signal });
    expect(calls[0]!.init.signal).toBe(outer.signal);
    expect(add).not.toHaveBeenCalled();
  });

  it('shows a host\'s own error instead of asking the proxy', async () => {
    for (const status of [404, 429, 503]) {
      const calls = stubFetch(() => new Response('', { status }));
      const { via, response } = await fetchFeed(user, { mode: 'auto' });
      expect([via, response.status, calls.length]).toEqual(['direct', status, 1]);
      expect(canTryDirect(FEED)).toBe(true);
    }
  });

  it('holds the abort listener only while waiting for headers', async () => {
    const outer = new AbortController();
    const add = vi.spyOn(outer.signal, 'addEventListener');
    const remove = vi.spyOn(outer.signal, 'removeEventListener');
    stubFetch(() => new Response('BEGIN:VCALENDAR'));
    const fetched = await fetchFeed(user, { mode: 'auto', signal: outer.signal });
    expect([add.mock.calls.length, remove.mock.calls.length]).toEqual([1, 1]);
    expect(await readFeedText(fetched, outer.signal)).toBe('BEGIN:VCALENDAR');
    expect(add.mock.calls.length).toBe(remove.mock.calls.length);
  });

  it('asks the proxy for a 200 that is not a calendar', async () => {
    const calls = stubFetch((url) =>
      url === FEED
        ? new Response('{"error":"expired"}', { headers: { 'content-type': 'application/json' } })
        : new Response('BEGIN:VCALENDAR'),
    );
    expect((await fetchFeed(user, { mode: 'auto' })).via).toBe('proxy');
    expect(calls).toHaveLength(2);
  });

  it('gives a host that didn\'t answer an hour, a week once it happens again', async () => {
    stubFetch((url) => (url === FEED ? corsBlocked() : new Response('BEGIN:VCALENDAR')));
    const t0 = Date.now();
    await fetchFeed(user, { mode: 'auto' });
    expect(canTryDirect(FEED, t0 + UNREACHABLE_RETRY_MS - 1000)).toBe(false);
    expect(canTryDirect(FEED, t0 + UNREACHABLE_RETRY_MS + 1000)).toBe(true);
    markHostBlocked('cal.example.com', 'unreachable', t0 + UNREACHABLE_RETRY_MS + 1000);
    expect(canTryDirect(FEED, t0 + 2 * UNREACHABLE_RETRY_MS + 2000)).toBe(false);
    expect(canTryDirect(FEED, t0 + BLOCKED_RETRY_MS + UNREACHABLE_RETRY_MS + 2000)).toBe(true);
  });

  it('hands a redirect to the proxy in Auto, which checks every hop', async () => {
    const opaqueRedirect = (): Response => {
      const r = new Response(null, { status: 200 });
      Object.defineProperty(r, 'type', { value: 'opaqueredirect' });
      Object.defineProperty(r, 'ok', { value: false });
      Object.defineProperty(r, 'status', { value: 0 });
      return r;
    };
    const calls = stubFetch((url) => (url === FEED ? opaqueRedirect() : new Response('', { status: 404 })));
    // The host is remembered even though the proxy failed too.
    const { via } = await fetchFeed(user, { mode: 'auto' });
    expect(via).toBe('proxy');
    expect(calls[0]!.init.redirect).toBe('manual');
    expect(canTryDirect(FEED)).toBe(false);
  });

  it('follows a redirect in Direct mode, unless it lands on a private address', async () => {
    const redirectedTo = (to: string): Response => {
      const r = new Response('BEGIN:VCALENDAR', { headers: { 'content-type': 'text/calendar' } });
      Object.defineProperty(r, 'redirected', { value: true });
      Object.defineProperty(r, 'url', { value: to });
      return r;
    };
    let target = 'https://cdn.example.net/cal.ics';
    const calls = stubFetch(() => redirectedTo(target));
    const fetched = await fetchFeed(user, { mode: 'direct' });
    expect(calls[0]!.init.redirect).toBe('follow');
    expect(await readFeedText(fetched)).toBe('BEGIN:VCALENDAR');
    for (target of ['https://192.168.1.1/admin', 'https://[::ffff:c0a8:101]/x', 'https://router.local/x']) {
      await expect(fetchFeed(user, { mode: 'direct' })).rejects.toBeInstanceOf(PrivateNetworkFeed);
    }
  });

  it('remembers a refusing host even when the proxy fails too', async () => {
    stubFetch(() => new Response('', { status: 403 }));
    await fetchFeed(user, { mode: 'auto' });
    expect(canTryDirect(FEED)).toBe(false);
  });

  it('never hands a bad address to the server in Direct mode', async () => {
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    await expect(fetchFeed({ kind: 'user', url: 'not a url' }, { mode: 'direct' })).rejects.toThrow('Invalid');
    expect(calls).toHaveLength(0);
  });

  it('keeps marks another tab wrote meanwhile', () => {
    markHostBlocked('a.example');
    // Another tab writes its own mark straight to storage.
    const stored = JSON.parse(localStorage.getItem('calendar-timeline:feed-hosts')!);
    stored['b.example'] = { until: Date.now() + BLOCKED_RETRY_MS, misses: 0 };
    localStorage.setItem('calendar-timeline:feed-hosts', JSON.stringify(stored));
    markHostBlocked('c.example');
    const after = Object.keys(JSON.parse(localStorage.getItem('calendar-timeline:feed-hosts')!)).sort();
    expect(after).toEqual(['a.example', 'b.example', 'c.example']);
    expect(canTryDirect('https://b.example/x.ics')).toBe(false);
  });

  it('refuses http:// up front in every mode, with advice that helps', async () => {
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    for (const mode of ['auto', 'direct', 'proxy'] as const) {
      const err = await fetchFeed({ kind: 'user', url: 'http://cal.example.com/a.ics' }, { mode }).catch((e: Error) => e);
      expect((err as Error).message).toContain('https://');
      expect((err as Error).message).not.toContain('Set Fetch calendars');
    }
    expect(calls).toHaveLength(0);
  });

  it('sends a URL with a username or password to the proxy, never reading it directly', async () => {
    const withAuth = { kind: 'user', url: 'https://me:secret@cal.example.com/a.ics' } as const;
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    expect((await fetchFeed(withAuth, { mode: 'auto' })).via).toBe('proxy');
    expect(calls.map((c) => c.url)).toEqual(['/api/ics']);
    expect(canTryDirect(FEED)).toBe(true);
    await expect(fetchFeed(withAuth, { mode: 'direct' })).rejects.toThrow('username or password');
  });

  it('starts a miss streak afresh once the last mark is long gone', () => {
    const t0 = Date.now();
    markHostBlocked('cal.example.com', 'unreachable', t0);
    // A month later: a single miss again holds an hour, not a week.
    const later = t0 + 30 * 24 * 3_600_000;
    markHostBlocked('cal.example.com', 'unreachable', later);
    expect(canTryDirect(FEED, later + UNREACHABLE_RETRY_MS + 1000)).toBe(true);
  });

  it('stops reading a non-calendar body once its start gives it away', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new TextEncoder().encode(pulled === 1 ? '<!doctype html><html>' : 'x'.repeat(1024)));
        if (pulled > 1000) c.close();
      },
    });
    stubFetch((url) =>
      url === FEED
        ? new Response(body, { headers: { 'content-type': 'text/html' } })
        : new Response('BEGIN:VCALENDAR'),
    );
    expect((await fetchFeed(user, { mode: 'auto' })).via).toBe('proxy');
    expect(pulled).toBeLessThan(5);
  });

  it('says which feeds follow the fetch mode', () => {
    expect(followsFetchMode(FEED)).toBe(true);
    expect(followsFetchMode('https://calendar.google.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/public/basic.ics')).toBe(false);
    expect(followsFetchMode('http://cal.example.com/a.ics')).toBe(false);
    expect(followsFetchMode('https://192.168.1.1/a.ics')).toBe(false);
    expect(followsFetchMode('nonsense')).toBe(false);
  });

  it('refuses private-network hosts in every mode, sending nothing', async () => {
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    for (const url of [
      'https://192.168.1.1/cal.ics', 'https://10.0.0.5/a.ics', 'https://localhost:8443/a.ics',
      'https://nas.local/a.ics', 'https://intranet/a.ics', 'https://[::1]/a.ics', 'https://[fd00::1]/a.ics',
      // IPv4 inside IPv6, as URL writes it: mapped, compatible, NAT64, 6to4.
      'https://[::ffff:192.168.1.1]/a.ics', 'https://[::7f00:1]/a.ics',
      'https://[64:ff9b::a00:1]/a.ics', 'https://[2002:c0a8:101::]/a.ics',
      'https://198.18.0.1/a.ics', 'https://0x7f.1/a.ics',
    ]) {
      for (const mode of ['auto', 'direct', 'proxy'] as const) {
        await expect(fetchFeed({ kind: 'user', url }, { mode })).rejects.toBeInstanceOf(PrivateNetworkFeed);
      }
    }
    expect(calls).toHaveLength(0);
  });

  it('clears a host\'s mark when Direct mode reads it', async () => {
    markHostBlocked('cal.example.com');
    stubFetch(() => new Response('BEGIN:VCALENDAR'));
    await fetchFeed(user, { mode: 'direct' });
    expect(canTryDirect(FEED)).toBe(true);
  });

  it('uses only the proxy in Via server mode', async () => {
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    expect((await fetchFeed(user, { mode: 'proxy' })).via).toBe('proxy');
    expect(calls.map((c) => c.url)).toEqual(['/api/ics']);
  });

  it('sends secret feeds by id, through the proxy', async () => {
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    await fetchFeed({ kind: 'secret', id: 'work' }, { mode: 'auto' });
    expect(calls.map((c) => c.url)).toEqual(['/api/ics?id=work']);
  });
});

describe('Direct mode', () => {
  it('reads from the host with no timeout of its own', async () => {
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    expect((await fetchFeed(user, { mode: 'direct' })).via).toBe('direct');
    expect(calls.map((c) => c.url)).toEqual([FEED]);
  });

  it('reports a blocked host instead of using the proxy', async () => {
    const calls = stubFetch(corsBlocked);
    await expect(fetchFeed(user, { mode: 'direct' })).rejects.toBeInstanceOf(DirectFetchUnavailable);
    expect(calls.map((c) => c.url)).toEqual([FEED]);
  });

  it('explains an http:// feed and a web page', async () => {
    stubFetch(() => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    await expect(fetchFeed({ kind: 'user', url: 'http://cal.example.com/a.ics' }, { mode: 'direct' }))
      .rejects.toThrow('Only https://');
    await expect(fetchFeed(user, { mode: 'direct' })).rejects.toThrow('didn’t answer with a calendar');
  });

  it('passes a host error through as the answer', async () => {
    stubFetch(() => new Response('gone', { status: 404 }));
    const { response, via } = await fetchFeed(user, { mode: 'direct' });
    expect([via, response.status]).toEqual(['direct', 404]);
  });

  it('asks a remembered host again, but not one known to refuse', async () => {
    markHostBlocked('cal.example.com');
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    expect((await fetchFeed(user, { mode: 'direct' })).via).toBe('direct');
    const google = { kind: 'user', url: 'https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics' } as const;
    await expect(fetchFeed(google, { mode: 'direct' })).rejects.toBeInstanceOf(DirectFetchUnavailable);
    expect(calls).toHaveLength(1);
  });
});

describe('public holiday feeds', () => {
  const HOLIDAYS =
    'https://calendar.google.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/public/basic.ics';

  it('recognises Google holiday calendars and nothing else', () => {
    expect(isPublicHolidayFeed(HOLIDAYS)).toBe(true);
    expect(isPublicHolidayFeed('https://calendar.google.com/calendar/ical/en.gr.official%23holiday%40group.v.calendar.google.com/public/basic.ics')).toBe(true);
    expect(isPublicHolidayFeed('https://calendar.google.com/calendar/ical/me%40gmail.com/public/basic.ics')).toBe(false);
    expect(isPublicHolidayFeed('https://calendar.google.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/private-x/basic.ics')).toBe(false);
    expect(isPublicHolidayFeed(HOLIDAYS + '?x=1')).toBe(false);
    expect(isPublicHolidayFeed(HOLIDAYS.replace('calendar.google.com', 'evil.example.com'))).toBe(false);
  });

  it('go through the proxy by URL in every mode, validators included', async () => {
    for (const mode of ['auto', 'direct', 'proxy'] as const) {
      const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
      const { via } = await fetchFeed({ kind: 'user', url: HOLIDAYS }, { mode, conditional: { 'If-None-Match': '"v"' } });
      expect(via).toBe('proxy');
      expect(calls[0]!.url).toBe('/api/ics?url=' + encodeURIComponent(HOLIDAYS));
      expect((calls[0]!.init.headers as Record<string, string>)['If-None-Match']).toBe('"v"');
    }
  });
});

describe('canTryDirect', () => {
  it('skips hosts known to block cross-origin reads', () => {
    expect(canTryDirect('https://calendar.google.com/calendar/ical/x/public/basic.ics')).toBe(false);
    expect(canTryDirect('https://outlook.office365.com/owa/calendar/x/calendar.ics')).toBe(false);
    expect(canTryDirect('https://p01-caldav.icloud.com/published/2/x')).toBe(false);
  });

  it('skips http:// feeds, which an https page may not read', () => {
    expect(canTryDirect('http://cal.example.com/a.ics')).toBe(false);
  });

  it('tries a blocked host again after a week', () => {
    const now = Date.now();
    markHostBlocked('cal.example.com', 'refused', now);
    expect(canTryDirect(FEED, now + BLOCKED_RETRY_MS - 1)).toBe(false);
    expect(canTryDirect(FEED, now + BLOCKED_RETRY_MS)).toBe(true);
  });

  it('keeps the memory in storage', () => {
    markHostBlocked('cal.example.com');
    resetHostMemory();
    expect(canTryDirect(FEED)).toBe(false);
  });

  it('survives unreadable storage', () => {
    localStorage.setItem('calendar-timeline:feed-hosts', '{oops');
    resetHostMemory();
    expect(canTryDirect(FEED)).toBe(true);
  });
});

describe('readFeedText', () => {
  it('reads a body', async () => {
    const response = new Response('BEGIN:VCALENDAR\r\nκαλ');
    expect(await readFeedText({ response, via: 'direct' })).toBe('BEGIN:VCALENDAR\r\nκαλ');
  });

  it('caps a direct body; the proxy has capped its own', async () => {
    const big = new Uint8Array(MAX_FEED_BYTES + 1);
    await expect(readFeedText({ response: new Response(big), via: 'direct' })).rejects.toThrow('5MB');
    expect((await readFeedText({ response: new Response(big), via: 'proxy' })).length).toBe(MAX_FEED_BYTES + 1);
  });
});
