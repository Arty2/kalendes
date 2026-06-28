import { describe, it, expect } from 'vitest';
import type FuseType from 'fuse.js';
import { search, nextMatch } from './search';
import type { ParsedEvent } from './types';

function ev(uid: string, startIso: string, title = uid): ParsedEvent {
  return {
    uid,
    feedId: 'f',
    title,
    description: '',
    descriptionSnippet: '',
    location: '',
    start: new Date(startIso),
    end: new Date(startIso),
    allDay: false,
  };
}

// A minimal stand-in for a built Fuse index: `search()` only ever calls
// `.search(query)`, so we don't need to load fuse.js to exercise the pure
// filter/sort logic around it.
function stubIndex(results: { item: ParsedEvent; score?: number }[]): FuseType<ParsedEvent> {
  return { search: () => results } as unknown as FuseType<ParsedEvent>;
}

describe('search', () => {
  it('returns nothing for an empty or whitespace-only query', () => {
    const index = stubIndex([{ item: ev('a', '2026-01-01T00:00:00Z') }]);
    expect(search(index, '')).toEqual([]);
    expect(search(index, '   ')).toEqual([]);
  });

  it('sorts matches chronologically regardless of relevance order', () => {
    const index = stubIndex([
      { item: ev('late', '2026-06-01T00:00:00Z'), score: 0.1 },
      { item: ev('early', '2026-01-01T00:00:00Z'), score: 0.2 },
      { item: ev('mid', '2026-03-01T00:00:00Z'), score: 0.05 },
    ]);
    expect(search(index, 'x').map((m) => m.event.uid)).toEqual(['early', 'mid', 'late']);
  });

  it('passes the Fuse score through, defaulting a missing score to 1', () => {
    const index = stubIndex([
      { item: ev('scored', '2026-01-01T00:00:00Z'), score: 0.42 },
      { item: ev('unscored', '2026-02-01T00:00:00Z') },
    ]);
    const out = search(index, 'x');
    expect(out[0]!.score).toBe(0.42);
    expect(out[1]!.score).toBe(1);
  });
});

describe('nextMatch', () => {
  const matches = [0, 1, 2].map((i) => ({ event: ev(String(i), '2026-01-01T00:00:00Z'), score: 0 }));

  it('steps forward and wraps past the end', () => {
    expect(nextMatch(matches, 0, 1)).toBe(1);
    expect(nextMatch(matches, 2, 1)).toBe(0);
  });

  it('steps backward and wraps past the start', () => {
    expect(nextMatch(matches, 2, -1)).toBe(1);
    expect(nextMatch(matches, 0, -1)).toBe(2);
  });

  it('returns 0 when there are no matches', () => {
    expect(nextMatch([], 0, 1)).toBe(0);
    expect(nextMatch([], 5, -1)).toBe(0);
  });
});
