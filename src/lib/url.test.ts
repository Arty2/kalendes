import { describe, it, expect } from 'vitest';
import { readUrlState, writeUrlState } from './url';

describe('url state codec', () => {
  it('round-trips all keys', () => {
    const written = writeUrlState({
      zoom: 'half-year',
      locale: 'el',
      dateFormat: 'DD.MM.YYYY',
      theme: 'dark',
    });
    const read = readUrlState(written);
    expect(read.zoom).toBe('half-year');
    expect(read.locale).toBe('el');
    expect(read.dateFormat).toBe('DD.MM.YYYY');
    expect(read.theme).toBe('dark');
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
    expect(read.theme).toBe(null);
  });

  it('rejects unknown values', () => {
    const read = readUrlState('?z=99x&loc=fr&d=AAA&t=neon');
    expect(read.zoom).toBe(null);
    expect(read.locale).toBe(null);
    expect(read.dateFormat).toBe(null);
    expect(read.theme).toBe(null);
  });

  it('decodes the canonical zoom shortcuts', () => {
    expect(readUrlState('?z=1m').zoom).toBe('month');
    expect(readUrlState('?z=3m').zoom).toBe('quarter');
    expect(readUrlState('?z=6m').zoom).toBe('half-year');
    expect(readUrlState('?z=1y').zoom).toBe('year');
    expect(readUrlState('?z=2y').zoom).toBe('2-year');
  });
});
