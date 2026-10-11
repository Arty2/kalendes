// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { config, events, search, setTempMarkerRange, clearTempMarker } from './state.svelte';
import { getMatches, getMatchCountByFeed, getJumpDateMs } from './search-state.svelte';
import { loadFuse } from './search';
import type { CalendarFeed, ParsedEvent } from './types';

const feed = (id: string, name: string, extra: Partial<CalendarFeed> = {}): CalendarFeed => ({
  id, name, source: { kind: 'user', url: 'https://x.test/' + id }, collapsed: false, order: 0,
  kind: 'events', category: 'events', ...extra,
});
const ev = (uid: string, feedId: string, title: string, startIso: string): ParsedEvent => ({
  uid, feedId, title, description: '', descriptionSnippet: '', location: '',
  start: new Date(startIso), end: new Date(new Date(startIso).getTime() + 3_600_000), allDay: false,
});

const year = new Date().getUTCFullYear() + 1;

beforeEach(async () => {
  await loadFuse();
  config.rules = [];
  config.feeds = [feed('work', 'Work'), feed('home', 'Home', { collapsed: true }), feed('gone', 'Gone', { hidden: true })];
  for (const k of Object.keys(events.byFeed)) delete events.byFeed[k];
  events.byFeed.work = [ev('w1', 'work', 'Dentist', `${year}-03-02T09:00:00Z`), ev('w2', 'work', 'Review', `${year}-03-10T09:00:00Z`)];
  events.byFeed.home = [ev('h1', 'home', 'Dentist', `${year}-03-05T09:00:00Z`)];
  events.byFeed.gone = [ev('g1', 'gone', 'Dentist', `${year}-03-06T09:00:00Z`)];
  clearTempMarker();
  search.includesPast = false;
  search.query = '';
});

const uids = () => getMatches().map((m) => m.event.uid);

describe('search state', () => {
  it('searches collapsed calendars and counts their matches, but never hidden ones', () => {
    search.query = 'dentist';
    expect(uids()).toEqual(['w1', 'h1']);
    expect(getMatchCountByFeed().get('home')).toBe(1);
  });

  it('matches on operators alone', () => {
    search.query = 'in:work';
    expect(uids()).toEqual(['w1', 'w2']);
  });

  it('limits the search to a marked span', () => {
    setTempMarkerRange(Date.UTC(year, 2, 4), Date.UTC(year, 2, 12));
    search.query = 'in:work';
    expect(uids()).toEqual(['w2']);
  });

  it('keeps the index while only the fuzzy text changes', async () => {
    const search_ = await import('./search');
    const spy = vi.spyOn(search_, 'buildIndex');
    search.query = 'den';
    getMatches();
    search.query = 'dent';
    expect(uids()).toEqual(['w1', 'h1']);
    expect(spy).toHaveBeenCalledTimes(1);
    search.query = 'dent in:work';
    expect(uids()).toEqual(['w1']);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('reads a date-only query as a jump target', () => {
    search.query = `${year}-03`;
    expect(getJumpDateMs()).toBe(Date.UTC(year, 2, 1));
    search.query = 'dentist';
    expect(getJumpDateMs()).toBeNull();
  });
});
