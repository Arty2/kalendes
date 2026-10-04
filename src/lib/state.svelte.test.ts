// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  events,
  config,
  ui,
  addScratchpadEvent,
  createImportedLane,
  moveEventToLane,
  moveEventsToLane,
  deleteLocalEvents,
  rescheduleLocalEvents,
  undoLastChange,
  focus,
  focusEventByUid,
  timelineEventsFor,
  updateScratchpadEvent,
  laneExport,
  markLaneExported,
  removeLocalLane,
  copyEventsToLane,
  openDevImport,
  displayEventsFor,
  setTempMarkerDay,
  setTempMarkerRange,
  clearTempMarker,
  markerRange,
  markerIsSpan,
  restoreLocalLanes,
  clearTempMarkerByTap,
  isTrailingClearClick,
  selection,
} from './state.svelte';
import { SCRATCHPAD_FEED_ID, type CalendarFeed, type FindReplaceRule, type ParsedEvent } from './types';
import type { DecodedLocalFeed } from './share';
import { SCRATCHPAD_KEY } from './scratchpad';
import { undoBar, undoStack, clearUndo, dismissUndoBar } from './undo.svelte';

function resetState(): void {
  localStorage.clear();
  for (const k of Object.keys(laneExport.dirty)) delete laneExport.dirty[k];
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

describe('undoLastChange', () => {
  beforeEach(() => {
    clearUndo();
    dismissUndoBar();
  });

  it('restores the lane from before a reschedule, and says what changed', () => {
    const ev = addScratchpadEvent({
      title: 'Yoga', start: new Date('2026-06-10T07:00:00Z'), end: new Date('2026-06-10T08:00:00Z'), allDay: false,
    });
    const before = events.byFeed[SCRATCHPAD_FEED_ID];
    rescheduleLocalEvents([ev.uid], { kind: 'shift', days: 1, minutes: 0 }, 'Europe/Athens');
    expect(undoBar.message).toMatch(/^Moved “Yoga” to /);
    expect(undoBar.canUndo).toBe(true);

    expect(undoLastChange()).toBe(true);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toBe(before);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]![0]!.start.toISOString()).toBe('2026-06-10T07:00:00.000Z');
    const stored = JSON.parse(localStorage.getItem(SCRATCHPAD_KEY)!) as { start: string }[];
    expect(stored[0]!.start).toBe('2026-06-10T07:00:00.000Z');
    expect(undoBar.canUndo).toBe(false);
    expect(undoLastChange()).toBe(false);
  });

  it('undoes changes newest first', () => {
    const ev = addScratchpadEvent({
      title: 'Call', start: new Date('2026-06-10T07:00:00Z'), end: new Date('2026-06-10T08:00:00Z'), allDay: false,
    });
    rescheduleLocalEvents([ev.uid], { kind: 'shift', days: 1, minutes: 0 }, 'Europe/Athens');
    rescheduleLocalEvents([ev.uid], { kind: 'resize-end', minutes: 30 }, 'Europe/Athens');
    expect(undoBar.message).toMatch(/^Resized “Call”/);
    undoLastChange();
    expect(events.byFeed[SCRATCHPAD_FEED_ID]![0]!.end.toISOString()).toBe('2026-06-11T08:00:00.000Z');
    // Offers the move next, by name.
    expect(undoBar.message).toMatch(/^Undone · next: Moved “Call”/);
    expect(undoBar.next).toMatch(/^Moved “Call”/);
    expect(undoBar.canUndo).toBe(true);
    undoLastChange();
    expect(events.byFeed[SCRATCHPAD_FEED_ID]![0]!.start.toISOString()).toBe('2026-06-10T07:00:00.000Z');
  });

  it('keeps the timeline focus on the same event across the restore', () => {
    config.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID)!.hidden = false;
    const day = (d: number) => new Date(Date.UTC(2026, 9, d));
    const mk = (title: string, d: number) =>
      addScratchpadEvent({ title, start: day(d), end: day(d + 1), allDay: true });
    const a = mk('A', 10);
    mk('B', 11);
    mk('C', 12);
    rescheduleLocalEvents([a.uid], { kind: 'shift', days: 5, minutes: 0 }, 'Europe/Athens');
    focusEventByUid(a.uid);
    expect(focus.eventIndex).toBe(2);
    undoLastChange();
    expect(focus.feedId).toBe(SCRATCHPAD_FEED_ID);
    expect(timelineEventsFor(SCRATCHPAD_FEED_ID)[focus.eventIndex]?.uid).toBe(a.uid);
  });

  it('drops the history (and the bar) once the lane is edited some other way', () => {
    const ev = addScratchpadEvent({
      title: 'Call', start: new Date('2026-06-10T07:00:00Z'), end: new Date('2026-06-10T08:00:00Z'), allDay: false,
    });
    rescheduleLocalEvents([ev.uid], { kind: 'shift', days: 1, minutes: 0 }, 'Europe/Athens');
    expect(undoBar.message).not.toBeNull();
    addScratchpadEvent({
      title: 'New', start: new Date('2026-06-12T07:00:00Z'), end: new Date('2026-06-12T08:00:00Z'), allDay: false,
    });
    expect(undoStack.entries).toHaveLength(0);
    expect(undoBar.message).toBeNull();
    const now = events.byFeed[SCRATCHPAD_FEED_ID];
    expect(undoLastChange()).toBe(false);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toBe(now);
  });

  it('refuses a lane replaced without going through the lane writer', () => {
    const ev = addScratchpadEvent({
      title: 'Call', start: new Date('2026-06-10T07:00:00Z'), end: new Date('2026-06-10T08:00:00Z'), allDay: false,
    });
    rescheduleLocalEvents([ev.uid], { kind: 'shift', days: 1, minutes: 0 }, 'Europe/Athens');
    events.byFeed[SCRATCHPAD_FEED_ID] = [...events.byFeed[SCRATCHPAD_FEED_ID]!];
    const now = events.byFeed[SCRATCHPAD_FEED_ID];
    expect(undoLastChange()).toBe(true);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toBe(now);
    expect(undoBar.message).toMatch(/Can't undo/);
    expect(undoStack.entries).toHaveLength(0);
  });

  it('keeps the bar through a stack, offering each earlier change in turn', () => {
    const ev = addScratchpadEvent({
      title: 'Call', start: new Date('2026-06-10T07:00:00Z'), end: new Date('2026-06-10T08:00:00Z'), allDay: false,
    });
    for (let i = 0; i < 3; i++) {
      rescheduleLocalEvents([ev.uid], { kind: 'shift', days: 1, minutes: 0 }, 'Europe/Athens');
    }
    undoLastChange();
    expect(undoBar.message).toMatch(/^Undone · next: Moved “Call” to .*2026-06-12/);
    undoLastChange();
    expect(undoBar.message).toMatch(/^Undone · next: Moved “Call” to .*2026-06-11/);
    expect(undoBar.canUndo).toBe(true);
    undoLastChange();
    expect(events.byFeed[SCRATCHPAD_FEED_ID]![0]!.start.toISOString()).toBe('2026-06-10T07:00:00.000Z');
    expect(undoBar.message).toMatch(/^Undone: Moved “Call”/);
    expect(undoBar.canUndo).toBe(false);
  });
});

