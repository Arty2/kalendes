import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  encodeShareState,
  decodeShareState,
  buildShareUrl,
  SHARE_URL_LIMIT,
  tryNativeShare,
} from './share';
import { defaultConfig } from './storage';
import type { AppConfig, CalendarFeed, FindReplaceRule, ParsedEvent } from './types';

function scratchEvent(over: Partial<ParsedEvent>): ParsedEvent {
  return {
    uid: 'scratch:1',
    feedId: 'scratchpad:trip',
    title: 'Event',
    description: '',
    descriptionSnippet: '',
    location: '',
    start: new Date('2026-03-10T09:00:00Z'),
    end: new Date('2026-03-10T10:00:00Z'),
    allDay: false,
    ...over,
  };
}

function localLane(feed: Partial<CalendarFeed>, events: ParsedEvent[]): { feed: CalendarFeed; events: ParsedEvent[] } {
  return {
    feed: {
      id: 'scratchpad:trip',
      source: { kind: 'scratchpad', id: 'trip' },
      name: 'My Trips',
      collapsed: false,
      order: 3,
      kind: 'events',
      category: 'none',
      ...feed,
    },
    events,
  };
}

function configWith(over: Partial<AppConfig>): AppConfig {
  return { ...defaultConfig(), ...over };
}

