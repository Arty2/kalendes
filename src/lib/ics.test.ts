import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseIcs } from './ics';

const here = dirname(fileURLToPath(import.meta.url));
const demoIcsPath = resolve(here, '../../public/demo/greek-holidays.ics');

describe('Greek public holidays demo ICS', () => {
  const ics = readFileSync(demoIcsPath, 'utf-8');

  it('parses fixed holidays via RRULE within range', () => {
    const events = parseIcs(ics, 'demo', new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T23:59:59Z'));
    const titles = events.map((e) => e.title);
    expect(titles.some((t) => t.includes('New Year'))).toBe(true);
    expect(titles.some((t) => t.includes('Epiphany'))).toBe(true);
    expect(titles.some((t) => t.includes('Independence'))).toBe(true);
    expect(titles.some((t) => t.includes('Christmas'))).toBe(true);
  });

  it('includes movable Easter holidays', () => {
    const events = parseIcs(ics, 'demo', new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T23:59:59Z'));
    const easter = events.find((e) => e.title.includes('Easter Sunday'));
    expect(easter).toBeDefined();
    expect(easter!.start.getUTCFullYear()).toBe(2026);
    expect(easter!.start.getUTCMonth()).toBe(3); // April
    expect(easter!.start.getUTCDate()).toBe(12);
  });

  it('marks events as all-day', () => {
    const events = parseIcs(ics, 'demo', new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T23:59:59Z'));
    expect(events.every((e) => e.allDay)).toBe(true);
  });

  it('extracts a description snippet', () => {
    const events = parseIcs(ics, 'demo', new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T23:59:59Z'));
    const newYear = events.find((e) => e.title.includes('New Year'));
    expect(newYear?.descriptionSnippet.length).toBeGreaterThan(0);
    expect(newYear?.descriptionSnippet.length).toBeLessThanOrEqual(80);
  });
});
