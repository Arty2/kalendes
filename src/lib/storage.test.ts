import { describe, it, expect, beforeEach } from 'vitest';
import {
  exportConfig,
  importConfig,
  defaultConfig,
  GREEK_HOLIDAYS_URL,
  USA_HOLIDAYS_URL,
  REFRESH_INTERVAL_OPTIONS,
  snapRefreshInterval,
} from './storage';
import { SCHEMA_VERSION, SCRATCHPAD_FEED_ID } from './types';

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
    expect(scratch!.name).toBe('Scratchpad');
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
