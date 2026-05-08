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
import { SCHEMA_VERSION } from './types';

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
    expect(cfg.feeds.length).toBe(2);
    expect(cfg.feeds.every((f) => f.kind === 'holidays')).toBe(true);
  });

  it('migrates v1 config to current schema with defaults', () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      feeds: [
        {
          id: 'user:test',
          source: { kind: 'user', url: 'https://example.com/cal.ics' },
          name: 'Test',
          collapsed: false,
          order: 0,
        },
      ],
      refreshIntervalMs: 60_000,
    });
    const restored = importConfig(v1);
    expect(restored.schemaVersion).toBe(SCHEMA_VERSION);
    expect(restored.feeds.length).toBe(1);
    expect(restored.refreshIntervalMs).toBe(30 * 60_000);
    expect(['light', 'dark']).toContain(restored.theme);
    expect(restored.locale).toBe('en');
    expect(restored.dateFormat).toBe('YYYY-MM-DD');
    expect(restored.rules).toEqual([]);
    expect(restored.feeds[0]!.kind).toBe('events');
    expect(restored.cardShowLocation).toBe(true);
    expect(restored.cardShowDescription).toBe(false);
    expect(restored.timezone).toBe('local');
    expect(restored.timeFormat).toBe('24h');
    expect(restored.pastMonths).toBe(12);
    expect(restored.futureMonths).toBe(24);
  });

  it('USA default feed no longer points at the blocked Apple ICS host', () => {
    expect(USA_HOLIDAYS_URL).not.toMatch(/apple\.com/);
    const cfg = defaultConfig();
    const usa = cfg.feeds.find((f) => f.id === 'user:usa-bank-holidays');
    expect(usa?.source.kind === 'user' && usa.source.url).toBe(USA_HOLIDAYS_URL);
  });

  it.each([
    'https://www.apple.com/calendar/ical/USHolidays.ics',
    'https://www.officeholidays.com/ics/usa',
  ])('migrates an existing config from a stale USA URL (%s)', (legacy) => {
    const stale = JSON.stringify({
      schemaVersion: 3,
      feeds: [
        {
          id: 'user:usa-bank-holidays',
          source: { kind: 'user', url: legacy },
          name: 'USA Bank Holidays',
          collapsed: false,
          order: 1,
          kind: 'holidays',
        },
      ],
      refreshIntervalMs: 60_000,
    });
    const restored = importConfig(stale);
    const usa = restored.feeds[0]!;
    expect(usa.source.kind === 'user' && usa.source.url).toBe(USA_HOLIDAYS_URL);
  });

  it('default Greek feed points at Google ICS, not officeholidays', () => {
    expect(GREEK_HOLIDAYS_URL).toMatch(/calendar\.google\.com/);
    expect(GREEK_HOLIDAYS_URL).not.toMatch(/officeholidays/);
    const cfg = defaultConfig();
    const greek = cfg.feeds.find((f) => f.id === 'user:greek-bank-holidays');
    expect(greek?.source.kind === 'user' && greek.source.url).toBe(GREEK_HOLIDAYS_URL);
  });

  it('migrates a stale officeholidays Greek URL to the new Google ICS', () => {
    const stale = JSON.stringify({
      schemaVersion: 3,
      feeds: [
        {
          id: 'user:greek-bank-holidays',
          source: { kind: 'user', url: 'https://www.officeholidays.com/ics/greece' },
          name: 'Greek Bank Holidays',
          collapsed: false,
          order: 0,
          kind: 'holidays',
        },
      ],
      refreshIntervalMs: 60_000,
    });
    const restored = importConfig(stale);
    const greek = restored.feeds[0]!;
    expect(greek.source.kind === 'user' && greek.source.url).toBe(GREEK_HOLIDAYS_URL);
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

  it('migrates a stored 15-minute interval up to the nearest canonical interval', () => {
    const stale = JSON.stringify({
      schemaVersion: 3,
      feeds: [],
      refreshIntervalMs: 15 * 60_000,
    });
    const restored = importConfig(stale);
    expect(restored.refreshIntervalMs).toBe(30 * 60_000);
  });

  it('migrates a stored 120-minute interval to the new 4-hour canonical', () => {
    const stale = JSON.stringify({
      schemaVersion: 4,
      feeds: [],
      refreshIntervalMs: 120 * 60_000,
    });
    const restored = importConfig(stale);
    expect([60 * 60_000, 240 * 60_000]).toContain(restored.refreshIntervalMs);
  });

  it('round-trips a per-feed timezone override through export/import', () => {
    const cfg = defaultConfig();
    cfg.feeds[0]!.timezone = 'America/Los_Angeles';
    const restored = importConfig(exportConfig(cfg));
    expect(restored.feeds[0]!.timezone).toBe('America/Los_Angeles');
  });

  it("resolves theme: 'system' from a v2 config to a concrete light/dark", () => {
    const v2 = JSON.stringify({
      schemaVersion: 2,
      feeds: [],
      refreshIntervalMs: 60_000,
      theme: 'system',
      locale: 'en',
      dateFormat: 'YYYY-MM-DD',
      rules: [],
    });
    const restored = importConfig(v2);
    expect(['light', 'dark']).toContain(restored.theme);
  });
});
