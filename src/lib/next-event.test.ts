import { describe, it, expect } from 'vitest';
import { pickStatusEvent, formatTimeLeft, NEXT_SOON_MS } from './next-event';
import type { DisplayEvent } from './types';

const NOW = Date.parse('2026-05-04T10:00:00Z');
const MIN = 60_000;

function ev(uid: string, startMs: number, endMs: number, extra: Partial<DisplayEvent> = {}): DisplayEvent {
  return {
    uid, feedId: 'f', title: uid, description: '', descriptionSnippet: '', location: '',
    start: new Date(startMs), end: new Date(endMs), allDay: false,
    displayTitle: uid, displayDescription: '', displayDescriptionSnippet: '', displayLocation: '',
    styleVariant: 'none', hidden: false, ruleCategory: null, ruleColor: null, ruleBlock: null,
    ...extra,
  };
}

describe('pickStatusEvent', () => {
  it('picks the next event to start', () => {
    const r = pickStatusEvent([ev('later', NOW + 120 * MIN, NOW + 180 * MIN), ev('soon', NOW + 30 * MIN, NOW + 60 * MIN)], NOW);
    expect(r).toEqual({ event: expect.objectContaining({ uid: 'soon' }), ongoing: false });
  });

  it('shows an event under way until the next is due soon', () => {
    const now = ev('now', NOW - 30 * MIN, NOW + 30 * MIN);
    expect(pickStatusEvent([now, ev('next', NOW + 45 * MIN, NOW + 60 * MIN)], NOW))
      .toEqual({ event: now, ongoing: true });
    const due = ev('due', NOW + NEXT_SOON_MS, NOW + 60 * MIN);
    expect(pickStatusEvent([now, due], NOW)).toEqual({ event: due, ongoing: false });
  });

  it('skips cancelled and hidden events and ones already over', () => {
    const r = pickStatusEvent([
      ev('off', NOW + 5 * MIN, NOW + 10 * MIN, { cancelled: true }),
      ev('gone', NOW + 6 * MIN, NOW + 10 * MIN, { hidden: true }),
      ev('past', NOW - 60 * MIN, NOW - 30 * MIN),
      ev('ok', NOW + 20 * MIN, NOW + 30 * MIN),
    ], NOW);
    expect(r?.event.uid).toBe('ok');
  });

  it("never shows today's all-day events, but does tomorrow's", () => {
    const day = Date.parse('2026-05-04T00:00:00Z');
    const today = ev('today', day, day + 86_400_000, { allDay: true });
    expect(pickStatusEvent([today], NOW)).toBeNull();
    const tomorrow = ev('tomorrow', day + 86_400_000, day + 2 * 86_400_000, { allDay: true });
    expect(pickStatusEvent([today, tomorrow], NOW)?.event.uid).toBe('tomorrow');
  });

  it('keeps only the kind the setting asks for', () => {
    const day = Date.parse('2026-05-05T00:00:00Z');
    const allDay = ev('holiday', day, day + 86_400_000, { allDay: true });
    const timed = ev('meeting', day + 9 * 3_600_000, day + 10 * 3_600_000);
    expect(pickStatusEvent([allDay, timed], NOW)?.event.uid).toBe('holiday');
    expect(pickStatusEvent([allDay, timed], NOW, 'timed')?.event.uid).toBe('meeting');
    const ongoing = ev('now', NOW - 10 * MIN, NOW + 10 * MIN);
    expect(pickStatusEvent([ongoing, allDay, timed], NOW, 'allday')?.event.uid).toBe('holiday');
  });
});

describe('formatTimeLeft', () => {
  it('reads minutes, then hours and minutes', () => {
    expect(formatTimeLeft(NOW + 20 * MIN, NOW)).toBe('20 MIN LEFT');
    expect(formatTimeLeft(NOW + 30_000, NOW)).toBe('1 MIN LEFT');
    expect(formatTimeLeft(NOW + 80 * MIN, NOW)).toBe('1H 20M LEFT');
    expect(formatTimeLeft(NOW + 120 * MIN, NOW)).toBe('2H LEFT');
  });
});
