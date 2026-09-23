// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { config, events, ui } from './state.svelte';
import { loadAllFeeds, lastFeedRefreshMs } from './feed-loader.svelte';
import { fetchAndParseFeed } from './ics';
import type { CalendarFeed, ParsedEvent } from './types';

vi.mock('./ics', () => ({ fetchAndParseFeed: vi.fn() }));
vi.mock('./storage', async (orig) => ({
  ...(await orig<typeof import('./storage')>()),
  saveEventsCache: vi.fn(),
}));

const fetchMock = vi.mocked(fetchAndParseFeed);
const RANGE = { start: new Date('2026-01-01'), end: new Date('2026-12-31') };

function feed(id: string, url: string): CalendarFeed {
  return {
    id, name: id, source: { kind: 'user', url }, collapsed: false, order: 0,
    kind: 'events', category: 'events',
  };
}

function parsed(feedId: string, title: string) {
  const ev: ParsedEvent = {
    uid: feedId + '-1', feedId, title, description: '', descriptionSnippet: '', location: '',
    start: new Date('2026-03-01T10:00:00Z'), end: new Date('2026-03-01T11:00:00Z'), allDay: false,
  };
  return {
    kind: 'parsed' as const,
    result: { events: [ev], timezone: 'Europe/Athens' },
    text: 'BEGIN:VCALENDAR',
    validators: null,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  fetchMock.mockReset();
  config.feeds = [feed('a', 'https://a.test/a.ics'), feed('b', 'https://b.test/b.ics')];
  for (const id of ['a', 'b']) {
    delete events.byFeed[id];
    delete events.lastSuccessAt[id];
    delete ui.feedErrors[id];
  }
});

describe('loadAllFeeds', () => {
  it('lands each feed as it resolves and tracks which are in flight', async () => {
    const slow = deferred<ReturnType<typeof parsed>>();
    fetchMock.mockImplementation(async (source) =>
      source.kind === 'user' && source.url.includes('a.test') ? parsed('a', 'Fast') : slow.promise,
    );
    const done = loadAllFeeds(RANGE);
    expect(ui.loading).toBe(true);
    expect(ui.loadingFeeds).toEqual({ a: true, b: true });

    await vi.waitFor(() => expect(events.byFeed.a?.[0]?.title).toBe('Fast'));
    expect(ui.loadingFeeds).toEqual({ b: true });
    expect(events.byFeed.b).toBeUndefined();

    slow.resolve(parsed('b', 'Slow'));
    await done;
    expect(events.byFeed.b?.[0]?.title).toBe('Slow');
    expect(ui.loadingFeeds).toEqual({});
    expect(ui.loading).toBe(false);
    expect(lastFeedRefreshMs()).toBeGreaterThan(0);
  });

  it('joins an in-flight refresh and runs one follow-up pass, not parallel ones', async () => {
    const first = deferred<ReturnType<typeof parsed>>();
    fetchMock.mockImplementationOnce(() => first.promise);
    fetchMock.mockImplementation(async (source) =>
      parsed(source.kind === 'user' && source.url.includes('a.test') ? 'a' : 'b', 'x'),
    );
    const p1 = loadAllFeeds(RANGE);
    const p2 = loadAllFeeds(RANGE);
    const p3 = loadAllFeeds(RANGE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    first.resolve(parsed('a', 'x'));
    await Promise.all([p1, p2, p3]);
    // One pass of two feeds, then a single queued pass of two more.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps cached events on failure and records the error', async () => {
    events.byFeed.a = parsed('a', 'Cached').result.events;
    fetchMock.mockRejectedValue(new Error('upstream error'));
    await loadAllFeeds(RANGE);
    expect(events.byFeed.a?.[0]?.title).toBe('Cached');
    expect(ui.feedErrors.a).toBe('upstream error');
    expect(events.byFeed.b).toEqual([]);
  });

  it('re-runs its tracking effect when a feed URL changes, even mid-refresh', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    let runs = 0;
    const cleanup = $effect.root(() => {
      $effect(() => {
        runs++;
        void loadAllFeeds(RANGE);
      });
    });
    flushSync();
    expect(runs).toBe(1);
    // A second run joins the stalled refresh; it must still track the sources.
    config.feeds[1]!.source = { kind: 'user', url: 'https://b.test/other.ics' };
    flushSync();
    expect(runs).toBe(2);
    config.feeds[1]!.source = { kind: 'user', url: 'https://b.test/third.ics' };
    flushSync();
    expect(runs).toBe(3);
    cleanup();
  });
});
