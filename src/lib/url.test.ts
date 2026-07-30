import { describe, it, expect } from 'vitest';
import { readUrlState, writeUrlState, readMarkerHash, writeMarkerHash } from './url';

describe('url state codec', () => {
  it('round-trips all keys', () => {
    const written = writeUrlState({
      zoom: 'half-year',
      locale: 'el',
      dateFormat: 'DD.MM.YYYY',
      scheme: 'dark',
    });
    const read = readUrlState(written);
    expect(read.zoom).toBe('half-year');
    expect(read.locale).toBe('el');
    expect(read.dateFormat).toBe('DD.MM.YYYY');
    expect(read.scheme).toBe('dark');
  });

  it('encodes the four canonical date format shortcuts', () => {
    expect(readUrlState('?d=iso').dateFormat).toBe('YYYY-MM-DD');
    expect(readUrlState('?d=long').dateFormat).toBe('DD MMM YYYY');
    expect(readUrlState('?d=dmy').dateFormat).toBe('DD.MM.YYYY');
    expect(readUrlState('?d=mdy').dateFormat).toBe('MM/DD/YYYY');
  });

  it('returns nulls when keys are missing', () => {
    const read = readUrlState('?other=1');
    expect(read.zoom).toBe(null);
    expect(read.locale).toBe(null);
    expect(read.dateFormat).toBe(null);
    expect(read.scheme).toBe(null);
  });

  it('rejects unknown values', () => {
    const read = readUrlState('?z=99x&loc=fr&d=AAA&t=neon');
    expect(read.zoom).toBe(null);
    expect(read.locale).toBe(null);
    expect(read.dateFormat).toBe(null);
    expect(read.scheme).toBe(null);
  });

  it('decodes the canonical zoom shortcuts', () => {
    expect(readUrlState('?z=1w').zoom).toBe('week');
    expect(readUrlState('?z=1m').zoom).toBe('month');
    expect(readUrlState('?z=3m').zoom).toBe('quarter');
    expect(readUrlState('?z=6m').zoom).toBe('half-year');
    expect(readUrlState('?z=1y').zoom).toBe('year');
    expect(readUrlState('?z=2y').zoom).toBe('2-year');
  });

  it('round-trips the week zoom', () => {
    const written = writeUrlState({
      zoom: 'week',
      locale: 'en',
      dateFormat: 'YYYY-MM-DD',
      scheme: 'light',
    });
    expect(readUrlState(written).zoom).toBe('week');
  });
});

describe('marker hash', () => {
  // Days are plain UTC calendar days — the suite runs in Europe/Athens, so a
  // local-time slip here would land these on the wrong date.
  it('reads a single-day marker', () => {
    expect(readMarkerHash('#d=2026-05-28')).toEqual({
      startMs: Date.UTC(2026, 4, 28),
      endMs: null,
    });
  });

  it('reads a duration marker', () => {
    expect(readMarkerHash('#d=2026-05-28..2026-06-04')).toEqual({
      startMs: Date.UTC(2026, 4, 28),
      endMs: Date.UTC(2026, 5, 4),
    });
  });

  it('accepts a single-day duration', () => {
    expect(readMarkerHash('#d=2026-05-28..2026-05-28')).toEqual({
      startMs: Date.UTC(2026, 4, 28),
      endMs: Date.UTC(2026, 4, 28),
    });
  });

  it('degrades a backwards end to a single-day marker', () => {
    expect(readMarkerHash('#d=2026-05-28..2026-05-01')).toEqual({
      startMs: Date.UTC(2026, 4, 28),
      endMs: null,
    });
  });

  it('finds the marker alongside other fragment keys', () => {
    expect(readMarkerHash('#x=1&d=2026-05-28..2026-06-04&y=2')).toEqual({
      startMs: Date.UTC(2026, 4, 28),
      endMs: Date.UTC(2026, 5, 4),
    });
  });

  it('returns null when absent or malformed', () => {
    expect(readMarkerHash('')).toBe(null);
    expect(readMarkerHash('#other=1')).toBe(null);
    expect(readMarkerHash('#d=2026-5-8')).toBe(null);
  });

  it('round-trips through the fragment', () => {
    const start = Date.UTC(2026, 4, 28);
    const end = Date.UTC(2026, 5, 4);

    writeMarkerHash(start);
    expect(location.hash).toBe('#d=2026-05-28');
    expect(readMarkerHash(location.hash)).toEqual({ startMs: start, endMs: null });

    writeMarkerHash(start, end);
    expect(location.hash).toBe('#d=2026-05-28..2026-06-04');
    expect(readMarkerHash(location.hash)).toEqual({ startMs: start, endMs: end });

    // A same-day "range" writes the short form — nothing to read back.
    writeMarkerHash(start, start);
    expect(location.hash).toBe('#d=2026-05-28');

    writeMarkerHash(null);
    expect(location.hash).toBe('');
    expect(readMarkerHash(location.hash)).toBe(null);
  });
});
