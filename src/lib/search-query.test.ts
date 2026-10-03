import { describe, it, expect } from 'vitest';
import { parseSearchQuery, hasOperators, queryFilter, overlapsDays } from './search-query';
import type { DisplayEvent } from './types';

const TODAY = Date.UTC(2026, 9, 3); // Saturday
const parse = (q: string) => parseSearchQuery(q, TODAY, 'dmy');
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));

function ev(extra: Partial<DisplayEvent> = {}): DisplayEvent {
  return {
    uid: 'u', feedId: 'work', title: 'Team sync', description: 'Weekly planning', descriptionSnippet: '',
    location: 'Room 4, Athens', start: new Date('2026-10-12T09:00:00Z'), end: new Date('2026-10-12T10:00:00Z'),
    allDay: false, displayTitle: 'Team sync', displayDescription: 'Weekly planning', displayDescriptionSnippet: '',
    displayLocation: 'Room 4, Athens', styleVariant: 'none', hidden: false, ruleCategory: null, ruleColor: null,
    ruleBlock: null, ...extra,
  };
}

describe('parseSearchQuery', () => {
  it('pulls operators and phrases out, leaving the fuzzy text', () => {
    const q = parse('sync in:work loc:athens "weekly planning" after:2026-10 before:fri');
    expect(q.text).toBe('sync');
    expect(q.calendars).toEqual(['work']);
    expect(q.locations).toEqual(['athens']);
    expect(q.phrases).toEqual(['weekly planning']);
    expect(iso(q.afterMs)).toBe('2026-10-01');
    expect(iso(q.beforeMs)).toBe('2026-10-09');
  });

  it('takes quoted operator values and ignores half-typed ones', () => {
    const q = parse('in:"Team Calendar" loc:');
    expect(q.calendars).toEqual(['team calendar']);
    expect(q.locations).toEqual([]);
    expect(hasOperators(parse('in:'))).toBe(false);
  });

  it('keeps an unreadable date operator as text', () => {
    const q = parse('after:someday');
    expect(q.afterMs).toBeNull();
    expect(q.text).toBe('after:someday');
  });

  it('is plain text without operators', () => {
    const q = parse('dentist');
    expect(q.text).toBe('dentist');
    expect(hasOperators(q)).toBe(false);
  });
});

describe('queryFilter', () => {
  const names: Record<string, string> = { work: 'Work calendar', home: 'Home' };
  const passes = (q: string, e = ev()) => queryFilter(parse(q), (id) => names[id] ?? '')(e);

  it('matches calendars by name (any of)', () => {
    expect(passes('in:work')).toBe(true);
    expect(passes('in:home')).toBe(false);
    expect(passes('in:home in:work')).toBe(true);
  });

  it('matches every location and phrase (all of), on shown or original text', () => {
    expect(passes('loc:athens loc:room')).toBe(true);
    expect(passes('loc:athens loc:paris')).toBe(false);
    expect(passes('"weekly planning"')).toBe(true);
    expect(passes('"planning weekly"')).toBe(false);
    expect(passes('"vacation"', ev({ title: 'OOO', displayTitle: 'Vacation' }))).toBe(true);
  });

  it('bounds by start day: after includes it, before excludes it', () => {
    expect(passes('after:12/10')).toBe(true);
    expect(passes('after:13/10')).toBe(false);
    expect(passes('before:13/10')).toBe(true);
    expect(passes('before:12/10')).toBe(false);
  });
});

describe('overlapsDays', () => {
  it('counts events touching the inclusive span', () => {
    const start = Date.UTC(2026, 9, 12);
    expect(overlapsDays(ev(), start, start)).toBe(true);
    expect(overlapsDays(ev(), Date.UTC(2026, 9, 13), Date.UTC(2026, 9, 20))).toBe(false);
    expect(overlapsDays(ev(), Date.UTC(2026, 9, 5), Date.UTC(2026, 9, 11))).toBe(false);
  });
});
