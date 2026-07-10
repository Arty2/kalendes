import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  events,
  config,
  addScratchpadEvent,
  createImportedLane,
  moveEventToLane,
  moveEventsToLane,
  deleteLocalEvents,
  copyEventsToLane,
  seedTestData,
  displayEventsFor,
} from './state.svelte';
import { SCRATCHPAD_FEED_ID } from './types';
import { SCRATCHPAD_KEY } from './scratchpad';

function resetState(): void {
  localStorage.clear();
  // Drop any imported lanes; keep only the Draft lane (hidden by default) and clear its events.
  config.feeds = config.feeds.filter((f) => f.id === SCRATCHPAD_FEED_ID);
  const draft = config.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID);
  if (draft) draft.hidden = true;
  for (const key of Object.keys(events.byFeed)) delete events.byFeed[key];
  events.byFeed[SCRATCHPAD_FEED_ID] = [];
}

beforeEach(resetState);

describe('moveEventToLane', () => {
  it('moves an event between local lanes, keeping its uid and persisting both', () => {
    const ev = addScratchpadEvent({
      title: 'Trip',
      start: new Date('2026-02-01T10:00:00Z'),
      end: new Date('2026-02-01T11:00:00Z'),
      allDay: false,
    });
    const lane = createImportedLane('Imported', []);

    moveEventToLane(ev.uid, lane.id);

    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toHaveLength(0);
    expect(events.byFeed[lane.id]).toHaveLength(1);
    const moved = events.byFeed[lane.id]![0]!;
    expect(moved.uid).toBe(ev.uid);
    expect(moved.feedId).toBe(lane.id);

    // Both lanes are persisted to their own localStorage keys.
    const laneKey = SCRATCHPAD_KEY + ':' + (lane.source as { id: string }).id;
    expect(JSON.parse(localStorage.getItem(laneKey)!)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(SCRATCHPAD_KEY)!)).toHaveLength(0);
  });

  it('keeps destination events sorted by start time', () => {
    const lane = createImportedLane('Imported', []);
    addScratchpadEvent({
      title: 'Existing',
      start: new Date('2026-03-01T00:00:00Z'),
      end: new Date('2026-03-01T01:00:00Z'),
      allDay: false,
    }, lane.id);
    const early = addScratchpadEvent({
      title: 'Early',
      start: new Date('2026-01-01T00:00:00Z'),
      end: new Date('2026-01-01T01:00:00Z'),
      allDay: false,
    });

    moveEventToLane(early.uid, lane.id);

    expect(events.byFeed[lane.id]!.map((e) => e.title)).toEqual(['Early', 'Existing']);
  });

  it('is a no-op when source equals destination', () => {
    const ev = addScratchpadEvent({
      title: 'Stay',
      start: new Date('2026-02-01T10:00:00Z'),
      end: new Date('2026-02-01T11:00:00Z'),
      allDay: false,
    });
    moveEventToLane(ev.uid, SCRATCHPAD_FEED_ID);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toHaveLength(1);
  });

  it('refuses non-local destinations', () => {
    const ev = addScratchpadEvent({
      title: 'Stay',
      start: new Date('2026-02-01T10:00:00Z'),
      end: new Date('2026-02-01T11:00:00Z'),
      allDay: false,
    });
    moveEventToLane(ev.uid, 'user:abc123');
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toHaveLength(1);
    expect(events.byFeed['user:abc123']).toBeUndefined();
  });

  it('batch-moves several events at once, persisting each touched lane once', () => {
    const a = addScratchpadEvent({
      title: 'A', start: new Date('2026-01-02T00:00:00Z'), end: new Date('2026-01-03T00:00:00Z'), allDay: true,
    });
    const b = addScratchpadEvent({
      title: 'B', start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-02T00:00:00Z'), allDay: true,
    });
    const lane = createImportedLane('Imported', []);

    moveEventsToLane([a.uid, b.uid], lane.id);

    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toHaveLength(0);
    expect(events.byFeed[lane.id]!.map((e) => e.title)).toEqual(['B', 'A']);
    const laneKey = SCRATCHPAD_KEY + ':' + (lane.source as { id: string }).id;
    expect(JSON.parse(localStorage.getItem(laneKey)!)).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(SCRATCHPAD_KEY)!)).toHaveLength(0);
  });
});

describe('deleteLocalEvents', () => {
  it('removes only local-lane events, leaving URL-feed events untouched', () => {
    const local = addScratchpadEvent({
      title: 'Local', start: new Date('2026-01-02T00:00:00Z'), end: new Date('2026-01-03T00:00:00Z'), allDay: true,
    });
    // Simulate a URL-feed event living in a non-scratchpad lane.
    events.byFeed['user:abc'] = [{
      uid: 'url-1', feedId: 'user:abc', title: 'Remote', description: '', descriptionSnippet: '',
      location: '', start: new Date('2026-01-04T00:00:00Z'), end: new Date('2026-01-05T00:00:00Z'), allDay: true,
    }];

    deleteLocalEvents([local.uid, 'url-1']);

    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toHaveLength(0);
    expect(events.byFeed['user:abc']).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(SCRATCHPAD_KEY)!)).toHaveLength(0);
  });
});

