import { describe, it, expect } from 'vitest';
import { applyRules, decorate, makeRule, matchingRulesFor } from './rules';
import { effectiveStyle } from './blocking';
import type { CalendarFeed, ParsedEvent } from './types';

function ev(partial: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    uid: 'u',
    feedId: 'f',
    title: 'Greek Christmas',
    description: 'Description text',
    descriptionSnippet: 'Description text',
    location: 'Athens',
    start: new Date('2026-12-25T00:00:00Z'),
    end: new Date('2026-12-26T00:00:00Z'),
    allDay: true,
    ...partial,
  };
}

describe('applyRules', () => {
  it('replaces in title, description, and location', () => {
    const r = [makeRule({ find: 'Greek ', replace: '' })];
    const [out] = applyRules([ev({ title: 'Greek Christmas', description: 'Greek note', location: 'Greek Athens' })], r);
    expect(out!.displayTitle).toBe('Christmas');
    expect(out!.displayDescription).toBe('note');
    expect(out!.displayLocation).toBe('Athens');
  });

  it('leaves originals untouched', () => {
    const e = ev({ title: 'Greek Christmas' });
    const r = [makeRule({ find: 'Greek ', replace: '' })];
    const [out] = applyRules([e], r);
    expect(out!.title).toBe('Greek Christmas');
    expect(out!.displayTitle).toBe('Christmas');
  });

  it('first matching rule sets the style; later rules still apply replacements', () => {
    const r = [
      makeRule({ find: 'Christmas', replace: 'Christmas', style: 'bold' }),
      makeRule({ find: 'Greek ', replace: '', style: 'muted' }),
    ];
    const [out] = applyRules([ev({ title: 'Greek Christmas' })], r);
    expect(out!.styleVariant).toBe('bold');
    expect(out!.displayTitle).toBe('Christmas');
  });

  it.each([
    ['outline' as const],
    ['bold' as const],
    ['inverted' as const],
    ['dashed' as const],
    ['hidden' as const],
    ['muted' as const],
    ['striked' as const],
  ])('honors %s style', (style) => {
    const r = [makeRule({ find: 'Christmas', replace: 'Christmas', style })];
    const out = decorate(ev({ title: 'Greek Christmas' }), r);
    expect(out.styleVariant).toBe(style);
    if (style === 'hidden') expect(out.hidden).toBe(true);
  });

  it("a rule's Outline style overrides the calendar's style (effectiveStyle)", () => {
    const feed = { style: 'inverted' } as CalendarFeed;
    // No rule / plain 'none' inherits the calendar's Solid style…
    expect(effectiveStyle(decorate(ev({ title: 'Greek Christmas' }), []), feed)).toBe('inverted');
    // …but an Outline filter forces the default look, overriding it.
    const r = [makeRule({ find: 'Christmas', replace: 'Christmas', style: 'outline' })];
    expect(effectiveStyle(decorate(ev({ title: 'Greek Christmas' }), r), feed)).toBe('outline');
  });

  it('non-matching rule does not change anything', () => {
    const r = [makeRule({ find: 'Diwali', replace: 'X', style: 'bold' })];
    const [out] = applyRules([ev({ title: 'Greek Christmas' })], r);
    expect(out!.displayTitle).toBe('Greek Christmas');
    expect(out!.styleVariant).toBe('none');
  });

  it('empty find string is a no-op rule', () => {
    const r = [makeRule({ find: '', replace: 'X', style: 'bold' })];
    const [out] = applyRules([ev({ title: 'Greek Christmas' })], r);
    expect(out!.displayTitle).toBe('Greek Christmas');
    expect(out!.styleVariant).toBe('none');
  });

  it('updates description snippet from the modified description', () => {
    const r = [makeRule({ find: 'Description', replace: 'Note' })];
    const out = decorate(ev({ description: 'Description line one\nMore' }), r);
    expect(out.displayDescriptionSnippet).toBe('Note line one');
  });

  it('carries color and block from the first matching rule', () => {
    const r = [makeRule({ find: 'Christmas', replace: 'Christmas', color: 'teal', block: 'global' })];
    const out = decorate(ev({ title: 'Greek Christmas' }), r);
    expect(out.ruleColor).toBe('teal');
    expect(out.ruleBlock).toBe('global');
  });

  it('a non-matching or color/block-less rule leaves them null', () => {
    const r = [makeRule({ find: 'Diwali', replace: 'X', color: 'teal', block: 'local' })];
    const out = decorate(ev({ title: 'Greek Christmas' }), r);
    expect(out.ruleColor).toBeNull();
    expect(out.ruleBlock).toBeNull();
  });

  it("treats a rule's block of 'none' as unset", () => {
    const r = [makeRule({ find: 'Christmas', replace: 'Christmas', block: 'none' })];
    const out = decorate(ev({ title: 'Greek Christmas' }), r);
    expect(out.ruleBlock).toBeNull();
  });

  it('first matching color/block wins over a later rule', () => {
    const r = [
      makeRule({ find: 'Greek ', replace: '', color: 'mint', block: 'local' }),
      makeRule({ find: 'Christmas', replace: 'Christmas', color: 'teal', block: 'global' }),
    ];
    const out = decorate(ev({ title: 'Greek Christmas' }), r);
    expect(out.ruleColor).toBe('mint');
    expect(out.ruleBlock).toBe('local');
  });

  it("captures a rule's 'off' (No block) override", () => {
    const r = [makeRule({ find: 'Christmas', replace: 'Christmas', block: 'off' })];
    const out = decorate(ev({ title: 'Greek Christmas' }), r);
    expect(out.ruleBlock).toBe('off');
  });
});

