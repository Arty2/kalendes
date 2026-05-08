import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('today rune', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T10:00:00Z'));
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('initialises to UTC start-of-day', async () => {
    const mod = await import('./today.svelte');
    expect(mod.today.value.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('advances when refreshToday() is called after a day rolls over', async () => {
    const mod = await import('./today.svelte');
    expect(mod.today.value.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    vi.setSystemTime(new Date('2026-05-02T03:00:00Z'));
    mod.refreshToday();
    expect(mod.today.value.toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });

  it('does not change the rune when called within the same day', async () => {
    const mod = await import('./today.svelte');
    const before = mod.today.value;
    vi.setSystemTime(new Date('2026-05-01T23:00:00Z'));
    mod.refreshToday();
    expect(mod.today.value).toBe(before);
  });

  it('flips data-past for an event that crosses midnight', async () => {
    const mod = await import('./today.svelte');
    const eventEnd = new Date('2026-05-01T20:00:00Z');
    expect(eventEnd.getTime() < mod.today.value.getTime()).toBe(false);
    vi.setSystemTime(new Date('2026-05-02T03:00:00Z'));
    mod.refreshToday();
    expect(eventEnd.getTime() < mod.today.value.getTime()).toBe(true);
  });
});
