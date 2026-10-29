// @vitest-environment happy-dom
import { config, events, ui, createImportedLane, addScratchpadEvent } from './state.svelte';
import { applyShareImport, closeShareImport, openShareImport } from './share-import.svelte';
import { viewport } from './viewport.svelte';
import { defaultConfig } from './storage';
import { hashPin } from './kiosk-pin';
import { readKioskHome, saveKioskHome } from './kiosk-idle';
import { makeScratchpadEvent, SCRATCHPAD_KEY } from './scratchpad';
import { SCRATCHPAD_FEED_ID, type CalendarFeed } from './types';
import type { DecodedShare } from './share';

// The whole path a decoded link takes on this device, against the real state:
// one decision (decideShareImport), then refuse / import / ask.

const feed = (n: number): CalendarFeed => ({
  id: `shared-${n}`, source: { kind: 'user', url: `https://example.com/shared-${n}.ics` },
  name: `Shared ${n}`, collapsed: false, order: n, kind: 'events', category: 'none',
});
const event = (title: string) =>
  makeScratchpadEvent({ title, start: new Date('2026-11-02T09:00:00Z'), end: new Date('2026-11-02T10:00:00Z'), allDay: false });

function link(over: Partial<DecodedShare> = {}): DecodedShare {
  return { feeds: [feed(1)], rules: [], localFeeds: [], view: null, kioskPin: null, truncated: false, ...over };
}

const feedNames = () => config.feeds.map((f) => f.name);
const laneKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(SCRATCHPAD_KEY + ':'));

beforeEach(() => {
  localStorage.clear();
  const d = defaultConfig();
  config.feeds = d.feeds;
  config.rules = d.rules;
  config.kioskPin = null;
  for (const k of Object.keys(events.byFeed)) delete events.byFeed[k];
  events.byFeed[SCRATCHPAD_FEED_ID] = [];
  ui.shareImport = null;
  ui.errorModal = null;
  viewport.noPointer = false;
});

afterAll(() => {
  viewport.noPointer = false;
});

describe('openShareImport on a device someone can tap', () => {
  it('imports a plain link by itself on a fresh install', () => {
    openShareImport(link());
    expect(ui.shareImport).toBeNull();
    expect(feedNames()).toContain('Shared 1');
  });

  it('asks before touching a setup the user has made, then applies the choice', () => {
    config.rules = [...config.rules, { id: 'mine', find: 'x', style: 'bold', category: 'none' }];
    const l = link();
    openShareImport(l);
    expect(ui.shareImport).not.toBeNull();
    expect(feedNames()).not.toContain('Shared 1');
    applyShareImport(l, 'merge');
    expect(ui.shareImport).toBeNull();
    expect(feedNames()).toContain('Shared 1');
    expect(config.rules.some((r) => r.id === 'mine')).toBe(true);
  });

  it('asks before taking a kiosk lock, even on a fresh install', async () => {
    const l = link({ kioskPin: await hashPin('1234', 1000) });
    openShareImport(l);
    expect(ui.shareImport).not.toBeNull();
    expect(config.kioskPin).toBeNull();
    applyShareImport(l, 'replace');
    expect(config.kioskPin).toBe(l.kioskPin);
  });

  it('refuses every link while locked, with a note, and changes nothing', async () => {
    config.kioskPin = await hashPin('1234', 1000);
    const before = feedNames();
    openShareImport(link());
    expect(ui.shareImport).toBeNull();
    expect(ui.errorModal?.message).toMatch(/kiosk mode/);
    expect(feedNames()).toEqual(before);
  });

  it("won't apply a link from the dialog once the device has locked meanwhile", async () => {
    config.rules = [...config.rules, { id: 'mine', find: 'x', style: 'bold', category: 'none' }];
    const l = link();
    openShareImport(l);
    expect(ui.shareImport).not.toBeNull();
    config.kioskPin = await hashPin('1234', 1000);
    applyShareImport(l, 'replace');
    expect(feedNames()).not.toContain('Shared 1');
    expect(ui.shareImport).toBeNull();
    expect(ui.errorModal?.message).toMatch(/kiosk mode/);
  });

  it('keeps your Draft on Replace, and clears the lanes it drops from storage', () => {
    addScratchpadEvent({ title: 'Mine', start: new Date('2026-11-01T09:00:00Z'), end: new Date('2026-11-01T10:00:00Z'), allDay: false });
    createImportedLane('Old import', [event('Old')]);
    expect(laneKeys()).toHaveLength(1);
    config.rules = [...config.rules, { id: 'mine', find: 'x', style: 'bold', category: 'none' }];
    const l = link({ localFeeds: [{ name: 'Draft', category: 'none', isDraft: true, events: [event('Shared')] }] });
    openShareImport(l);
    applyShareImport(l, 'replace');
    expect(feedNames()).not.toContain('Old import');
    expect(laneKeys()).toHaveLength(0);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]!.map((e) => e.title).sort()).toEqual(['Mine', 'Shared']);
  });
});

