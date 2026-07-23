import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  exportConfig,
  importConfig,
  defaultConfig,
  loadConfig,
  GREEK_HOLIDAYS_URL,
  USA_HOLIDAYS_URL,
  REFRESH_INTERVAL_OPTIONS,
  snapRefreshInterval,
  saveEventsCache,
  flushEventsCache,
  loadEventsCache,
  EVENTS_CACHE_KEY,
  loadSettingsSections,
  saveSettingsSections,
  SETTINGS_SECTIONS_KEY,
  isDefaultOnlyFeeds,
} from './storage';
import { SCHEMA_VERSION, SCRATCHPAD_FEED_ID } from './types';
import type { ParsedEvent } from './types';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('config import/export', () => {
  it('round-trips the default config', () => {
    const original = defaultConfig();
    const json = exportConfig(original);
    const restored = importConfig(json);
    expect(restored.feeds.length).toBe(original.feeds.length);
    expect(restored.refreshIntervalMs).toBe(original.refreshIntervalMs);
    expect(restored.scheme).toBe(original.scheme);
    expect(restored.palette).toBe(original.palette);
    expect(restored.locale).toBe(original.locale);
    expect(restored.timezone).toBe(original.timezone);
    expect(restored.timeFormat).toBe(original.timeFormat);
  });

  it('throws on malformed JSON', () => {
    expect(() => importConfig('not json')).toThrow();
  });

  it('defaults haptics to auto and round-trips a valid value', () => {
    expect(defaultConfig().haptics).toBe('auto');
    const cfg = { ...defaultConfig(), haptics: 'sound' as const };
    expect(importConfig(exportConfig(cfg)).haptics).toBe('sound');
  });

  it('falls back to auto for an invalid haptics value', () => {
    const bad = JSON.stringify({ ...defaultConfig(), haptics: 'bogus' });
    expect(importConfig(bad).haptics).toBe('auto');
  });

  it('defaults the palette to pepper and round-trips a valid value', () => {
    expect(defaultConfig().palette).toBe('pepper');
    const cfg = { ...defaultConfig(), palette: 'juniper' as const };
    expect(importConfig(exportConfig(cfg)).palette).toBe('juniper');
  });

  it('falls back to pepper for an invalid palette value', () => {
    const bad = JSON.stringify({ ...defaultConfig(), palette: 'bogus' });
    expect(importConfig(bad).palette).toBe('pepper');
  });

  it('migrates a legacy `theme` field to `scheme` and defaults palette to pepper', () => {
    const legacy = { ...defaultConfig() } as Record<string, unknown>;
    delete legacy.scheme;
    delete legacy.palette;
    legacy.theme = 'dark';
    const restored = importConfig(JSON.stringify(legacy));
    expect(restored.scheme).toBe('dark');
    expect(restored.palette).toBe('pepper');
  });

  it('defaults the tray filter to all six categories', () => {
    expect(defaultConfig().trayFilter.categories).toEqual(
      expect.arrayContaining(['none', 'events', 'holidays', 'observances', 'announcements', 'guests']),
    );
    expect(defaultConfig().trayFilter.categories).toHaveLength(6);
  });

  it('backfills observances and guests into an older saved tray filter', () => {
    // A config saved before those categories were filterable — a guests/
    // observances event would otherwise silently vanish from the tray.
    const cfg = {
      ...defaultConfig(),
      trayFilter: { categories: ['none', 'events', 'holidays', 'announcements'], travel: ['none', 'local', 'international'] },
    };
    const restored = importConfig(JSON.stringify(cfg));
    expect(restored.trayFilter.categories).toContain('observances');
    expect(restored.trayFilter.categories).toContain('guests');
  });

  it('defaults spacing to auto and round-trips a valid value', () => {
    expect(defaultConfig().spacing).toBe('auto');
    const cfg = { ...defaultConfig(), spacing: 'relaxed' as const };
    expect(importConfig(exportConfig(cfg)).spacing).toBe('relaxed');
  });

  it('falls back to auto for an invalid spacing value', () => {
    const bad = JSON.stringify({ ...defaultConfig(), spacing: 'bogus' });
    expect(importConfig(bad).spacing).toBe('auto');
  });

  it('defaults traySide to auto and round-trips a valid value', () => {
    expect(defaultConfig().traySide).toBe('auto');
    const cfg = { ...defaultConfig(), traySide: 'left' as const };
    expect(importConfig(exportConfig(cfg)).traySide).toBe('left');
  });

  it('defaults traySide to auto for a config saved before the field existed', () => {
    const legacy: Record<string, unknown> = { ...defaultConfig() };
    delete legacy.traySide;
    expect(importConfig(JSON.stringify(legacy)).traySide).toBe('auto');
  });

  it('falls back to auto for an invalid traySide value', () => {
    const bad = JSON.stringify({ ...defaultConfig(), traySide: 'bogus' });
    expect(importConfig(bad).traySide).toBe('auto');
  });

  it('migrates a legacy baptism value to haptics', () => {
    const legacy = JSON.stringify({ ...defaultConfig(), haptics: undefined, baptism: 'vibration' });
    expect(importConfig(legacy).haptics).toBe('vibration');
  });

  it('throws on wrong schema version', () => {
    const bad = JSON.stringify({ schemaVersion: 999, feeds: [] });
    expect(() => importConfig(bad)).toThrow(/schema/i);
  });

  it('never derives a Block from the holidays/observances type', () => {
    const feed = (id: string, category: string) => ({
      id,
      name: id,
      source: { kind: 'user', url: 'https://example.com/' + id + '.ics' },
      collapsed: false,
      order: 0,
      kind: 'events',
      category,
    });
    const cfg = JSON.stringify({
      ...defaultConfig(),
      feeds: [feed('user:hol', 'holidays'), feed('user:obs', 'observances'), feed('user:ev', 'events')],
    });
    const out = importConfig(cfg);
    // Type never implies a block — it must be set explicitly.
    expect(out.feeds.find((f) => f.id === 'user:hol')!.block).toBeUndefined();
    expect(out.feeds.find((f) => f.id === 'user:obs')!.block).toBeUndefined();
    expect(out.feeds.find((f) => f.id === 'user:ev')!.block).toBeUndefined();
    // The type itself is preserved (icon/label).
    expect(out.feeds.find((f) => f.id === 'user:hol')!.category).toBe('holidays');
  });

  it('keeps an explicit feed Block and drops an explicit none', () => {
    const mk = (id: string, block: string) => ({
      id,
      name: id,
      source: { kind: 'user', url: 'https://example.com/' + id + '.ics' },
      collapsed: false,
      order: 0,
      kind: 'events',
      category: 'holidays',
      block,
    });
    const cfg = JSON.stringify({
      ...defaultConfig(),
      feeds: [mk('user:g', 'global'), mk('user:n', 'none')],
    });
    const out = importConfig(cfg);
    expect(out.feeds.find((f) => f.id === 'user:g')!.block).toBe('global');
    expect(out.feeds.find((f) => f.id === 'user:n')!.block).toBeUndefined();
  });

  it('defaults the secondary timezone and drops the legacy week fields', () => {
    const cfg = defaultConfig();
    expect(cfg.timezone2).toBe('America/New_York');
    expect('weekTzTop' in cfg).toBe(false);
    expect('weekTzBottom' in cfg).toBe(false);
  });

  it('defaults the secondary timezone when a saved config predates it', () => {
    const legacy = { ...defaultConfig() } as Record<string, unknown>;
    delete legacy.timezone2;
    localStorage.setItem('calendar-timeline:config', JSON.stringify(legacy));
    expect(loadConfig().timezone2).toBe('America/New_York');
  });

  it('round-trips the secondary timezone through export/import', () => {
    const cfg = { ...defaultConfig(), timezone2: 'Asia/Tokyo' };
    expect(importConfig(exportConfig(cfg)).timezone2).toBe('Asia/Tokyo');
  });

  it('defaults the #1 reference timezone to Athens when a saved config predates it', () => {
    expect(defaultConfig().timezone1).toBe('Europe/Athens');
    const legacy = { ...defaultConfig() } as Record<string, unknown>;
    delete legacy.timezone1;
    localStorage.setItem('calendar-timeline:config', JSON.stringify(legacy));
    expect(loadConfig().timezone1).toBe('Europe/Athens');
  });

  it('round-trips the #1 reference timezone through export/import', () => {
    const cfg = { ...defaultConfig(), timezone1: 'Asia/Tokyo' };
    expect(importConfig(exportConfig(cfg)).timezone1).toBe('Asia/Tokyo');
  });

  it('keeps user edits to a seeded default rule across a reload', () => {
    const cfg = defaultConfig();
    const tbd = cfg.rules.find((r) => r.id === 'default-tbd')!;
    tbd.color = 'amber';
    tbd.style = 'inverted';
    tbd.disabled = true;
    const restored = importConfig(exportConfig(cfg));
    const restoredTbd = restored.rules.find((r) => r.id === 'default-tbd')!;
    expect(restoredTbd.color).toBe('amber');
    expect(restoredTbd.style).toBe('inverted');
    expect(restoredTbd.disabled).toBe(true);
  });

  it('appends only the default rules a saved config predates', () => {
    const cfg = defaultConfig();
    cfg.rules = cfg.rules.filter((r) => r.id !== 'default-canceled');
    cfg.rules.push({ id: 'mine', find: 'foo', replace: 'bar', style: 'bold', category: 'none' });
    const restored = importConfig(exportConfig(cfg));
    // The missing default reappears pristine, after the stored rules.
    const ids = restored.rules.map((r) => r.id);
    expect(ids.indexOf('mine')).toBeLessThan(ids.indexOf('default-canceled'));
    expect(restored.rules.find((r) => r.id === 'default-canceled')!.style).toBe('striked');
    // The user's own rule is untouched.
    expect(restored.rules.find((r) => r.id === 'mine')!.style).toBe('bold');
  });

  it('default Observance filter carries a local Block', () => {
    const obs = defaultConfig().rules.find((r) => r.id === 'default-observance');
    expect(obs?.block).toBe('local');
    expect(obs?.style).toBe('dashed');
    expect(obs?.category).toBe('observances');
  });

  it('seeds Greek + USA holiday feeds by default', () => {
    const cfg = defaultConfig();
    // Greek + USA + Scratchpad
    expect(cfg.feeds.length).toBe(3);
    const greek = cfg.feeds.find((f) => f.id === 'user:greek-bank-holidays');
    const usa = cfg.feeds.find((f) => f.id === 'user:usa-bank-holidays');
    expect(greek).toBeDefined();
    expect(usa).toBeDefined();
    // Exactly one of the two is the primary "holidays" category, the
    // other is the discreet "observances" — chosen by local timezone.
    const categories = [greek!.category, usa!.category].sort();
    expect(categories).toEqual(['holidays', 'observances']);
    // The seeded feeds carry a Block matching their type so a fresh install
    // renders the same hatch the legacy type-driven code did.
    const holidayFeed = greek!.category === 'holidays' ? greek! : usa!;
    const observanceFeed = greek!.category === 'observances' ? greek! : usa!;
    expect(holidayFeed.block).toBe('global');
    expect(observanceFeed.block).toBe('local');
  });

  it('default USA feed points at the Google ICS URL', () => {
    expect(USA_HOLIDAYS_URL).not.toMatch(/apple\.com/);
    const cfg = defaultConfig();
    const usa = cfg.feeds.find((f) => f.id === 'user:usa-bank-holidays');
    expect(usa?.source.kind === 'user' && usa.source.url).toBe(USA_HOLIDAYS_URL);
  });

  it('default Greek feed points at Google ICS, not officeholidays', () => {
    expect(GREEK_HOLIDAYS_URL).toMatch(/calendar\.google\.com/);
    expect(GREEK_HOLIDAYS_URL).not.toMatch(/officeholidays/);
    const cfg = defaultConfig();
    const greek = cfg.feeds.find((f) => f.id === 'user:greek-bank-holidays');
    expect(greek?.source.kind === 'user' && greek.source.url).toBe(GREEK_HOLIDAYS_URL);
  });

  it('default refresh interval is 1 hour', () => {
    expect(defaultConfig().refreshIntervalMs).toBe(60 * 60_000);
    expect(REFRESH_INTERVAL_OPTIONS).toEqual([30 * 60_000, 60 * 60_000, 240 * 60_000]);
  });

  it('snaps non-canonical refresh intervals to the nearest allowed value', () => {
    expect(snapRefreshInterval(1 * 60_000)).toBe(30 * 60_000);
    expect(snapRefreshInterval(45 * 60_000)).toBe(30 * 60_000);
    expect(snapRefreshInterval(50 * 60_000)).toBe(60 * 60_000);
    expect(snapRefreshInterval(95 * 60_000)).toBe(60 * 60_000);
    expect(snapRefreshInterval(200 * 60_000)).toBe(240 * 60_000);
  });

  it('round-trips a per-feed timezone override through export/import', () => {
    const cfg = defaultConfig();
    cfg.feeds[0]!.timezone = 'America/Los_Angeles';
    const restored = importConfig(exportConfig(cfg));
    expect(restored.feeds[0]!.timezone).toBe('America/Los_Angeles');
  });

  it('seeds a scratchpad feed pinned to the end by default', () => {
    const cfg = defaultConfig();
    const scratch = cfg.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID);
    expect(scratch).toBeDefined();
    expect(scratch!.source.kind).toBe('scratchpad');
    expect(scratch!.name).toBe('Draft');
    const maxOrder = Math.max(...cfg.feeds.map((f) => f.order));
    expect(scratch!.order).toBe(maxOrder);
  });

  it('starts scratchpad disabled by default (hidden: true)', () => {
    const cfg = defaultConfig();
    const scratch = cfg.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID);
    expect(scratch!.hidden).toBe(true);
  });

  it('migrate() injects a scratchpad feed when an imported config lacks one', () => {
    const cfg = defaultConfig();
    const stripped = {
      ...cfg,
      feeds: cfg.feeds.filter((f) => f.id !== SCRATCHPAD_FEED_ID),
      schemaVersion: SCHEMA_VERSION,
    };
    const restored = importConfig(JSON.stringify(stripped));
    expect(restored.feeds.some((f) => f.id === SCRATCHPAD_FEED_ID)).toBe(true);
  });

  it('migrate() preserves an existing scratchpad with hidden: true', () => {
    const cfg = defaultConfig();
    const scratch = cfg.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID)!;
    scratch.hidden = true;
    const restored = importConfig(exportConfig(cfg));
    const restoredScratch = restored.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID);
    expect(restoredScratch?.hidden).toBe(true);
  });

  it('round-trips the hidden flag for any feed through export/import', () => {
    const cfg = defaultConfig();
    cfg.feeds[0]!.hidden = true;
    const restored = importConfig(exportConfig(cfg));
    expect(restored.feeds[0]!.hidden).toBe(true);
  });

  it('drops feeds that repeat an id (would crash the feed-row {#each})', () => {
    const cfg = defaultConfig();
    const dup = { ...cfg.feeds[0]!, name: 'Copy' };
    const withDup = { ...cfg, feeds: [...cfg.feeds, dup], schemaVersion: SCHEMA_VERSION };
    localStorage.setItem('calendar-timeline:config', JSON.stringify(withDup));
    const ids = loadConfig().feeds.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === cfg.feeds[0]!.id)).toHaveLength(1);
  });
});

