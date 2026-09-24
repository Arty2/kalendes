// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadScratchpad, saveScratchpad, makeScratchpadEvent, reviseEvent, eventsToIcs, SCRATCHPAD_KEY } from './scratchpad';
import { SCRATCHPAD_FEED_ID } from './types';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('scratchpad storage', () => {
  it('returns empty array when nothing is stored', () => {
    expect(loadScratchpad()).toEqual([]);
  });

  it('returns empty array for corrupt JSON', () => {
    localStorage.setItem(SCRATCHPAD_KEY, '{not json');
    expect(loadScratchpad()).toEqual([]);
  });

  it('round-trips events with Date revival', () => {
    const start = new Date('2026-03-15T09:00:00.000Z');
    const end = new Date('2026-03-15T10:00:00.000Z');
    const ev = makeScratchpadEvent({
      title: 'Sync',
      start,
      end,
      allDay: false,
      location: 'Online',
      description: 'Notes here',
    });
    saveScratchpad([ev]);
    const loaded = loadScratchpad();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.title).toBe('Sync');
    expect(loaded[0]!.feedId).toBe(SCRATCHPAD_FEED_ID);
    expect(loaded[0]!.start.toISOString()).toBe(start.toISOString());
    expect(loaded[0]!.end.toISOString()).toBe(end.toISOString());
    expect(loaded[0]!.allDay).toBe(false);
    expect(loaded[0]!.location).toBe('Online');
    expect(loaded[0]!.description).toBe('Notes here');
  });

  it('generates unique uids prefixed with scratch:', () => {
    const a = makeScratchpadEvent({
      title: 'A',
      start: new Date(),
      end: new Date(),
      allDay: true,
    });
    const b = makeScratchpadEvent({
      title: 'B',
      start: new Date(),
      end: new Date(),
      allDay: true,
    });
    expect(a.uid).not.toBe(b.uid);
    expect(a.uid.startsWith('scratch:')).toBe(true);
    expect(b.uid.startsWith('scratch:')).toBe(true);
  });

  it('derives a description snippet from the description', () => {
    const ev = makeScratchpadEvent({
      title: 'X',
      start: new Date(),
      end: new Date(),
      allDay: true,
      description: 'First line\nSecond line',
    });
    expect(ev.descriptionSnippet).toBe('First line');
  });

  it('round-trips the category field', () => {
    const ev = makeScratchpadEvent({
      title: 'C',
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-04-02T00:00:00Z'),
      allDay: true,
      category: 'guests',
    });
    expect(ev.category).toBe('guests');
    saveScratchpad([ev]);
    const loaded = loadScratchpad();
    expect(loaded[0]!.category).toBe('guests');
  });

  it("doesn't persist a 'none' category", () => {
    const ev = makeScratchpadEvent({
      title: 'C',
      start: new Date(),
      end: new Date(),
      allDay: true,
      category: 'none',
    });
    expect(ev.category).toBeUndefined();
  });
});

// The exported UID / SEQUENCE / LAST-MODIFIED are what let another calendar app
// treat a re-exported lane as an update rather than a second copy.
describe('iCal revision (UID / SEQUENCE / LAST-MODIFIED)', () => {
  const base = () =>
    makeScratchpadEvent({
      title: 'Standup',
      start: new Date('2026-05-04T07:00:00Z'),
      end: new Date('2026-05-04T07:15:00Z'),
      allDay: false,
    });
  const icsLines = (text: string, key: string): string[] =>
    text.split('\r\n').filter((l) => l.startsWith(key + ':'));

  it('keeps the uid through save/load and across repeated exports', () => {
    const ev = base();
    saveScratchpad([ev]);
    const [loaded] = loadScratchpad();
    expect(loaded!.uid).toBe(ev.uid);
    saveScratchpad([loaded!]);
    expect(loadScratchpad()[0]!.uid).toBe(ev.uid);
    expect(icsLines(eventsToIcs([loaded!]), 'UID')).toEqual(['UID:' + ev.uid]);
    expect(icsLines(eventsToIcs(loadScratchpad()), 'UID')).toEqual(['UID:' + ev.uid]);
  });

  it('assigns a missing uid once and persists it, instead of a new one per load', () => {
    localStorage.setItem(SCRATCHPAD_KEY, JSON.stringify([
      { title: 'Old', start: '2026-05-04T07:00:00Z', end: '2026-05-04T08:00:00Z', allDay: false },
    ]));
    const first = loadScratchpad()[0]!.uid;
    expect(first).toMatch(/^scratch:/);
    expect(loadScratchpad()[0]!.uid).toBe(first);
    expect(JSON.parse(localStorage.getItem(SCRATCHPAD_KEY)!)[0].uid).toBe(first);
  });

  it('reads lanes saved before revisions existed as sequence 0', () => {
    localStorage.setItem(SCRATCHPAD_KEY, JSON.stringify([
      { uid: 'scratch:a', title: 'Old', start: '2026-05-04T07:00:00Z', end: '2026-05-04T08:00:00Z', allDay: false },
    ]));
    const [ev] = loadScratchpad();
    expect(ev!.sequence).toBeUndefined();
    expect(ev!.lastModified).toBeUndefined();
    const ics = eventsToIcs([ev!]);
    expect(icsLines(ics, 'SEQUENCE')).toEqual(['SEQUENCE:0']);
    expect(icsLines(ics, 'LAST-MODIFIED')).toEqual([]);
  });

  it('bumps SEQUENCE and LAST-MODIFIED on an edit, keeping the uid', () => {
    const ev = base();
    const t1 = new Date('2026-05-01T10:00:00Z');
    const t2 = new Date('2026-05-02T11:30:00Z');
    const once = reviseEvent(ev, { ...base(), title: 'Standup (moved)' }, t1);
    expect(once.uid).toBe(ev.uid);
    expect(once.sequence).toBe(1);
    expect(once.lastModified).toEqual(t1);
    const twice = reviseEvent(once, { ...once, start: new Date('2026-05-05T07:00:00Z') }, t2);
    expect(twice.uid).toBe(ev.uid);
    expect(twice.sequence).toBe(2);
    const ics = eventsToIcs([twice]);
    expect(icsLines(ics, 'SEQUENCE')).toEqual(['SEQUENCE:2']);
    expect(icsLines(ics, 'LAST-MODIFIED')).toEqual(['LAST-MODIFIED:20260502T113000Z']);
  });

  it('keeps the revision when a save changed nothing', () => {
    const edited = reviseEvent(base(), { ...base(), title: 'X' }, new Date('2026-05-01T10:00:00Z'));
    const resaved = reviseEvent(edited, { ...edited, uid: 'ignored' }, new Date('2026-06-01T00:00:00Z'));
    expect(resaved.uid).toBe(edited.uid);
    expect(resaved.sequence).toBe(1);
    expect(resaved.lastModified).toEqual(new Date('2026-05-01T10:00:00Z'));
  });

  it('persists the revision', () => {
    const edited = reviseEvent(base(), { ...base(), title: 'X' }, new Date('2026-05-01T10:00:00Z'));
    saveScratchpad([edited]);
    const [back] = loadScratchpad();
    expect(back!.sequence).toBe(1);
    expect(back!.lastModified).toEqual(new Date('2026-05-01T10:00:00Z'));
  });
});
