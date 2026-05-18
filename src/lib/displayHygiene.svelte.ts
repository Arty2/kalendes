import { config } from './state.svelte';

const INVERT_FLASH_INTERVAL_MS = 15 * 60 * 1000;
const INVERT_FLASH_DURATION_MS = 300;
const PIXEL_SHIFT_INTERVAL_MS = 5 * 60 * 1000;
const DAILY_RELOAD_HOUR = 3;

const SHIFT_STEPS: Array<{ dx: number; dy: number }> = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
];

function flash(): void {
  document.documentElement.setAttribute('data-eink-flash', 'true');
  setTimeout(() => document.documentElement.removeAttribute('data-eink-flash'), INVERT_FLASH_DURATION_MS);
}

function clearFlash(): void {
  document.documentElement.removeAttribute('data-eink-flash');
}

function applyShift(step: number): void {
  const s = SHIFT_STEPS[step % SHIFT_STEPS.length]!;
  document.body.style.setProperty('--eink-shift-x', s.dx + 'px');
  document.body.style.setProperty('--eink-shift-y', s.dy + 'px');
}

function clearShift(): void {
  document.body.style.removeProperty('--eink-shift-x');
  document.body.style.removeProperty('--eink-shift-y');
}

function msUntilNextDailyReload(): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(DAILY_RELOAD_HOUR, 0, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

export function useDisplayHygiene(): void {
  if (typeof document === 'undefined') return;

  $effect(() => {
    const root = document.documentElement;
    if (!config.eink) {
      root.classList.remove('eink');
      clearFlash();
      clearShift();
      return;
    }
    root.classList.add('eink');
    let shiftStep = 0;
    applyShift(shiftStep);
    const flashTimer = setInterval(flash, INVERT_FLASH_INTERVAL_MS);
    const shiftTimer = setInterval(() => applyShift(++shiftStep), PIXEL_SHIFT_INTERVAL_MS);
    const reloadTimer = setTimeout(() => window.location.reload(), msUntilNextDailyReload());

    return () => {
      clearInterval(flashTimer);
      clearInterval(shiftTimer);
      clearTimeout(reloadTimer);
      clearFlash();
      clearShift();
      root.classList.remove('eink');
    };
  });
}
