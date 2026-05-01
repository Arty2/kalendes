import { describe, it, expect } from 'vitest';
import { exportConfig, importConfig, defaultConfig } from './storage';

describe('config import/export', () => {
  it('round-trips the default config', () => {
    const original = defaultConfig();
    const json = exportConfig(original);
    const restored = importConfig(json);
    expect(restored.feeds.length).toBe(original.feeds.length);
    expect(restored.refreshIntervalMs).toBe(original.refreshIntervalMs);
  });

  it('throws on malformed JSON', () => {
    expect(() => importConfig('not json')).toThrow();
  });

  it('throws on wrong schema version', () => {
    const bad = JSON.stringify({ schemaVersion: 999, feeds: [] });
    expect(() => importConfig(bad)).toThrow(/schema/i);
  });
});
