import type { DisplayEvent } from './types';
import { MS_PER_DAY, startOfDay } from './time';

// The status bar's one-line "what's next": a timed event under way (with the
// time it has left), else the next one to start. An event under way gives way
// to the next once that is due within NEXT_SOON_MS, so the bar turns to the
// meeting you're about to walk into. Cancelled events never show; an all-day
// event shows from the day before (today's has already begun). `kinds` is the
// Next Event setting: 'allday' keeps only all-day events, 'timed' ("Short")
// only timed ones.
export const NEXT_SOON_MS = 10 * 60_000;

export type StatusEvent = { event: DisplayEvent; ongoing: boolean };

export function pickStatusEvent(
  events: Iterable<DisplayEvent>,
  nowMs: number,
  kinds: 'all' | 'allday' | 'timed' = 'all',
): StatusEvent | null {
  const tomorrowMs = startOfDay(new Date(nowMs)).getTime() + MS_PER_DAY;
  let next: DisplayEvent | null = null;
  let current: DisplayEvent | null = null;
  for (const ev of events) {
    if (ev.hidden || ev.cancelled) continue;
    if (ev.allDay ? kinds === 'timed' : kinds === 'allday') continue;
    const s = ev.start.getTime();
    if (ev.allDay) {
      if (s < tomorrowMs) continue;
    } else if (s < nowMs) {
      // Under way: keep the one that ends first.
      if (ev.end.getTime() > nowMs && (!current || ev.end < current.end)) current = ev;
      continue;
    }
    if (!next || s < next.start.getTime()) next = ev;
  }
  if (current && (!next || next.start.getTime() - nowMs > NEXT_SOON_MS)) {
    return { event: current, ongoing: true };
  }
  return next ? { event: next, ongoing: false } : null;
}

// "20 MIN LEFT", "1H 20M LEFT", "2H LEFT" — for an event under way.
export function formatTimeLeft(endMs: number, nowMs: number): string {
  const min = Math.max(1, Math.ceil((endMs - nowMs) / 60_000));
  if (min < 60) return `${min} MIN LEFT`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}H ${m}M LEFT` : `${h}H LEFT`;
}
