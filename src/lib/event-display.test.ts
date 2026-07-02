import { describe, it, expect } from 'vitest';
import { dedupeDisplayEvents, linkifyText, formatEventDateInfo } from './event-display';
import type { DisplayEvent } from './types';

function ev(uid: string, title: string, startIso: string, endIso: string): DisplayEvent {
  return {
    uid,
    feedId: 'f',
    title,
    description: '',
    descriptionSnippet: '',
    location: '',
    start: new Date(startIso),
    end: new Date(endIso),
    allDay: false,
    displayTitle: title,
    displayDescription: '',
    displayDescriptionSnippet: '',
    displayLocation: '',
    styleVariant: 'none',
    hidden: false,
    ruleCategory: null,
    ruleColor: null,
    ruleBlock: null,
  };
}

describe('dedupeDisplayEvents', () => {
  it('collapses events with identical title + start + end into one with a count', () => {
    const out = dedupeDisplayEvents([
      ev('a', 'Onassis AiR', '2026-07-15T10:00:00Z', '2026-07-15T13:30:00Z'),
      ev('b', 'Onassis AiR', '2026-07-15T10:00:00Z', '2026-07-15T13:30:00Z'),
      ev('c', 'Onassis AiR', '2026-07-15T10:00:00Z', '2026-07-15T13:30:00Z'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.dupCount).toBe(3);
    expect(out[0]!.uid).toBe('a'); // first occurrence is the representative
  });

  it('keeps events with the same title but different times distinct', () => {
    const out = dedupeDisplayEvents([
      ev('a', 'Rehearsal', '2026-07-15T10:00:00Z', '2026-07-15T11:00:00Z'),
      ev('b', 'Rehearsal', '2026-07-16T10:00:00Z', '2026-07-16T11:00:00Z'),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.dupCount === 1)).toBe(true);
  });

  it('distinguishes different titles at the same time', () => {
    const out = dedupeDisplayEvents([
      ev('a', 'A', '2026-07-15T10:00:00Z', '2026-07-15T11:00:00Z'),
      ev('b', 'B', '2026-07-15T10:00:00Z', '2026-07-15T11:00:00Z'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('does not mutate the input events', () => {
    const a = ev('a', 'X', '2026-07-15T10:00:00Z', '2026-07-15T11:00:00Z');
    const b = ev('b', 'X', '2026-07-15T10:00:00Z', '2026-07-15T11:00:00Z');
    dedupeDisplayEvents([a, b]);
    expect(a.dupCount).toBeUndefined();
    expect(b.dupCount).toBeUndefined();
  });
});

describe('linkifyText', () => {
  it('wraps bare URLs in anchors and escapes surrounding text', () => {
    const html = linkifyText('see https://example.com/x?a=1 & <b>');
    expect(html).toContain('<a href="https://example.com/x?a=1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('&amp; &lt;b&gt;');
  });

  it('strips trailing punctuation from the linked URL', () => {
    const html = linkifyText('go to https://example.com.');
    expect(html).toContain('href="https://example.com"');
    // the trailing dot stays as text, outside the anchor
    expect(html).toMatch(/<\/a>\./);
  });
});

describe('formatEventDateInfo', () => {
  it('reports an hour/minute duration for a timed event', () => {
    const info = formatEventDateInfo(
      ev('a', 'x', '2026-07-15T10:00:00Z', '2026-07-15T13:30:00Z'),
      'YYYY-MM-DD',
      'en',
      '24h',
      'UTC',
    );
    expect(info.duration).toBe('3h 30m');
    expect(info.time).toContain('—');
  });

  it('reports a day count for a multi-day all-day event and no time', () => {
    const info = formatEventDateInfo(
      { start: new Date('2026-07-15T00:00:00Z'), end: new Date('2026-07-18T00:00:00Z'), allDay: true },
      'YYYY-MM-DD',
      'en',
      '24h',
      'UTC',
    );
    expect(info.time).toBe('');
    expect(info.duration).toBe('3 days');
  });
});