describe('match position', () => {
  it("'any' (default) replaces anywhere but ignores an empty Find", () => {
    const out = decorate(ev({ title: 'Greek Christmas' }), [makeRule({ find: 'Christ', replace: 'X' })]);
    expect(out.displayTitle).toBe('Greek Xmas');
    const noop = decorate(ev({ title: 'Greek Christmas' }), [makeRule({ find: '', replace: 'X', position: 'any' })]);
    expect(noop.displayTitle).toBe('Greek Christmas');
  });

  it("'start' only matches/replaces a leading occurrence", () => {
    const hit = decorate(ev({ title: 'Greek Christmas' }), [makeRule({ find: 'Greek ', replace: '', position: 'start' })]);
    expect(hit.displayTitle).toBe('Christmas');
    // 'Greek' is not at the start here, so it is left alone.
    const miss = decorate(ev({ title: 'A Greek Feast' }), [makeRule({ find: 'Greek', replace: 'X', position: 'start' })]);
    expect(miss.displayTitle).toBe('A Greek Feast');
  });

  it("'end' only matches/replaces a trailing occurrence", () => {
    const hit = decorate(ev({ title: 'Christmas Eve' }), [makeRule({ find: ' Eve', replace: '', position: 'end' })]);
    expect(hit.displayTitle).toBe('Christmas');
    const miss = decorate(ev({ title: 'Eve Party' }), [makeRule({ find: 'Eve', replace: 'X', position: 'end' })]);
    expect(miss.displayTitle).toBe('Eve Party');
  });

  it('an empty Find inserts text at the start / end of the title only', () => {
    const start = decorate(
      ev({ title: 'Christmas', description: 'desc', location: 'loc' }),
      [makeRule({ find: '', replace: '🎉 ', position: 'start' })],
    );
    expect(start.displayTitle).toBe('🎉 Christmas');
    // Description and location are left untouched by an empty-Find insert.
    expect(start.displayDescription).toBe('desc');
    expect(start.displayLocation).toBe('loc');
    const end = decorate(ev({ title: 'Christmas' }), [makeRule({ find: '', replace: ' 🎉', position: 'end' })]);
    expect(end.displayTitle).toBe('Christmas 🎉');
  });

  it('an empty-Find start/end rule still matches via matchingRulesFor', () => {
    const rule = makeRule({ find: '', replace: '🎉 ', position: 'start' });
    expect(matchingRulesFor(ev({ title: 'Anything' }), [rule])).toHaveLength(1);
    // …but an empty-Find 'any' rule never matches.
    const any = makeRule({ find: '', replace: 'X', position: 'any' });
    expect(matchingRulesFor(ev({ title: 'Anything' }), [any])).toHaveLength(0);
  });
});