describe('events cache quota handling', () => {
  const realSetItem = Storage.prototype.setItem;

  afterEach(() => {
    Storage.prototype.setItem = realSetItem;
    localStorage.clear();
  });

  // A bulky feed so two of them overflow the stubbed quota but one fits.
  function bulkyFeed(feedId: string, count = 60): ParsedEvent[] {
    const filler = 'x'.repeat(400);
    return Array.from({ length: count }, (_, i) => ({
      uid: `${feedId}-${i}`,
      feedId,
      title: `Event ${i}`,
      description: filler,
      descriptionSnippet: filler.slice(0, 80),
      location: 'Somewhere',
      start: new Date(2026, 0, 1 + i),
      end: new Date(2026, 0, 1 + i),
      allDay: true,
    })) as unknown as ParsedEvent[];
  }

  it('evicts the least-recently-refreshed feed when the store is full', () => {
    // Throw QuotaExceededError until the payload is small enough that only a
    // single feed remains, then accept the write — mimicking a full store.
    // One bulky feed serializes to ~41KB, two to ~82KB, so this sits between.
    const LIMIT = 60_000;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (value.length > LIMIT) {
        throw new DOMException('exceeded the quota', 'QuotaExceededError');
      }
      return realSetItem.call(this, key, value);
    };

    const byFeed = { stale: bulkyFeed('stale'), fresh: bulkyFeed('fresh') };
    // `stale` refreshed earlier than `fresh`, so it should be the one dropped.
    const lastSuccessAt = { stale: 1_000, fresh: 2_000 };
    saveEventsCache(byFeed, {}, lastSuccessAt, { stale: 'boom' });
    flushEventsCache();

    const loaded = loadEventsCache();
    expect(loaded).not.toBeNull();
    expect(loaded!.byFeed.fresh).toHaveLength(60);
    expect(loaded!.byFeed.stale).toBeUndefined();
    expect(loaded!.lastSuccessAt.fresh).toBe(2_000);
    // The evicted feed's error is dropped alongside its events.
    expect(loaded!.feedErrors.stale).toBeUndefined();
  });

  it('evicts oldest-first across several passes until it fits, keeping the freshest', () => {
    // Only ~one bulky feed fits, so three feeds force two eviction passes — the
    // path that reassembles the payload from pre-serialized chunks. The two
    // oldest go; the freshest survives and round-trips intact.
    const LIMIT = 60_000;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (value.length > LIMIT) {
        throw new DOMException('exceeded the quota', 'QuotaExceededError');
      }
      return realSetItem.call(this, key, value);
    };

    const byFeed = { old: bulkyFeed('old'), mid: bulkyFeed('mid'), newest: bulkyFeed('newest') };
    const lastSuccessAt = { old: 1_000, mid: 2_000, newest: 3_000 };
    saveEventsCache(byFeed, { newest: 'UTC' }, lastSuccessAt, {}, {
      old: { etag: '"o"', rangeKey: 'r' },
      newest: { etag: '"n"', rangeKey: 'r' },
    });
    flushEventsCache();

    const loaded = loadEventsCache();
    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded!.byFeed)).toEqual(['newest']);
    expect(loaded!.byFeed.newest).toHaveLength(60);
    expect(loaded!.validators.newest).toEqual({ etag: '"n"', rangeKey: 'r' });
    expect(loaded!.validators.old).toBeUndefined();
    expect(loaded!.tzByFeed.newest).toBe('UTC');
  });

  it('drops the evicted feed\'s validators alongside its events', () => {
    const LIMIT = 60_000;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (value.length > LIMIT) {
        throw new DOMException('exceeded the quota', 'QuotaExceededError');
      }
      return realSetItem.call(this, key, value);
    };

    const byFeed = { stale: bulkyFeed('stale'), fresh: bulkyFeed('fresh') };
    const lastSuccessAt = { stale: 1_000, fresh: 2_000 };
    const validators = {
      stale: { etag: '"s1"', rangeKey: 'r' },
      fresh: { etag: '"f1"', rangeKey: 'r' },
    };
    saveEventsCache(byFeed, {}, lastSuccessAt, {}, validators);
    flushEventsCache();

    const loaded = loadEventsCache();
    // A 304 for an evicted feed would leave nothing to show, so its
    // validators must go with it.
    expect(loaded!.validators.stale).toBeUndefined();
    expect(loaded!.validators.fresh).toEqual({ etag: '"f1"', rangeKey: 'r' });
  });

  it('persists everything when the store is not full', () => {
    const byFeed = { a: bulkyFeed('a', 5), b: bulkyFeed('b', 5) };
    saveEventsCache(byFeed, { a: 'UTC' }, { a: 1, b: 2 }, {});
    flushEventsCache();

    const loaded = loadEventsCache();
    expect(loaded!.byFeed.a).toHaveLength(5);
    expect(loaded!.byFeed.b).toHaveLength(5);
    expect(loaded!.tzByFeed.a).toBe('UTC');
  });

  it('persists feed errors so they survive a reload (e.g. while offline)', () => {
    saveEventsCache({ a: [] }, {}, { a: 0 }, { a: 'Failed to fetch: 404' });
    flushEventsCache();

    const loaded = loadEventsCache();
    expect(loaded!.feedErrors.a).toBe('Failed to fetch: 404');
  });

  it('loads a legacy cache without feedErrors as an empty map', () => {
    localStorage.setItem(
      EVENTS_CACHE_KEY,
      JSON.stringify({ byFeed: {}, tzByFeed: {}, lastSuccessAt: {} }),
    );
    const loaded = loadEventsCache();
    expect(loaded!.feedErrors).toEqual({});
    expect(loaded!.validators).toEqual({});
  });

  it('round-trips validators and drops malformed entries', () => {
    saveEventsCache({ a: [], b: [], c: [] }, {}, { a: 1, b: 1, c: 1 }, {}, {
      a: { etag: '"v1"', lastModified: 'Wed, 01 Jul 2026 00:00:00 GMT', rangeKey: 'r1' },
      // No rangeKey — unusable for revalidation, must be dropped on load.
      b: { etag: '"v2"' } as never,
      // rangeKey but no validator header — nothing to revalidate with.
      c: { rangeKey: 'r3' },
    });
    flushEventsCache();

    const loaded = loadEventsCache();
    expect(loaded!.validators.a).toEqual({
      etag: '"v1"',
      lastModified: 'Wed, 01 Jul 2026 00:00:00 GMT',
      rangeKey: 'r1',
    });
    expect(loaded!.validators.b).toBeUndefined();
    expect(loaded!.validators.c).toBeUndefined();
  });
});