describe('copyEventsToLane', () => {
  it('copies events into a local lane with fresh uids, leaving originals intact', () => {
    events.byFeed['user:abc'] = [{
      uid: 'url-1', feedId: 'user:abc', title: 'Remote', description: 'd', descriptionSnippet: 'd',
      location: 'L', start: new Date('2026-01-04T00:00:00Z'), end: new Date('2026-01-05T00:00:00Z'), allDay: true,
    }];

    copyEventsToLane(['url-1'], SCRATCHPAD_FEED_ID);

    expect(events.byFeed['user:abc']).toHaveLength(1);
    const draft = events.byFeed[SCRATCHPAD_FEED_ID]!;
    expect(draft).toHaveLength(1);
    expect(draft[0]!.title).toBe('Remote');
    expect(draft[0]!.uid).not.toBe('url-1');
    expect(draft[0]!.feedId).toBe(SCRATCHPAD_FEED_ID);
    expect(JSON.parse(localStorage.getItem(SCRATCHPAD_KEY)!)).toHaveLength(1);
  });
});

describe('working-hours limits (_displayByFeed)', () => {
  // The suite runs in Europe/Athens (UTC+2 in winter): 04:00Z = 06:00 local.
  beforeEach(() => {
    config.morningLimit = '08:30';
    config.eveningLimit = '20:30';
  });
  afterEach(() => {
    config.morningLimit = '08:30';
    config.eveningLimit = '20:30';
  });
  const hiddenOf = (uid: string) =>
    displayEventsFor(SCRATCHPAD_FEED_ID).find((e) => e.uid === uid)!.hidden;

  it('hides a short timed event starting before the morning limit', () => {
    const ev = addScratchpadEvent({
      title: 'Early gym',
      start: new Date('2026-02-02T04:00:00Z'),
      end: new Date('2026-02-02T04:30:00Z'),
      allDay: false,
    });
    expect(hiddenOf(ev.uid)).toBe(true);
  });

  it('keeps a timed event lasting a day or more visible regardless of start time', () => {
    // A multi-day conference starting at midnight is not off-hours noise —
    // hiding it by start clock time would drop it from the timeline entirely.
    const ev = addScratchpadEvent({
      title: 'Conference trip',
      start: new Date('2026-02-02T00:00:00Z'),
      end: new Date('2026-02-06T00:00:00Z'),
      allDay: false,
    });
    expect(hiddenOf(ev.uid)).toBe(false);
  });

  it('still hides a sub-day overnight event starting after the evening limit', () => {
    const ev = addScratchpadEvent({
      title: 'Late party',
      start: new Date('2026-02-02T19:00:00Z'), // 21:00 Athens
      end: new Date('2026-02-03T05:00:00Z'),
      allDay: false,
    });
    expect(hiddenOf(ev.uid)).toBe(true);
  });
});

describe('seedTestData', () => {
  it('populates the Draft with events around today and adds an imported lane', () => {
    seedTestData();
    const now = Date.now();

    const draft = events.byFeed[SCRATCHPAD_FEED_ID]!;
    expect(draft.length).toBeGreaterThan(0);
    expect(draft.some((e) => e.start.getTime() < now)).toBe(true);
    expect(draft.some((e) => e.start.getTime() > now)).toBe(true);
    // Sorted ascending by start.
    for (let i = 1; i < draft.length; i++) {
      expect(draft[i]!.start.getTime()).toBeGreaterThanOrEqual(draft[i - 1]!.start.getTime());
    }
    // The Draft lane is revealed (it defaults to hidden).
    expect(config.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID)!.hidden).toBeFalsy();

    const lane = config.feeds.find(
      (f) => f.source.kind === 'scratchpad' && f.id !== SCRATCHPAD_FEED_ID,
    );
    expect(lane).toBeDefined();
    expect((lane!.source as { id: string }).id).not.toBe('default');
    expect(events.byFeed[lane!.id]!.length).toBeGreaterThan(0);

    // Both lanes are persisted to their own localStorage keys.
    const laneKey = SCRATCHPAD_KEY + ':' + (lane!.source as { id: string }).id;
    expect(JSON.parse(localStorage.getItem(SCRATCHPAD_KEY)!).length).toBe(draft.length);
    expect(JSON.parse(localStorage.getItem(laneKey)!).length).toBe(events.byFeed[lane!.id]!.length);
  });
});
