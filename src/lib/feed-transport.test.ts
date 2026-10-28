// @vitest-environment happy-dom
import {
  BLOCKED_RETRY_MS,
  DIRECT_TIMEOUT_MS,
  MAX_FEED_BYTES,
  canTryDirect,
  fetchFeed,
  markHostBlocked,
  readFeedText,
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
});

describe('fetchFeed', () => {
  it('reads a feed straight from a host that allows it', async () => {
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    const { via, response } = await fetchFeed(user, { direct: true, conditional: { 'If-None-Match': '"x"' } });
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
    const first = await fetchFeed(user, { direct: true, conditional: { 'If-None-Match': '"x"' } });
    expect(first.via).toBe('proxy');
    expect(calls.map((c) => c.url)).toEqual([FEED, '/api/ics']);
    const headers = calls[1]!.init.headers as Record<string, string>;
    expect(decodeURIComponent(headers['X-Feed-Url']!)).toBe(FEED);
    expect(headers['If-None-Match']).toBe('"x"');

    // The next refresh doesn't knock on the host again.
    await fetchFeed(user, { direct: true });
    expect(calls.map((c) => c.url)).toEqual([FEED, '/api/ics', '/api/ics']);
  });

  it('tries the proxy after a host error without marking the host', async () => {
    const calls = stubFetch((url) =>
      url === FEED ? new Response('nope', { status: 403 }) : new Response('BEGIN:VCALENDAR'),
    );
    expect((await fetchFeed(user, { direct: true })).via).toBe('proxy');
    expect(canTryDirect(FEED)).toBe(true);
    expect(calls).toHaveLength(2);
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
    const pending = fetchFeed(user, { direct: true });
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
    const pending = fetchFeed(user, { direct: true, signal: outer.signal });
    outer.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
    expect(calls).toHaveLength(1);
    expect(canTryDirect(FEED)).toBe(true);
  });

  it('uses only the proxy when direct is off', async () => {
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    expect((await fetchFeed(user, { direct: false })).via).toBe('proxy');
    expect(calls.map((c) => c.url)).toEqual(['/api/ics']);
  });

  it('sends secret feeds by id, through the proxy', async () => {
    const calls = stubFetch(() => new Response('BEGIN:VCALENDAR'));
    await fetchFeed({ kind: 'secret', id: 'work' }, { direct: true });
    expect(calls.map((c) => c.url)).toEqual(['/api/ics?id=work']);
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
    markHostBlocked('cal.example.com', now);
    expect(canTryDirect(FEED, now + BLOCKED_RETRY_MS - 1)).toBe(false);
    expect(canTryDirect(FEED, now + BLOCKED_RETRY_MS)).toBe(true);
  });

  it('survives unreadable storage', () => {
    localStorage.setItem('calendar-timeline:feed-hosts', '{oops');
    expect(canTryDirect(FEED)).toBe(true);
  });
});

describe('readFeedText', () => {
  it('reads a body', async () => {
    expect(await readFeedText(new Response('BEGIN:VCALENDAR\r\nκαλ'))).toBe('BEGIN:VCALENDAR\r\nκαλ');
  });

  it('refuses a body over the cap', async () => {
    const big = new Uint8Array(MAX_FEED_BYTES + 1);
    await expect(readFeedText(new Response(big))).rejects.toThrow('5MB');
  });
});
