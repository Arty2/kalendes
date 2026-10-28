// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  readUrlState,
  applyUrlState,
  readMarkerHash,
  writeMarkerHash,
  isLinkEntry,
  tagHistoryEntry,
} from './url';

// What applyUrlState writes to the fragment for a view (the app's one writer).
function writeUrlState(state: Parameters<typeof applyUrlState>[0]): string {
  history.replaceState(null, '', '/');
  applyUrlState(state);
  const hash = location.hash;
  history.replaceState(null, '', '/');
  return hash;
}

describe('url state codec', () => {
  // Shake is device-local: pinning it in the address bar made it survive every
  // reload and ride along in any link copied from there, which read as the
  // default. It stays out of the URL on both sides.
  it('leaves shake out of the url', () => {
    const written = writeUrlState({
      zoom: 'month',
      locale: 'en',
      dateFormat: 'YYYY-MM-DD',
      scheme: 'shake',
    });
    expect(written).not.toContain('t=');
    // The rest of the state still travels.
    expect(readUrlState(written).zoom).toBe('month');
    expect(readUrlState(written).locale).toBe('en');
    // No `t` means "leave the reader's scheme alone".
    expect(readUrlState(written).scheme).toBeNull();
  });

  it('ignores t=shake in a url that already carries it', () => {
    const read = readUrlState('', '?z=1m&loc=el&t=shake');
    expect(read.scheme).toBeNull();
    expect(read.zoom).toBe('month');
    expect(read.locale).toBe('el');
  });

  it('still writes and reads the schemes that do travel', () => {
    for (const scheme of ['auto', 'light', 'dark'] as const) {
      const written = writeUrlState({
        zoom: 'month', locale: 'en', dateFormat: 'YYYY-MM-DD', scheme,
      });
      expect(written).toContain('t=' + scheme);
      expect(readUrlState(written).scheme).toBe(scheme);
    }
  });

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
    expect(readUrlState('', '?d=iso').dateFormat).toBe('YYYY-MM-DD');
    expect(readUrlState('', '?d=long').dateFormat).toBe('DD MMM YYYY');
    expect(readUrlState('', '?d=dmy').dateFormat).toBe('DD.MM.YYYY');
    expect(readUrlState('', '?d=mdy').dateFormat).toBe('MM/DD/YYYY');
  });

  it('returns nulls when keys are missing', () => {
    const read = readUrlState('', '?other=1');
    expect(read.zoom).toBe(null);
    expect(read.locale).toBe(null);
    expect(read.dateFormat).toBe(null);
    expect(read.scheme).toBe(null);
  });

  it('rejects unknown values', () => {
    const read = readUrlState('', '?z=99x&loc=fr&d=AAA&t=neon');
    expect(read.zoom).toBe(null);
    expect(read.locale).toBe(null);
    expect(read.dateFormat).toBe(null);
    expect(read.scheme).toBe(null);
  });

  it('decodes the canonical zoom shortcuts', () => {
    expect(readUrlState('', '?z=1w').zoom).toBe('week');
    expect(readUrlState('', '?z=1m').zoom).toBe('month');
    expect(readUrlState('', '?z=3m').zoom).toBe('quarter');
    expect(readUrlState('', '?z=6m').zoom).toBe('half-year');
    expect(readUrlState('', '?z=1y').zoom).toBe('year');
    expect(readUrlState('', '?z=2y').zoom).toBe('2-year');
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

describe('view state in the fragment', () => {
  it('writes a fragment, never a query', () => {
    const written = writeUrlState({ zoom: 'month', locale: 'el', dateFormat: 'DD.MM.YYYY', scheme: 'dark' });
    expect(written).toBe('#z=1m&loc=el&df=dmy&t=dark');
  });

  it('prefers the fragment over a legacy query', () => {
    const read = readUrlState('#z=1y&df=iso', '?z=1m&d=mdy&loc=el');
    expect(read.zoom).toBe('year');
    expect(read.dateFormat).toBe('YYYY-MM-DD');
    expect(read.locale).toBe('el');
  });

  it('does not read the marker key as a date format', () => {
    expect(readUrlState('#d=2026-05-28', '').dateFormat).toBeNull();
  });

  it('moves a legacy query into the fragment and keeps the marker', () => {
    history.replaceState(null, '', '/?z=1m&loc=en&d=iso&t=dark#d=2026-05-28');
    applyUrlState({ zoom: 'quarter', locale: 'en', dateFormat: 'YYYY-MM-DD', scheme: 'dark' });
    expect(location.search).toBe('');
    expect(location.hash).toBe('#d=2026-05-28&z=3m&loc=en&df=iso&t=dark');
    // The marker writes leave the view keys alone.
    writeMarkerHash(Date.UTC(2026, 5, 1));
    expect(location.hash).toBe('#d=2026-06-01&z=3m&loc=en&df=iso&t=dark');
    writeMarkerHash(null);
    expect(location.hash).toBe('#z=3m&loc=en&df=iso&t=dark');
    history.replaceState(null, '', '/');
  });

  it('keeps unrelated query params', () => {
    history.replaceState(null, '', '/?utm=x&z=1m');
    applyUrlState({ zoom: 'month', locale: 'en', dateFormat: 'YYYY-MM-DD', scheme: 'light' });
    expect(location.search).toBe('?utm=x');
    history.replaceState(null, '', '/');
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

// Settings tags its history entry { settingsOpen }; a URL rewrite while it is
// open (a scheme change, a marker move) must keep that tag, or closing Settings
// leaves the entry behind and Back lands on a stale copy of the view.
describe('url rewrites keep the history entry state', () => {
  it('preserves history.state', () => {
    history.pushState({ settingsOpen: true }, '');
    applyUrlState({ zoom: 'month', locale: 'en', dateFormat: 'YYYY-MM-DD', scheme: 'dark' });
    expect(history.state).toEqual({ settingsOpen: true });
    writeMarkerHash(Date.UTC(2026, 4, 28));
    expect(history.state).toEqual({ settingsOpen: true });
  });
});

// A link pasted into a running tab gets a history entry with no state; the
// app's own entries always carry one, so Back/Forward is never read as a link.
describe('link entries', () => {
  it('tells a fresh entry from one the app has seen', () => {
    history.replaceState(null, '', '/');
    expect(isLinkEntry()).toBe(true);
    tagHistoryEntry();
    expect(isLinkEntry()).toBe(false);
    expect(history.state).toEqual({ app: true });
  });

  it('leaves an existing state alone and keeps it through URL rewrites', () => {
    history.pushState({ settingsOpen: true }, '', '/');
    tagHistoryEntry();
    writeMarkerHash(Date.UTC(2026, 4, 28));
    expect(history.state).toEqual({ settingsOpen: true });
    expect(isLinkEntry()).toBe(false);
  });
});
