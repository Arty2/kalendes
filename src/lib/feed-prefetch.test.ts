import { dropPrefetch, noteFeedRange, prefetchFeed, takePrefetched, PREFETCH_KEEP_MS } from './feed-prefetch';
import { fetchFeedBody, parseFeedText } from './ics';

vi.mock('./ics', async (orig) => ({
  ...(await orig<typeof import('./ics')>()),
  fetchFeedBody: vi.fn(),
  parseFeedText: vi.fn(async () => ({ events: [], timezone: null })),
}));

const body = vi.mocked(fetchFeedBody);
const parse = vi.mocked(parseFeedText);
const URL_A = 'https://a.test/a.ics';
const ics = (name: string) => `BEGIN:VCALENDAR\r\nX-WR-CALNAME:${name}\r\nEND:VCALENDAR\r\n`;

beforeEach(() => {
  dropPrefetch();
  body.mockReset();
  parse.mockClear();
  noteFeedRange({ start: new Date('2026-01-01'), end: new Date('2026-12-31') });
});

describe('prefetchFeed', () => {
  it("gives the feed's own name, parses it once, and reuses the request", async () => {
    body.mockResolvedValue({ text: ics('Talks'), etag: null, lastModified: null });
    expect(await prefetchFeed(URL_A, 'auto')).toBe('Talks');
    expect(await prefetchFeed(URL_A, 'auto')).toBe('Talks');
    expect(body).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('is null when the fetch fails or the feed has no name', async () => {
    body.mockRejectedValueOnce(new Error('404'));
    expect(await prefetchFeed(URL_A, 'auto')).toBeNull();
    body.mockResolvedValueOnce({ text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR', etag: null, lastModified: null });
    expect(await prefetchFeed('https://b.test/b.ics', 'auto')).toBeNull();
  });
});

describe('takePrefetched', () => {
  it('hands the feed over once, only for the same URL and mode', async () => {
    body.mockResolvedValue({ text: ics('Talks'), etag: null, lastModified: null });
    await prefetchFeed(URL_A, 'auto');
    expect(takePrefetched({ kind: 'user', url: URL_A }, 'proxy')).toBeNull();
    expect(takePrefetched({ kind: 'user', url: 'https://other.test/x.ics' }, 'auto')).toBeNull();
    const taken = takePrefetched({ kind: 'user', url: URL_A }, 'auto');
    expect(taken).not.toBeNull();
    expect((await taken!.body).text).toContain('Talks');
    expect(takePrefetched({ kind: 'user', url: URL_A }, 'auto')).toBeNull();
  });

  it('drops a prefetch left waiting too long, and one cancelled', async () => {
    body.mockResolvedValue({ text: ics('Talks'), etag: null, lastModified: null });
    vi.useFakeTimers();
    try {
      void prefetchFeed(URL_A, 'auto');
      vi.advanceTimersByTime(PREFETCH_KEEP_MS + 1);
      expect(takePrefetched({ kind: 'user', url: URL_A }, 'auto')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    void prefetchFeed(URL_A, 'auto');
    dropPrefetch();
    expect(takePrefetched({ kind: 'user', url: URL_A }, 'auto')).toBeNull();
  });
});
