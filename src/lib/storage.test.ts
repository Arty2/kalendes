import { describe, it, expect, beforeEach } from 'vitest';
import { exportConfig, importConfig, defaultConfig, USA_HOLIDAYS_URL } from './storage';
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
    expect(restored.refreshIntervalMs).toBe(60_000);
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
