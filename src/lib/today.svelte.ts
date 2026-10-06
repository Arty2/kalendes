import { MS_PER_DAY } from './time';
import { zonedParts } from './format';
import { zonedWallToInstant } from './event-drag';
import type { Timezone } from './types';

// "Today" is the viewer's calendar day in the display timezone, held as a UTC
// midnight — the same day convention all-day events use. Not the UTC date: in
// Athens that would still read yesterday until 03:00.
const REFRESH_MS = 60 * 1000;

const zone = $state<{ tz: Timezone }>({ tz: 'local' });

function dayIn(now: Date, tz: Timezone): Date {
  const p = zonedParts(now, tz);
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}

export const today = $state<{ value: Date }>({ value: dayIn(new Date(), 'local') });

export function refreshToday(now: Date = new Date()): void {
  const next = dayIn(now, zone.tz);
  if (next.getTime() !== today.value.getTime()) {
    today.value = next;
  }
}

// App keeps this in step with config.timezone (state.svelte imports this
// module, so it can't read config itself).
export function setTodayZone(tz: Timezone): void {
  if (zone.tz === tz) return;
  zone.tz = tz;
  refreshToday();
}

// Where the calendar day `dayMs` (a UTC midnight) begins, for comparing against
// an event: all-day values share the UTC-midnight convention, but a timed
// event's instants need the real moment that day starts in the display zone.
export function dayStartMs(dayMs: number, allDay: boolean): number {
  if (allDay) return dayMs;
  const d = new Date(dayMs);
  return zonedWallToInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, zone.tz).getTime();
}

// Start of today / tomorrow, against an all-day or a timed event.
export function todayStartMs(allDay: boolean): number {
  return dayStartMs(today.value.getTime(), allDay);
}
export function tomorrowStartMs(allDay: boolean): number {
  return dayStartMs(today.value.getTime() + MS_PER_DAY, allDay);
}

if (typeof window !== 'undefined') {
  setInterval(() => refreshToday(), REFRESH_MS);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshToday();
  });
}
