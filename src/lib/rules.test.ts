import { describe, it, expect } from 'vitest';
import { applyRules, decorate, makeRule } from './rules';
import type { ParsedEvent } from './types';

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
      makeRule({ find: 'Christmas', replace: 'Christmas', style: 'highlight' }),
      makeRule({ find: 'Greek ', replace: '', style: 'muted' }),
    ];
    const [out] = applyRules([ev({ title: 'Greek Christmas' })], r);
    expect(out!.styleVariant).toBe('highlight');
    expect(out!.displayTitle).toBe('Christmas');
  });

  it.each([
    ['inverted-dashed' as const],
    ['inverted-strike' as const],
    ['hidden' as const],
    ['muted' as const],
    ['highlight' as const],
  ])('honors %s style', (style) => {
    const r = [makeRule({ find: 'Christmas', replace: 'Christmas', style })];
    const out = decorate(ev({ title: 'Greek Christmas' }), r);
    expect(out.styleVariant).toBe(style);
    if (style === 'hidden') expect(out.hidden).toBe(true);
  });

  it('non-matching rule does not change anything', () => {
    const r = [makeRule({ find: 'Diwali', replace: 'X', style: 'highlight' })];
    const [out] = applyRules([ev({ title: 'Greek Christmas' })], r);
    expect(out!.displayTitle).toBe('Greek Christmas');
    expect(out!.styleVariant).toBe('none');
  });

  it('empty find string is a no-op rule', () => {
    const r = [makeRule({ find: '', replace: 'X', style: 'highlight' })];
    const [out] = applyRules([ev({ title: 'Greek Christmas' })], r);
    expect(out!.displayTitle).toBe('Greek Christmas');
    expect(out!.styleVariant).toBe('none');
  });

  it('updates description snippet from the modified description', () => {
    const r = [makeRule({ find: 'Description', replace: 'Note' })];
    const out = decorate(ev({ description: 'Description line one\nMore' }), r);
    expect(out.displayDescriptionSnippet).toBe('Note line one');
  });
});