describe('settings sections persistence', () => {
  it('defaults to filters + calendars open when nothing is stored', () => {
    expect(loadSettingsSections()).toEqual({
      look: false,
      time: false,
      filters: true,
      calendars: true,
    });
  });

  it('round-trips a toggled state', () => {
    saveSettingsSections({ look: true, time: false, filters: false, calendars: true });
    expect(loadSettingsSections()).toEqual({
      look: true,
      time: false,
      filters: false,
      calendars: true,
    });
  });

  it('fills missing or invalid entries with defaults', () => {
    localStorage.setItem(SETTINGS_SECTIONS_KEY, JSON.stringify({ look: true, time: 'yes' }));
    expect(loadSettingsSections()).toEqual({
      look: true,
      time: false,
      filters: true,
      calendars: true,
    });
  });

  it('survives garbage in storage', () => {
    localStorage.setItem(SETTINGS_SECTIONS_KEY, '{not json');
    expect(loadSettingsSections()).toEqual(loadSettingsSections());
    expect(loadSettingsSections().filters).toBe(true);
  });
});

describe('isDefaultOnlyFeeds', () => {
  it('is true for a fresh default config', () => {
    expect(isDefaultOnlyFeeds(defaultConfig().feeds)).toBe(true);
  });

  it('is false once a user feed is added', () => {
    const cfg = defaultConfig();
    cfg.feeds.push({
      id: 'user:custom',
      source: { kind: 'user', url: 'https://example.com/x.ics' },
      name: 'Custom',
      collapsed: false,
      order: 3,
      kind: 'events',
      category: 'none',
    });
    expect(isDefaultOnlyFeeds(cfg.feeds)).toBe(false);
  });

  it('is false once an imported local lane is added', () => {
    const cfg = defaultConfig();
    cfg.feeds.push({
      id: 'scratchpad:imported-uuid',
      source: { kind: 'scratchpad', id: 'imported-uuid' },
      name: 'Trips',
      collapsed: false,
      order: 3,
      kind: 'events',
      category: 'none',
    });
    expect(isDefaultOnlyFeeds(cfg.feeds)).toBe(false);
  });
});
