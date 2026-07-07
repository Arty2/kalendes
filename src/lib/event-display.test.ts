import { describe, it, expect } from 'vitest';
import {
  dedupeDisplayEvents,
  linkifyText,
  formatEventDateInfo,
  formatEventTimeLabel,
  mergeConsecutiveDays,
} from './event-display';
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

function allDayEv(uid: string, title: string, startIso: string, endIso: string): DisplayEvent {
  return { ...ev(uid, title, startIso, endIso), allDay: true };
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

describe('mergeConsecutiveDays', () => {
  it('collapses a run of consecutive same-title/same-time days into one bar', () => {
    const out = mergeConsecutiveDays(
      [
        ev('a', 'Rehearsal', '2026-07-15T10:00:00Z', '2026-07-15T20:00:00Z'),
        ev('b', 'Rehearsal', '2026-07-16T10:00:00Z', '2026-07-16T20:00:00Z'),
        ev('c', 'Rehearsal', '2026-07-17T10:00:00Z', '2026-07-17T20:00:00Z'),
        ev('d', 'Rehearsal', '2026-07-18T10:00:00Z', '2026-07-18T20:00:00Z'),
      ],
      'UTC',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.spanDays).toBe(4);
    expect(out[0]!.uid).toBe('a'); // anchored on the first day
    expect(out[0]!.start.toISOString()).toBe('2026-07-15T10:00:00.000Z');
    expect(out[0]!.end.toISOString()).toBe('2026-07-18T20:00:00.000Z'); // extended to the last day
  });

  it('splits the run when a day is missing', () => {
    const out = mergeConsecutiveDays(
      [
        ev('a', 'Rehearsal', '2026-07-15T10:00:00Z', '2026-07-15T20:00:00Z'),
        ev('b', 'Rehearsal', '2026-07-16T10:00:00Z', '2026-07-16T20:00:00Z'),
        // gap on the 17th
        ev('c', 'Rehearsal', '2026-07-18T10:00:00Z', '2026-07-18T20:00:00Z'),
        ev('d', 'Rehearsal', '2026-07-19T10:00:00Z', '2026-07-19T20:00:00Z'),
      ],
      'UTC',
    );
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.spanDays)).toEqual([2, 2]);
    expect(out[0]!.uid).toBe('a');
    expect(out[1]!.uid).toBe('c');
  });

  it('merges within ±1 hour of the anchor but not beyond', () => {
    const within = mergeConsecutiveDays(
      [
        ev('a', 'Rehearsal', '2026-07-15T10:00:00Z', '2026-07-15T13:00:00Z'),
        ev('b', 'Rehearsal', '2026-07-16T11:00:00Z', '2026-07-16T14:00:00Z'),
      ],
      'UTC',
    );
    expect(within).toHaveLength(1);
    expect(within[0]!.spanDays).toBe(2);

    const beyond = mergeConsecutiveDays(
      [
        ev('a', 'Rehearsal', '2026-07-15T10:00:00Z', '2026-07-15T13:00:00Z'),
        ev('b', 'Rehearsal', '2026-07-16T11:01:00Z', '2026-07-16T14:01:00Z'),
      ],
      'UTC',
    );
    expect(beyond).toHaveLength(2);
    expect(beyond.every((e) => e.spanDays === undefined)).toBe(true);
  });

  it('keeps two same-title series at different times of day separate', () => {
    const out = mergeConsecutiveDays(
      [
        ev('a1', 'Workshop', '2026-07-15T10:00:00Z', '2026-07-15T12:00:00Z'),
        ev('b1', 'Workshop', '2026-07-15T17:00:00Z', '2026-07-15T19:00:00Z'),
        ev('a2', 'Workshop', '2026-07-16T10:00:00Z', '2026-07-16T12:00:00Z'),
        ev('b2', 'Workshop', '2026-07-16T17:00:00Z', '2026-07-16T19:00:00Z'),
        ev('a3', 'Workshop', '2026-07-17T10:00:00Z', '2026-07-17T12:00:00Z'),
        ev('b3', 'Workshop', '2026-07-17T17:00:00Z', '2026-07-17T19:00:00Z'),
      ],
      'UTC',
    );
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.spanDays === 3)).toBe(true);
    expect(out.map((e) => e.uid).sort()).toEqual(['a1', 'b1']);
  });

  it('merges consecutive all-day repeats by title alone', () => {
    const out = mergeConsecutiveDays(
      [
        allDayEv('a', 'Fair', '2026-07-15T00:00:00Z', '2026-07-16T00:00:00Z'),
        allDayEv('b', 'Fair', '2026-07-16T00:00:00Z', '2026-07-17T00:00:00Z'),
        allDayEv('c', 'Fair', '2026-07-17T00:00:00Z', '2026-07-18T00:00:00Z'),
      ],
      'UTC',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.spanDays).toBe(3);
    expect(out[0]!.end.toISOString()).toBe('2026-07-18T00:00:00.000Z');
  });

  it('returns a start-sorted result regardless of input order', () => {
    // Focus/keyboard-nav indexing relies on this: the lane layout and every
    // nav list merge the same events and must agree on their order.
    const shuffled = [
      ev('c', 'Standup', '2026-07-17T09:00:00Z', '2026-07-17T09:15:00Z'),
      ev('a', 'Rehearsal', '2026-07-15T10:00:00Z', '2026-07-15T20:00:00Z'),
      ev('b', 'Rehearsal', '2026-07-16T10:00:00Z', '2026-07-16T20:00:00Z'),
    ];
    const out = mergeConsecutiveDays(shuffled, 'UTC');
    expect(out.map((e) => e.uid)).toEqual(['a', 'c']); // merged run 'a' (15-16), then 'c' (17)
    expect(out[0]!.spanDays).toBe(2);
  });

  it('exposes a start/end time range when merged members differ on both sides', () => {
    const out = mergeConsecutiveDays(
      [
        ev('a', 'R', '2026-07-15T10:00:00Z', '2026-07-15T16:00:00Z'),
        ev('b', 'R', '2026-07-16T10:00:00Z', '2026-07-16T15:00:00Z'),
        ev('c', 'R', '2026-07-17T10:30:00Z', '2026-07-17T16:00:00Z'),
      ],
      'UTC',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.spanDays).toBe(3);
    expect(formatEventTimeLabel(out[0]!, '24h', 'UTC')).toBe('10:00/10:30 — 15:00/16:00');
  });

  it('slashes only the side that varies', () => {
    const out = mergeConsecutiveDays(
      [
        ev('a', 'R', '2026-07-15T10:00:00Z', '2026-07-15T16:00:00Z'),
        ev('b', 'R', '2026-07-16T10:00:00Z', '2026-07-16T15:00:00Z'),
      ],
      'UTC',
    );
    expect(out[0]!.spanStartRange).toBeUndefined(); // starts identical
    expect(formatEventTimeLabel(out[0]!, '24h', 'UTC')).toBe('10:00 — 15:00/16:00');
  });

  it('leaves lone events untouched and never mutates the input', () => {
    const a = ev('a', 'Rehearsal', '2026-07-15T10:00:00Z', '2026-07-15T20:00:00Z');
    const b = ev('b', 'Standup', '2026-07-16T09:00:00Z', '2026-07-16T09:15:00Z');
    const out = mergeConsecutiveDays([a, b], 'UTC');
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.spanDays === undefined)).toBe(true);
    expect(a.spanDays).toBeUndefined();
    expect(a.end.toISOString()).toBe('2026-07-15T20:00:00.000Z');
  });
});

describe('formatEventTimeLabel', () => {
  it('shows a single start — end for a normal timed event', () => {
    expect(
      formatEventTimeLabel(ev('a', 'x', '2026-07-15T10:00:00Z', '2026-07-15T20:00:00Z'), '24h', 'UTC'),
    ).toBe('10:00 — 20:00');
  });

  it('is empty for an all-day event', () => {
    expect(
      formatEventTimeLabel(allDayEv('a', 'x', '2026-07-15T00:00:00Z', '2026-07-16T00:00:00Z'), '24h', 'UTC'),
    ).toBe('');
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

  it('reports a day count (not a raw hour total) for a merged consecutive-day run', () => {
    const info = formatEventDateInfo(
      { start: new Date('2026-07-15T10:00:00Z'), end: new Date('2026-07-18T20:00:00Z'), allDay: false, spanDays: 4 },
      'YYYY-MM-DD',
      'en',
      '24h',
      'UTC',
    );
    expect(info.duration).toBe('4 days');
    expect(info.time).toContain('—'); // still shows the shared daily time
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