describe('openShareImport on a display with no pointer', () => {
  beforeEach(() => {
    viewport.noPointer = true;
  });

  it('imports every whole link by itself, taking and replacing kiosk locks', async () => {
    const first = link({ kioskPin: await hashPin('1111', 1000) });
    openShareImport(first);
    expect(ui.shareImport).toBeNull();
    expect(config.kioskPin).toBe(first.kioskPin);
    const second = link({ feeds: [feed(2)], kioskPin: await hashPin('2222', 1000) });
    openShareImport(second);
    expect(config.kioskPin).toBe(second.kioskPin);
    expect(feedNames()).toContain('Shared 2');
    expect(feedNames()).not.toContain('Shared 1');
  });

  it('keeps the lock when a newer link carries none', async () => {
    config.kioskPin = await hashPin('1111', 1000);
    const lock = config.kioskPin;
    openShareImport(link({ feeds: [feed(3)] }));
    expect(feedNames()).toContain('Shared 3');
    expect(config.kioskPin).toBe(lock);
  });

  it('makes a re-sent link with the same lock the new kiosk home', async () => {
    const pin = await hashPin('1111', 1000);
    openShareImport(link({ kioskPin: pin }));
    saveKioskHome({ pin, zoom: 'year', lastNonWeek: 'year', markerMs: null, markerEndMs: null, collapsed: {} });
    const rev = ui.kioskHomeRev;
    openShareImport(link({ feeds: [feed(2)], kioskPin: pin }));
    expect(ui.kioskHomeRev).toBe(rev + 1);
    expect(readKioskHome(pin)).toBeNull();
  });

  it("re-sending a link doesn't stack its Draft events or leave old lanes behind", () => {
    const l = link({
      localFeeds: [
        { name: 'Draft', category: 'none', isDraft: true, events: [event('A'), event('B')] },
        { name: 'Bookings', category: 'none', events: [event('C')] },
      ],
    });
    for (let i = 0; i < 3; i++) openShareImport(l);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toHaveLength(2);
    expect(laneKeys()).toHaveLength(1);
    expect(feedNames().filter((n) => n === 'Bookings')).toHaveLength(1);
  });

  it('refuses a link cut short, with a note', () => {
    const before = feedNames();
    openShareImport(link({ truncated: true }));
    expect(ui.errorModal?.message).toMatch(/cut short/);
    expect(feedNames()).toEqual(before);
  });
});

describe('a kiosk link where the lock could never be checked', () => {
  it('is refused whole, never imported unlocked', async () => {
    const l = link({ kioskPin: await hashPin('1234', 1000) });
    vi.stubGlobal('crypto', {});
    try {
      openShareImport(l);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(ui.errorModal?.message).toMatch(/https/);
    expect(feedNames()).not.toContain('Shared 1');
    expect(config.kioskPin).toBeNull();
  });
});

describe('closeShareImport', () => {
  it('drops the pending link', () => {
    ui.shareImport = link();
    closeShareImport();
    expect(ui.shareImport).toBeNull();
  });
});
