import { describe, it, expect } from 'vitest';
import { swatchHatch, forEachBlockedDay, type BlockedDay } from './blocking';
import type { CalendarFeed, DisplayEvent } from './types';

describe('swatchHatch', () => {
  it('is none unless blocking is global/local', () => {
    expect(swatchHatch('none', 'bold')).toBe('none');
    expect(swatchHatch('off', 'bold')).toBe('none');
  });

  it('encodes the block scope: global → thick, local → thin (regardless of style)', () => {
    expect(swatchHatch('global', undefined)).toBe('thick');
    expect(swatchHatch('global', 'none')).toBe('thick');
    expect(swatchHatch('global', 'bold')).toBe('thick');
    expect(swatchHatch('global', 'dashed')).toBe('thick');
    expect(swatchHatch('local', undefined)).toBe('thin');
    expect(swatchHatch('local', 'bold')).toBe('thin');
    expect(swatchHatch('local', 'muted')).toBe('thin');
  });

  it('never hatches for struck/hidden styles, even when blocking is on', () => {
    expect(swatchHatch('global', 'striked')).toBe('none');
    expect(swatchHatch('global', 'hidden')).toBe('none');
    expect(swatchHatch('local', 'striked')).toBe('none');
    expect(swatchHatch('local', 'hidden')).toBe('none');
  });
});

describe('forEachBlockedDay', () => {
  const feed = (id: string, extra: Partial<CalendarFeed> = {}): CalendarFeed => ({
    id, name: id, source: { kind: 'user', url: 'https://x.test/' + id }, collapsed: false, order: 0,
    kind: 'events', category: 'events', ...extra,
  });
  const ev = (uid: string, start: string, end: string, extra: Partial<DisplayEvent> = {}): DisplayEvent => ({
    uid, feedId: 'f', title: uid, description: '', descriptionSnippet: '', location: '',
    start: new Date(start), end: new Date(end), allDay: true,
    displayTitle: uid, displayDescription: '', displayDescriptionSnippet: '', displayLocation: '',
    styleVariant: 'none', ...extra,
  } as DisplayEvent);

  function collect(feeds: CalendarFeed[], byFeed: Record<string, DisplayEvent[]>): BlockedDay[] {
    const out: BlockedDay[] = [];
    forEachBlockedDay(feeds, (id) => byFeed[id] ?? [], (d) => out.push(d));
    return out;
  }

  it('visits every day of a blocking event with its density and scope', () => {
    const days = collect([feed('hol', { block: 'global' })], {
      hol: [ev('easter', '2026-04-12T00:00:00Z', '2026-04-14T00:00:00Z')],
    });
    expect(days).toEqual([
      { feedId: 'hol', dayKey: '2026-4-12', density: 'thick', global: true },
      { feedId: 'hol', dayKey: '2026-4-13', density: 'thick', global: true },
    ]);
  });

  it('skips hidden feeds, unblocked events and struck styles; dashed is thin', () => {
    const days = collect(
      [feed('hidden', { block: 'global', hidden: true }), feed('plain'), feed('loc', { block: 'local' })],
      {
        hidden: [ev('h', '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z')],
        plain: [ev('p', '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z')],
        loc: [
          ev('struck', '2026-04-03T00:00:00Z', '2026-04-04T00:00:00Z', { styleVariant: 'striked' }),
          ev('tentative', '2026-04-05T00:00:00Z', '2026-04-06T00:00:00Z', { styleVariant: 'dashed' }),
        ],
      },
    );
    expect(days).toEqual([{ feedId: 'loc', dayKey: '2026-4-5', density: 'thin', global: false }]);
  });
});