describe('rescheduleLocalEvents', () => {
  it('re-times local events, keeps their wall clock across DST, re-sorts and persists', () => {
    // Sat 28 March 2026 10:00 Athens (+2); Athens springs forward the next night.
    const a = addScratchpadEvent({
      title: 'Yoga', start: new Date('2026-03-28T08:00:00Z'), end: new Date('2026-03-28T09:00:00Z'), allDay: false,
    });
    const b = addScratchpadEvent({
      title: 'Later', start: new Date('2026-03-29T12:00:00Z'), end: new Date('2026-03-29T13:00:00Z'), allDay: false,
    });

    const n = rescheduleLocalEvents([a.uid], { kind: 'shift', days: 2, minutes: 0 }, 'Europe/Athens');

    expect(n).toBe(1);
    const list = events.byFeed[SCRATCHPAD_FEED_ID]!;
    // Mon 30 March, still 10:00 — now at +3.
    expect(list.map((e) => e.uid)).toEqual([b.uid, a.uid]);
    expect(list[1]!.start.toISOString()).toBe('2026-03-30T07:00:00.000Z');
    expect(list[1]!.end.toISOString()).toBe('2026-03-30T08:00:00.000Z');
    expect(list[1]!.title).toBe('Yoga');
    const stored = JSON.parse(localStorage.getItem(SCRATCHPAD_KEY)!) as { uid: string; start: string }[];
    expect(stored.find((e) => e.uid === a.uid)!.start).toBe('2026-03-30T07:00:00.000Z');
  });

  it('converts between all-day and timed', () => {
    const ev = addScratchpadEvent({
      title: 'Call', start: new Date('2026-06-10T07:00:00Z'), end: new Date('2026-06-10T08:00:00Z'), allDay: false,
    });
    rescheduleLocalEvents([ev.uid], { kind: 'to-all-day', dayMs: Date.UTC(2026, 5, 11), days: 1 }, 'Europe/Athens');
    const moved = events.byFeed[SCRATCHPAD_FEED_ID]![0]!;
    expect(moved.allDay).toBe(true);
    expect(moved.start.toISOString()).toBe('2026-06-11T00:00:00.000Z');
    expect(moved.end.toISOString()).toBe('2026-06-12T00:00:00.000Z');
  });

  it('never touches URL-feed events', () => {
    events.byFeed['user:abc'] = [{
      uid: 'url-1', feedId: 'user:abc', title: 'Remote', description: '', descriptionSnippet: '',
      location: '', start: new Date('2026-01-04T00:00:00Z'), end: new Date('2026-01-05T00:00:00Z'), allDay: true,
    }];
    config.feeds = [...config.feeds, {
      id: 'user:abc', name: 'Remote', source: { kind: 'user', url: 'https://example.com/a.ics' },
    } as CalendarFeed];

    expect(rescheduleLocalEvents(['url-1'], { kind: 'shift', days: 1, minutes: 0 })).toBe(0);
    expect(events.byFeed['user:abc']![0]!.start.toISOString()).toBe('2026-01-04T00:00:00.000Z');
  });
});