// A payload in the pre-compression format: plain base64url JSON. Kept as a
// sizing reference and to assert these links are now rejected.
function legacyPayload(obj: unknown): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// A hand-built payload in the current compressed format, for feeding decode
// content that encodeShareState would never produce.
async function compressedPayload(obj: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  }).pipeThrough(new CompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  return '2.' + Buffer.from(out).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('share encode/decode', () => {
  it('round-trips user feeds + rules', async () => {
    const cfg = configWith({
      feeds: [
        { id: 'a', source: { kind: 'user', url: 'https://example.com/cal.ics' }, name: 'Work', collapsed: false, order: 0, kind: 'events', category: 'none' },
        { id: 'b', source: { kind: 'user', url: 'https://example.com/h.ics' }, name: 'Holidays', collapsed: false, order: 1, kind: 'holidays', category: 'holidays' },
      ],
      rules: [
        { id: 'r1', find: 'foo', replace: 'bar', style: 'bold', category: 'none' },
        { id: 'r2', find: 'baz', replace: '', style: 'hidden', category: 'none' },
      ],
    });
    const payload = await encodeShareState(cfg);
    const decoded = await decodeShareState(payload);
    expect(decoded).not.toBeNull();
    expect(decoded!.feeds.length).toBe(2);
    expect((decoded!.feeds[0]!.source as { kind: 'user'; url: string }).url).toBe('https://example.com/cal.ics');
    expect(decoded!.feeds[0]!.name).toBe('Work');
    expect(decoded!.feeds[1]!.kind).toBe('holidays');
    expect(decoded!.rules.length).toBe(2);
    expect(decoded!.rules[0]!.style).toBe('bold');
  });

  it('round-trips view state when zoom is provided', async () => {
    const cfg = configWith({
      locale: 'el',
      dateFormat: 'DD.MM.YYYY',
      scheme: 'dark',
      palette: 'juniper',
    });
    const payload = await encodeShareState(cfg, '2-year');
    const decoded = await decodeShareState(payload);
    expect(decoded!.view).not.toBeNull();
    expect(decoded!.view!.zoom).toBe('2-year');
    expect(decoded!.view!.locale).toBe('el');
    expect(decoded!.view!.dateFormat).toBe('DD.MM.YYYY');
    expect(decoded!.view!.scheme).toBe('dark');
    expect(decoded!.view!.palette).toBe('juniper');
  });

  it('returns view from config even without zoom', async () => {
    const cfg = configWith({ locale: 'en', dateFormat: 'YYYY-MM-DD', scheme: 'light' });
    const payload = await encodeShareState(cfg);
    const decoded = await decodeShareState(payload);
    expect(decoded!.view).not.toBeNull();
    expect(decoded!.view!.zoom).toBeUndefined();
    expect(decoded!.view!.locale).toBe('en');
  });

  it('ignores invalid view fields', async () => {
    const corrupt = await compressedPayload({ f: [], r: [], v: { z: 'bogus', l: 'xx', d: 'BAD', t: 'green' } });
    const decoded = await decodeShareState(corrupt);
    expect(decoded!.view).toBeNull();
  });

  it('skips secret feeds (only user feeds shareable)', async () => {
    const cfg = configWith({
      feeds: [
        { id: 's', source: { kind: 'secret', id: 'xx' }, name: 'Secret', collapsed: false, order: 0, kind: 'events', category: 'none' },
        { id: 'u', source: { kind: 'user', url: 'https://x.com/a.ics' }, name: 'Mine', collapsed: false, order: 1, kind: 'events', category: 'none' },
      ],
    });
    const payload = await encodeShareState(cfg);
    const decoded = await decodeShareState(payload);
    expect(decoded!.feeds.length).toBe(1);
    expect(decoded!.feeds[0]!.name).toBe('Mine');
  });

  it('produces a URL-safe payload with no +, /, or = characters', async () => {
    const cfg = configWith({});
    const payload = await encodeShareState(cfg);
    expect(payload).not.toMatch(/[+/=]/);
  });

  it('default config share URL stays well under the limit', async () => {
    const url = await buildShareUrl(defaultConfig(), 'month', 'https://heracl.es/calendari');
    expect(url.length).toBeLessThan(SHARE_URL_LIMIT);
  });

  it('returns null for malformed payload', async () => {
    expect(await decodeShareState('!!!not-base64!!!')).toBeNull();
    expect(await decodeShareState('')).toBeNull();
    // Compressed marker with garbage bytes after it.
    expect(await decodeShareState('2.!!!not-base64!!!')).toBeNull();
    expect(await decodeShareState('2.AAAA')).toBeNull();
  });

  it('returns empty arrays for an empty (but valid) payload', async () => {
    const empty = await encodeShareState(configWith({ feeds: [], rules: [] as FindReplaceRule[] }));
    const decoded = await decodeShareState(empty);
    expect(decoded!.feeds).toEqual([]);
    expect(decoded!.rules).toEqual([]);
  });

  it('round-trips a per-feed timezone override', async () => {
    const cfg = configWith({
      feeds: [
        {
          id: 'a',
          source: { kind: 'user', url: 'https://example.com/cal.ics' },
          name: 'Work',
          collapsed: false,
          order: 0,
          kind: 'events',
          category: 'none',
          timezone: 'America/Los_Angeles',
        },
      ],
    });
    const decoded = await decodeShareState(await encodeShareState(cfg));
    expect(decoded!.feeds[0]!.timezone).toBe('America/Los_Angeles');
  });

  it('rejects legacy uncompressed share links', async () => {
    const decoded = await decodeShareState(
      legacyPayload({
        f: [{ u: 'https://example.com/cal.ics', n: 'Work', h: 0 }],
        r: [],
      }),
    );
    expect(decoded).toBeNull();
  });

  it('compresses many-feed configs well under the uncompressed size', async () => {
    const feeds = Array.from({ length: 12 }, (_, i) => ({
      id: `f${i}`,
      source: {
        kind: 'user' as const,
        url: `https://calendar.google.com/calendar/ical/team${i}%40group.calendar.google.com/public/basic.ics`,
      },
      name: `Team calendar ${i}`,
      collapsed: false,
      order: i,
      kind: 'events' as const,
      category: 'none' as const,
    }));
    const cfg = configWith({ feeds });
    const payload = await encodeShareState(cfg);
    const uncompressed = legacyPayload; // sizing reference below
    const legacySize = uncompressed({
      f: feeds.map((f) => ({ u: f.source.url, n: f.name, h: 0 })),
      r: [],
    }).length;
    expect(payload.startsWith('2.')).toBe(true);
    // The compressed payload should undercut the legacy encoding by a wide
    // margin — this dozen-feed setup did not fit in SHARE_URL_LIMIT before.
    expect(payload.length).toBeLessThan(legacySize / 2);
    expect(payload.length).toBeLessThan(SHARE_URL_LIMIT);
    const decoded = await decodeShareState(payload);
    expect(decoded!.feeds).toHaveLength(12);
  });
});

describe('share local (scratchpad) feeds', () => {
  it('round-trips a renamed local lane with its events and metadata', async () => {
    const lane = localLane(
      { name: 'Summer Trips', category: 'events', travel: 'international', timezone: 'America/New_York' },
      [
        scratchEvent({ title: 'Flight', location: 'JFK', description: 'Gate B12', url: 'https://air/1' }),
        scratchEvent({ uid: 's2', title: 'Hotel', allDay: true, start: new Date('2026-03-11T00:00:00Z'), end: new Date('2026-03-12T00:00:00Z') }),
      ],
    );
    const decoded = await decodeShareState(await encodeShareState(defaultConfig(), undefined, [lane]));
    expect(decoded!.localFeeds).toHaveLength(1);
    const lf = decoded!.localFeeds[0]!;
    expect(lf.name).toBe('Summer Trips');
    expect(lf.category).toBe('events');
    expect(lf.travel).toBe('international');
    expect(lf.timezone).toBe('America/New_York');
    expect(lf.events).toHaveLength(2);
    expect(lf.events[0]!.title).toBe('Flight');
    expect(lf.events[0]!.location).toBe('JFK');
    expect(lf.events[0]!.description).toBe('Gate B12');
    expect(lf.events[0]!.url).toBe('https://air/1');
    // A fresh uid is generated on decode, not the sender's.
    expect(lf.events[0]!.uid).not.toBe('scratch:1');
  });

  it('preserves event instants exactly (no TZ/day shift) for all-day and timed events', async () => {
    const timed = scratchEvent({ start: new Date('2026-03-10T09:00:00Z'), end: new Date('2026-03-10T10:30:00Z') });
    const allDay = scratchEvent({ uid: 's2', allDay: true, start: new Date('2026-03-11T00:00:00Z'), end: new Date('2026-03-12T00:00:00Z') });
    const lane = localLane({}, [timed, allDay]);
    const decoded = await decodeShareState(await encodeShareState(defaultConfig(), undefined, [lane]));
    const [dt, da] = decoded!.localFeeds[0]!.events;
    expect(dt!.start.getTime()).toBe(timed.start.getTime());
    expect(dt!.end.getTime()).toBe(timed.end.getTime());
    expect(dt!.allDay).toBe(false);
    expect(da!.start.getTime()).toBe(allDay.start.getTime());
    expect(da!.allDay).toBe(true);
  });

  it('omits local lanes with no events', async () => {
    const lane = localLane({ name: 'Empty' }, []);
    const decoded = await decodeShareState(await encodeShareState(defaultConfig(), undefined, [lane]));
    expect(decoded!.localFeeds).toHaveLength(0);
  });

  it('decodes older links (no lf field) with an empty localFeeds array', async () => {
    const decoded = await decodeShareState(await encodeShareState(defaultConfig()));
    expect(decoded!.localFeeds).toEqual([]);
  });

  it('encodes local lanes from localStorage when no lanes are passed', async () => {
    localStorage.setItem(
      'calendar-timeline:scratchpad:trip',
      JSON.stringify([
        { uid: 's1', title: 'Ferry', description: '', descriptionSnippet: '', location: '', start: '2026-04-01T08:00:00.000Z', end: '2026-04-01T09:00:00.000Z', allDay: false },
      ]),
    );
    const cfg = configWith({
      feeds: [localLane({}, []).feed],
    });
    const decoded = await decodeShareState(await encodeShareState(cfg));
    localStorage.removeItem('calendar-timeline:scratchpad:trip');
    expect(decoded!.localFeeds).toHaveLength(1);
    expect(decoded!.localFeeds[0]!.events[0]!.title).toBe('Ferry');
  });

  it('marks the built-in Draft as isDraft and round-trips its enabled state', async () => {
    const draft = localLane({ id: 'scratchpad:default', name: 'Draft' }, [scratchEvent({ title: 'Note' })]);
    const decoded = await decodeShareState(await encodeShareState(defaultConfig(), undefined, [draft]));
    expect(decoded!.localFeeds).toHaveLength(1);
    expect(decoded!.localFeeds[0]!.isDraft).toBe(true);
    expect(decoded!.localFeeds[0]!.hidden).toBeUndefined(); // enabled
  });

  it('round-trips a hidden Draft', async () => {
    const draft = localLane({ id: 'scratchpad:default', name: 'Draft', hidden: true }, [scratchEvent({ title: 'Note' })]);
    const decoded = await decodeShareState(await encodeShareState(defaultConfig(), undefined, [draft]));
    expect(decoded!.localFeeds[0]!.isDraft).toBe(true);
    expect(decoded!.localFeeds[0]!.hidden).toBe(true);
  });

  it('keeps an empty enabled Draft (so its enabled state travels) but drops an empty non-Draft lane', async () => {
    const emptyEnabledDraft = localLane({ id: 'scratchpad:default', name: 'Draft' }, []);
    const emptyImported = localLane({ id: 'scratchpad:trip', name: 'Trip' }, []);
    const decoded = await decodeShareState(
      await encodeShareState(defaultConfig(), undefined, [emptyEnabledDraft, emptyImported]),
    );
    expect(decoded!.localFeeds).toHaveLength(1);
    expect(decoded!.localFeeds[0]!.isDraft).toBe(true);
    expect(decoded!.localFeeds[0]!.events).toHaveLength(0);
  });

  it('drops an empty hidden Draft (nothing to carry)', async () => {
    const emptyHiddenDraft = localLane({ id: 'scratchpad:default', name: 'Draft', hidden: true }, []);
    const decoded = await decodeShareState(await encodeShareState(defaultConfig(), undefined, [emptyHiddenDraft]));
    expect(decoded!.localFeeds).toHaveLength(0);
  });

  it('non-Draft lanes decode with isDraft undefined', async () => {
    const lane = localLane({}, [scratchEvent({ title: 'X' })]);
    const decoded = await decodeShareState(await encodeShareState(defaultConfig(), undefined, [lane]));
    expect(decoded!.localFeeds[0]!.isDraft).toBeUndefined();
  });
});

describe('tryNativeShare', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'share');

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'share', original);
    else delete (navigator as { share?: unknown }).share;
  });

  function stubShare(impl: () => Promise<void>): void {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      writable: true,
      value: vi.fn(impl),
    });
  }

  it("reports 'shared' when the sheet completes", async () => {
    stubShare(() => Promise.resolve());
    expect(await tryNativeShare('https://x')).toBe('shared');
  });

  it("reports 'dismissed' when the user cancels (AbortError) so callers skip the clipboard", async () => {
    stubShare(() => Promise.reject(Object.assign(new Error('cancel'), { name: 'AbortError' })));
    expect(await tryNativeShare('https://x')).toBe('dismissed');
  });

  it("reports 'stuck' on InvalidStateError", async () => {
    stubShare(() =>
      Promise.reject(Object.assign(new Error('in progress'), { name: 'InvalidStateError' })),
    );
    expect(await tryNativeShare('https://x')).toBe('stuck');
  });

  it("reports 'fallback' for other rejections", async () => {
    stubShare(() => Promise.reject(Object.assign(new Error('nope'), { name: 'NotAllowedError' })));
    expect(await tryNativeShare('https://x')).toBe('fallback');
  });
});
