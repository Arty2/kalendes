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

  it('initialises to the local day as a UTC midnight', async () => {
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
    vi.setSystemTime(new Date('2026-05-01T20:00:00Z')); // 23:00 in Athens
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

  // The suite runs in Europe/Athens (UTC+3 in October).
  it('turns over at local midnight, not UTC midnight', async () => {
    vi.setSystemTime(new Date('2026-10-05T21:10:00Z')); // 00:10 on the 6th in Athens
    const mod = await import('./today.svelte');
    expect(mod.today.value.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });

  it('follows the display timezone', async () => {
    vi.setSystemTime(new Date('2026-10-05T21:10:00Z'));
    const mod = await import('./today.svelte');
    mod.setTodayZone('America/New_York'); // 17:10 on the 5th
    expect(mod.today.value.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    mod.setTodayZone('local');
    expect(mod.today.value.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });

  it('starts a timed day at its local midnight instant, an all-day one at the UTC midnight', async () => {
    vi.setSystemTime(new Date('2026-10-05T21:10:00Z'));
    const mod = await import('./today.svelte');
    expect(new Date(mod.todayStartMs(true)).toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(new Date(mod.todayStartMs(false)).toISOString()).toBe('2026-10-05T21:00:00.000Z');
    expect(new Date(mod.tomorrowStartMs(false)).toISOString()).toBe('2026-10-06T21:00:00.000Z');
    // A 01:00 event tonight (22:00Z on the 5th) falls inside today.
    const ev = Date.parse('2026-10-05T22:00:00Z');
    expect(ev >= mod.todayStartMs(false) && ev < mod.tomorrowStartMs(false)).toBe(true);
  });
});
