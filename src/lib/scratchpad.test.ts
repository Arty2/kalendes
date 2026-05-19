import { describe, it, expect, beforeEach } from 'vitest';
import { loadScratchpad, saveScratchpad, makeScratchpadEvent, SCRATCHPAD_KEY } from './scratchpad';
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