describe('local-lane revisions and the changed-since-export flag', () => {
  it('an edit keeps the uid and bumps SEQUENCE; a reschedule bumps it again', () => {
    const ev = addScratchpadEvent({
      title: 'Call', start: new Date('2026-06-10T07:00:00Z'), end: new Date('2026-06-10T08:00:00Z'), allDay: false,
    });
    expect(ev.sequence).toBeUndefined();
    updateScratchpadEvent(ev.uid, {
      title: 'Call (edited)', start: ev.start, end: ev.end, allDay: false,
    });
    let stored = events.byFeed[SCRATCHPAD_FEED_ID]![0]!;
    expect(stored.uid).toBe(ev.uid);
    expect(stored.sequence).toBe(1);
    expect(stored.lastModified).toBeInstanceOf(Date);

    rescheduleLocalEvents([ev.uid], { kind: 'shift', days: 1, minutes: 0 }, 'Europe/Athens');
    stored = events.byFeed[SCRATCHPAD_FEED_ID]![0]!;
    expect(stored.uid).toBe(ev.uid);
    expect(stored.sequence).toBe(2);
    expect(JSON.parse(localStorage.getItem(SCRATCHPAD_KEY)!)[0].sequence).toBe(2);
  });

  it('flags a lane edited since its last export, until it is exported again', () => {
    expect(laneExport.dirty[SCRATCHPAD_FEED_ID]).toBeUndefined();
    const ev = addScratchpadEvent({
      title: 'A', start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-11T00:00:00Z'), allDay: true,
    });
    expect(laneExport.dirty[SCRATCHPAD_FEED_ID]).toBe(true);
    markLaneExported(SCRATCHPAD_FEED_ID);
    expect(laneExport.dirty[SCRATCHPAD_FEED_ID]).toBeUndefined();
    deleteLocalEvents([ev.uid]);
    expect(laneExport.dirty[SCRATCHPAD_FEED_ID]).toBe(true);
  });

  it('a freshly imported lane is not flagged; removing a lane drops its flag', () => {
    const lane = createImportedLane('Imported', []);
    expect(laneExport.dirty[lane.id]).toBeUndefined();
    addScratchpadEvent({
      title: 'B', start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-11T00:00:00Z'), allDay: true,
    }, lane.id);
    expect(laneExport.dirty[lane.id]).toBe(true);
    removeLocalLane(lane.id);
    expect(laneExport.dirty[lane.id]).toBeUndefined();
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

describe('working-hours limits no longer hide events (_displayByFeed)', () => {
  // morningLimit/eveningLimit drive only the working-hours visuals now; an event
  // is never hidden because of when it starts. The suite runs in Europe/Athens.
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

  it('keeps a short timed event starting before the morning limit visible', () => {
    const ev = addScratchpadEvent({
      title: 'Early gym',
      start: new Date('2026-02-02T04:00:00Z'), // 06:00 Athens, before 08:30
      end: new Date('2026-02-02T04:30:00Z'),
      allDay: false,
    });
    expect(hiddenOf(ev.uid)).toBeFalsy();
  });

  it('keeps a short timed event starting after the evening limit visible', () => {
    const ev = addScratchpadEvent({
      title: 'Late party',
      start: new Date('2026-02-02T19:00:00Z'), // 21:00 Athens, after 20:30
      end: new Date('2026-02-02T20:00:00Z'),
      allDay: false,
    });
    expect(hiddenOf(ev.uid)).toBeFalsy();
  });

  it('keeps an early-starting multi-day event visible', () => {
    const ev = addScratchpadEvent({
      title: 'Conference trip',
      start: new Date('2026-02-02T06:00:00Z'), // 08:00 Athens, before 08:30
      end: new Date('2026-02-02T20:00:00Z'),
      allDay: false,
    });
    expect(hiddenOf(ev.uid)).toBeFalsy();
  });
});

describe('openDevImport', () => {
  it('loads the share-import dialog with demo feeds, rules, and local lanes', () => {
    ui.shareImport = null;
    openDevImport();
    const now = Date.now();

    expect(ui.shareImport).not.toBeNull();
    // svelte-check mis-narrows repeated reads of this $state member (each use
    // degrades to `never`); a plain structural cast sidesteps that.
    const staged = ui.shareImport as unknown as {
      feeds: CalendarFeed[];
      rules: FindReplaceRule[];
      localFeeds: DecodedLocalFeed[];
    };

    // Default (holiday) feeds ride along so a Replace doesn't wipe them.
    expect(staged.feeds.length).toBeGreaterThan(0);
    expect(staged.feeds.every((f) => f.source.kind === 'user')).toBe(true);

    // Default rules plus the four demo filters (one per mode).
    const ruleIds = staged.rules.map((r) => r.id);
    for (const id of ['demo-matte', 'demo-block', 'demo-replace', 'demo-blank']) {
      expect(ruleIds).toContain(id);
    }

    // A Draft lane (isDraft) with events, plus a separate imported lane.
    let draftLane: DecodedLocalFeed | undefined;
    let importedLane: DecodedLocalFeed | undefined;
    for (const l of staged.localFeeds) {
      if (l.isDraft) draftLane = l;
      else importedLane = l;
    }
    expect(draftLane).toBeDefined();
    expect(importedLane).toBeDefined();
    expect(importedLane!.events.length).toBeGreaterThan(0);

    // Draft events straddle today and are sorted ascending by start.
    const draft = draftLane!.events;
    expect(draft.length).toBeGreaterThan(0);
    expect(draft.some((e: ParsedEvent) => e.start.getTime() < now)).toBe(true);
    expect(draft.some((e: ParsedEvent) => e.start.getTime() > now)).toBe(true);
    for (let i = 1; i < draft.length; i++) {
      expect(draft[i]!.start.getTime()).toBeGreaterThanOrEqual(draft[i - 1]!.start.getTime());
    }

    // It stages the import for the dialog rather than mutating live state.
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toEqual([]);
    ui.shareImport = null;
  });
});

describe('_displayByFeed per-feed decoration cache', () => {
  it('leaves an unchanged feed\'s display array reference-stable when another feed is edited', () => {
    // Feed B (imported lane) with one event; Draft (feed A) starts empty.
    const laneB = createImportedLane('Imported', [], {});
    addScratchpadEvent(
      {
        title: 'B event',
        start: new Date('2026-05-01T10:00:00Z'),
        end: new Date('2026-05-01T11:00:00Z'),
        allDay: false,
      },
      laneB.id,
    );

    const beforeB = displayEventsFor(laneB.id);
    expect(beforeB).toHaveLength(1);

    // Mutate a DIFFERENT feed (the Draft). This invalidates the _displayByFeed
    // derived, but feed B's raw array and the rules are unchanged, so its
    // decorated result must be reused (same reference), not recomputed.
    addScratchpadEvent({
      title: 'A event',
      start: new Date('2026-05-02T10:00:00Z'),
      end: new Date('2026-05-02T11:00:00Z'),
      allDay: false,
    });

    const afterB = displayEventsFor(laneB.id);
    expect(afterB).toBe(beforeB);

    // Editing feed B itself does recompute it (fresh reference, updated content).
    addScratchpadEvent(
      {
        title: 'B event 2',
        start: new Date('2026-05-03T10:00:00Z'),
        end: new Date('2026-05-03T11:00:00Z'),
        allDay: false,
      },
      laneB.id,
    );
    const editedB = displayEventsFor(laneB.id);
    expect(editedB).not.toBe(beforeB);
    expect(editedB).toHaveLength(2);
  });
});

describe('temporary day marker', () => {
  // The marker is UTC calendar days; the suite runs in Europe/Athens, so any
  // slip into local-time arithmetic lands these on the wrong day.
  const may1 = Date.UTC(2026, 4, 1);
  const may9 = Date.UTC(2026, 4, 9);

  beforeEach(clearTempMarker);
  afterEach(clearTempMarker);

  it('starts empty', () => {
    expect(markerRange()).toBe(null);
  });

  it('reports a single day as a one-day span', () => {
    setTempMarkerDay(may1);
    expect(ui.tempMarkerEndMs).toBe(null);
    expect(markerRange()).toEqual({ startMs: may1, endMs: may1, days: 1 });
  });

  it('counts a duration inclusively', () => {
    setTempMarkerRange(may1, may9);
    expect(markerRange()).toEqual({ startMs: may1, endMs: may9, days: 9 });
  });

  it('reads a one-day duration as a single day, not a span', () => {
    setTempMarkerDay(may1);
    expect(markerIsSpan()).toBe(false);
    setTempMarkerRange(may1, may1);
    expect(ui.tempMarkerEndMs).toBe(may1);
    expect(markerIsSpan()).toBe(false);
    setTempMarkerRange(may1, may9);
    expect(markerIsSpan()).toBe(true);
  });

  it('clamps an end that would sit before the start', () => {
    setTempMarkerRange(may9, may1);
    expect(ui.tempMarkerEndMs).toBe(may9);
    expect(markerRange()).toEqual({ startMs: may9, endMs: may9, days: 1 });
  });

  it('collapses a previous duration when a day is placed', () => {
    setTempMarkerRange(may1, may9);
    setTempMarkerDay(may1);
    expect(ui.tempMarkerEndMs).toBe(null);
    expect(markerRange()?.days).toBe(1);
  });

  it('clears both ends', () => {
    setTempMarkerRange(may1, may9);
    clearTempMarker();
    expect(ui.tempMarkerMs).toBe(null);
    expect(ui.tempMarkerEndMs).toBe(null);
    expect(markerRange()).toBe(null);
  });

  it('ignores a stale end left behind by a direct write', () => {
    setTempMarkerRange(may1, may9);
    ui.tempMarkerMs = Date.UTC(2026, 5, 1); // moved past its own end
    expect(markerRange()).toEqual({
      startMs: Date.UTC(2026, 5, 1),
      endMs: Date.UTC(2026, 5, 1),
      days: 1,
    });
  });
});

describe('restoreLocalLanes', () => {
  it("writes a file's lanes to storage as-is and falls back to storage for the rest", () => {
    const kept = addScratchpadEvent({ title: 'Kept', start: new Date('2026-05-02T09:00:00Z'), end: new Date('2026-05-02T10:00:00Z'), allDay: false });
    const lane = createImportedLane('Trip', []);
    const fromFile: ParsedEvent = {
      uid: 'trip-1@kalendes', feedId: lane.id, title: 'Flight', description: '', descriptionSnippet: '',
      location: '', start: new Date('2026-06-01T09:00:00Z'), end: new Date('2026-06-01T12:00:00Z'), allDay: false, sequence: 3,
    };
    laneExport.dirty[lane.id] = true;
    restoreLocalLanes({ [lane.id]: [fromFile] });
    expect(events.byFeed[lane.id]).toEqual([fromFile]);
    // Same uid in storage: a restore is the same lane, not a copy.
    const laneKey = SCRATCHPAD_KEY + ':' + (lane.source as { id: string }).id;
    expect(JSON.parse(localStorage.getItem(laneKey)!)[0]).toMatchObject({ uid: 'trip-1@kalendes', sequence: 3 });
    expect(laneExport.dirty[lane.id]).toBeUndefined();
    // The Draft wasn't in the file — it keeps what this device stored.
    expect(events.byFeed[SCRATCHPAD_FEED_ID]!.map((e) => e.uid)).toEqual([kept.uid]);
  });
});

describe('clearTempMarkerByTap', () => {
  afterEach(() => vi.useRealTimers());

  it('clears the marker and flags only the click that trails the tap', () => {
    vi.useFakeTimers();
    setTempMarkerDay(Date.UTC(2026, 4, 1));
    expect(isTrailingClearClick()).toBe(false);
    clearTempMarkerByTap();
    expect(ui.tempMarkerMs).toBeNull();
    // The synthesized click arrives within a few ms of the pointerup…
    vi.advanceTimersByTime(30);
    expect(isTrailingClearClick()).toBe(true);
    // …while a deliberate tap a moment later places a marker again.
    vi.advanceTimersByTime(600);
    expect(isTrailingClearClick()).toBe(false);
  });
});

describe('repeating local events', () => {
  beforeEach(resetState);

  // A weekly 10:00 Athens series starting a week ago, so it overlaps the window.
  function weekly(): ParsedEvent {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7, 7));
    const ev = addScratchpadEvent({
      title: 'Standup', start, end: new Date(start.getTime() + 30 * 60_000), allDay: false,
      rrule: 'FREQ=WEEKLY;COUNT=4', tzid: 'Europe/Athens',
    });
    return ev;
  }
  const occurrences = () => displayEventsFor(SCRATCHPAD_FEED_ID).filter((e) => e.seriesUid);

  it('stores the series once and shows its occurrences', () => {
    const s = weekly();
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toHaveLength(1);
    expect(occurrences()).toHaveLength(4);
    const stored = JSON.parse(localStorage.getItem(SCRATCHPAD_KEY)!) as { rrule?: string; tzid?: string }[];
    expect(stored[0]).toMatchObject({ rrule: 'FREQ=WEEKLY;COUNT=4', tzid: 'Europe/Athens' });
    expect(occurrences().every((o) => o.seriesUid === s.uid)).toBe(true);
  });

  it('deletes one occurrence from the tray, leaving the rest', () => {
    weekly();
    const second = occurrences()[1]!;
    deleteLocalEvents([second.uid]);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toHaveLength(1);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]![0]!.exdates).toEqual([second.start]);
    expect(occurrences().map((o) => o.uid)).not.toContain(second.uid);
    expect(occurrences()).toHaveLength(3);
  });

  it('drags one occurrence out of the series as a one-off', () => {
    const s = weekly();
    const third = occurrences()[2]!;
    expect(rescheduleLocalEvents([third.uid], { kind: 'shift', days: 1, minutes: 0 }, 'Europe/Athens')).toBe(1);
    const lane = events.byFeed[SCRATCHPAD_FEED_ID]!;
    expect(lane).toHaveLength(2);
    const oneOff = lane.find((e) => !e.rrule)!;
    expect(oneOff.uid).not.toBe(s.uid);
    expect(oneOff.start.getTime()).toBe(third.start.getTime() + 86_400_000);
    expect(occurrences()).toHaveLength(3);
  });

  it('gives a lane imported twice its own uids, so the copies stay apart', () => {
    const s = weekly();
    const again = createImportedLane('Again', [{ ...s }]);
    const copy = events.byFeed[again.id]![0]!;
    expect(copy.uid).not.toBe(s.uid);
    deleteLocalEvents([occurrences()[1]!.uid]);
    expect(copy.exdates).toBeUndefined();
    expect(events.byFeed[again.id]![0]!.exdates).toBeUndefined();
  });

  it('gives duplicate uids within one import, and ones a feed holds, fresh uids', () => {
    events.byFeed['feed:x'] = [{ ...weekly(), uid: 'ext:1', feedId: 'feed:x' }];
    const base = events.byFeed['feed:x'][0]!;
    const lane = createImportedLane('Dupes', [{ ...base, uid: 'ext:1' }, { ...base, uid: 'dup' }, { ...base, uid: 'dup' }]);
    const uids = events.byFeed[lane.id]!.map((e) => e.uid);
    expect(new Set(uids).size).toBe(3);
    expect(uids).not.toContain('ext:1');
    expect(uids.filter((u) => u === 'dup')).toHaveLength(1);
  });

  it('carries a selected repeat over to its one-off when dragged out', () => {
    weekly();
    const occ = occurrences()[1]!;
    selection.uids = new Set([occ.uid]);
    rescheduleLocalEvents([occ.uid], { kind: 'shift', days: 1, minutes: 0 }, 'Europe/Athens');
    const [only] = [...selection.uids];
    expect(only).not.toBe(occ.uid);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]!.some((e) => e.uid === only && !e.rrule)).toBe(true);
  });

  it('reports the new uid of a repeat moved out of its series', () => {
    weekly();
    const occ = occurrences()[1]!;
    const renames: [string, string][] = [];
    rescheduleLocalEvents([occ.uid], { kind: 'shift', days: 1, minutes: 0 }, 'Europe/Athens', (from, to) => renames.push([from, to]));
    expect(renames).toHaveLength(1);
    expect(renames[0]![0]).toBe(occ.uid);
    expect(displayEventsFor(SCRATCHPAD_FEED_ID).some((e) => e.uid === renames[0]![1])).toBe(true);
  });

  it('edits, moves and copies the whole series from any occurrence', () => {
    const s = weekly();
    const occ = occurrences()[1]!;
    updateScratchpadEvent(occ.uid, {
      title: 'Daily standup', start: s.start, end: s.end, allDay: false, rrule: 'FREQ=DAILY;COUNT=2', tzid: 'Europe/Athens',
    });
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toHaveLength(1);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]![0]).toMatchObject({ uid: s.uid, title: 'Daily standup', rrule: 'FREQ=DAILY;COUNT=2', sequence: 1 });

    const lane = createImportedLane('Work', []);
    const copies = copyEventsToLane([occurrences()[0]!.uid], lane.id);
    expect(copies).toHaveLength(1);
    expect(events.byFeed[lane.id]![0]!.rrule).toBe('FREQ=DAILY;COUNT=2');

    moveEventsToLane(occurrences().map((o) => o.uid), lane.id);
    expect(events.byFeed[SCRATCHPAD_FEED_ID]).toHaveLength(0);
    expect(events.byFeed[lane.id]).toHaveLength(2);
  });
});
