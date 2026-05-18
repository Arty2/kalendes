import { describe, it, expect } from 'vitest';
import {
  encodeShareState,
  decodeShareState,
  buildShareUrl,
  SHARE_URL_LIMIT,
} from './share';
import { defaultConfig } from './storage';
import type { AppConfig, FindReplaceRule } from './types';

function configWith(over: Partial<AppConfig>): AppConfig {
  return { ...defaultConfig(), ...over };
}

describe('share encode/decode', () => {
  it('round-trips user feeds + rules', () => {
    const cfg = configWith({
      feeds: [
        { id: 'a', source: { kind: 'user', url: 'https://example.com/cal.ics' }, name: 'Work', collapsed: false, order: 0, kind: 'events', category: 'none' },
        { id: 'b', source: { kind: 'user', url: 'https://example.com/h.ics' }, name: 'Holidays', collapsed: false, order: 1, kind: 'holidays', category: 'holidays' },
      ],
      rules: [
        { id: 'r1', find: 'foo', replace: 'bar', style: 'highlight' },
        { id: 'r2', find: 'baz', replace: '', style: 'hidden' },
      ],
    });
    const payload = encodeShareState(cfg);
    const decoded = decodeShareState(payload);
    expect(decoded).not.toBeNull();
    expect(decoded!.feeds.length).toBe(2);
    expect((decoded!.feeds[0]!.source as { kind: 'user'; url: string }).url).toBe('https://example.com/cal.ics');
    expect(decoded!.feeds[0]!.name).toBe('Work');
    expect(decoded!.feeds[1]!.kind).toBe('holidays');
    expect(decoded!.rules.length).toBe(2);
    expect(decoded!.rules[0]!.style).toBe('highlight');
  });

  it('round-trips view state when zoom is provided', () => {
    const cfg = configWith({
      locale: 'el',
      dateFormat: 'DD.MM.YYYY',
      theme: 'dark',
    });
    const payload = encodeShareState(cfg, '2-year');
    const decoded = decodeShareState(payload);
    expect(decoded!.view).not.toBeNull();
    expect(decoded!.view!.zoom).toBe('2-year');
    expect(decoded!.view!.locale).toBe('el');
    expect(decoded!.view!.dateFormat).toBe('DD.MM.YYYY');
    expect(decoded!.view!.theme).toBe('dark');
  });

  it('returns view from config even without zoom', () => {
    const cfg = configWith({ locale: 'en', dateFormat: 'YYYY-MM-DD', theme: 'light' });
    const payload = encodeShareState(cfg);
    const decoded = decodeShareState(payload);
    expect(decoded!.view).not.toBeNull();
    expect(decoded!.view!.zoom).toBeUndefined();
    expect(decoded!.view!.locale).toBe('en');
  });

  it('ignores invalid view fields', () => {
    const corrupt = btoa(JSON.stringify({ f: [], r: [], v: { z: 'bogus', l: 'xx', d: 'BAD', t: 'green' } }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const decoded = decodeShareState(corrupt);
    expect(decoded!.view).toBeNull();
  });

  it('skips secret feeds (only user feeds shareable)', () => {
    const cfg = configWith({
      feeds: [
        { id: 's', source: { kind: 'secret', id: 'xx' }, name: 'Secret', collapsed: false, order: 0, kind: 'events', category: 'none' },
        { id: 'u', source: { kind: 'user', url: 'https://x.com/a.ics' }, name: 'Mine', collapsed: false, order: 1, kind: 'events', category: 'none' },
      ],
    });
    const payload = encodeShareState(cfg);
    const decoded = decodeShareState(payload);
    expect(decoded!.feeds.length).toBe(1);
    expect(decoded!.feeds[0]!.name).toBe('Mine');
  });

  it('produces a URL-safe payload with no +, /, or = characters', () => {
    const cfg = configWith({});
    const payload = encodeShareState(cfg);
    expect(payload).not.toMatch(/[+/=]/);
  });

  it('default config share URL stays well under the limit', () => {
    const url = buildShareUrl(defaultConfig(), 'month', 'https://heracl.es/calendari');
    expect(url.length).toBeLessThan(SHARE_URL_LIMIT);
  });

  it('returns null for malformed payload', () => {
    expect(decodeShareState('!!!not-base64!!!')).toBeNull();
    expect(decodeShareState('')).toBeNull();
  });

  it('returns empty arrays for an empty (but valid) payload', () => {
    const empty = encodeShareState(configWith({ feeds: [], rules: [] as FindReplaceRule[] }));
    const decoded = decodeShareState(empty);
    expect(decoded!.feeds).toEqual([]);
    expect(decoded!.rules).toEqual([]);
  });

  it('round-trips the kiosk and eink flags through the view', () => {
    const cfg = configWith({ kiosk: true, eink: true });
    const decoded = decodeShareState(encodeShareState(cfg));
    expect(decoded!.view).not.toBeNull();
    expect(decoded!.view!.kiosk).toBe(true);
    expect(decoded!.view!.eink).toBe(true);
  });

  it('omits kiosk/eink from the view when both are off (default)', () => {
    const cfg = configWith({ kiosk: false, eink: false });
    const decoded = decodeShareState(encodeShareState(cfg));
    expect(decoded!.view?.kiosk).toBeUndefined();
    expect(decoded!.view?.eink).toBeUndefined();
  });

  it('round-trips a per-feed timezone override', () => {
    const cfg = configWith({
      feeds: [
        {
          id: 'a',
          source: { kind: 'user', url: 'https://example.com/cal.ics' },
          name: 'Work',
          collapsed: false,
          order: 0,
          kind: 'events',
          category: 'none',
          timezone: 'America/Los_Angeles',
        },
      ],
    });
    const decoded = decodeShareState(encodeShareState(cfg));
    expect(decoded!.feeds[0]!.timezone).toBe('America/Los_Angeles');
  });
});
