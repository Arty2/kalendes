const MINUTE_MS = 60_000;

export const clock = $state<{ now: number }>({ now: Date.now() });

if (typeof window !== 'undefined') {
  setInterval(() => {
    clock.now = Date.now();
  }, MINUTE_MS);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') clock.now = Date.now();
  });
}
