import { startOfDay } from './time';

const REFRESH_MS = 60 * 60 * 1000;

function utcStartOfDay(d: Date): Date {
  return startOfDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
}

export const today = $state<{ value: Date }>({ value: utcStartOfDay(new Date()) });

export function refreshToday(now: Date = new Date()): void {
  const next = utcStartOfDay(now);
  if (next.getTime() !== today.value.getTime()) {
    today.value = next;
  }
}

if (typeof window !== 'undefined') {
  setInterval(() => refreshToday(), REFRESH_MS);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshToday();
  });
}
