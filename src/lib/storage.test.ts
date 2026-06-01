import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  exportConfig,
  importConfig,
  defaultConfig,
  GREEK_HOLIDAYS_URL,
  USA_HOLIDAYS_URL,
  REFRESH_INTERVAL_OPTIONS,
  snapRefreshInterval,
  saveEventsCache,
  flushEventsCache,
  loadEventsCache,
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
    expect(restored.theme).toBe(original.theme);
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

  it('migrates a legacy baptism value to haptics', () => {
    const legacy = JSON.stringify({ ...defaultConfig(), haptics: undefined, baptism: 'vibration' });
    expect(importConfig(legacy).haptics).toBe('vibration');
  });

  it('throws on wrong schema version', () => {
    const bad = JSON.stringify({ schemaVersion: 999, feeds: [] });
    expect(() => importConfig(bad)).toThrow(/schema/i);
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
    saveEventsCache(byFeed, {}, lastSuccessAt);
    flushEventsCache();

    const loaded = loadEventsCache();
    expect(loaded).not.toBeNull();
    expect(loaded!.byFeed.fresh).toHaveLength(60);
    expect(loaded!.byFeed.stale).toBeUndefined();
    expect(loaded!.lastSuccessAt.fresh).toBe(2_000);
  });

  it('persists everything when the store is not full', () => {
    const byFeed = { a: bulkyFeed('a', 5), b: bulkyFeed('b', 5) };
    saveEventsCache(byFeed, { a: 'UTC' }, { a: 1, b: 2 });
    flushEventsCache();

    const loaded = loadEventsCache();
    expect(loaded!.byFeed.a).toHaveLength(5);
    expect(loaded!.byFeed.b).toHaveLength(5);
    expect(loaded!.tzByFeed.a).toBe('UTC');
  });
});
