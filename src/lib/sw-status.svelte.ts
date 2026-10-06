// Service-worker lifecycle signals for the UI. `offlineReady` flips true once
// the generated service worker has finished precaching the app shell (the
// first install), so the tray can briefly confirm the app now works offline;
// the consumer resets it after the flash has shown. `updating` is true while a
// new version's worker installs over one already controlling the page — the
// status chip's dot pulses amber until it takes over (autoUpdate then reloads)
// or the install fails. `updateReady` is true once a new version is installed
// and waiting to take over (see applyAppUpdate).
export const swStatus = $state<{ offlineReady: boolean; updating: boolean; updateReady: boolean }>({
  offlineReady: false,
  updating: false,
  updateReady: false,
});

// The registration's "take over and reload" call, handed in by main.ts (none in
// dev / tests). App calls applyAppUpdate when nothing would be lost by the
// reload; the temp marker survives it in the URL (#d=), so the timeline
// reopens where it was.
let appUpdater: (() => Promise<void>) | null = null;
let applying = false;
export function setAppUpdater(fn: () => Promise<void>): void {
  appUpdater = fn;
}
export function applyAppUpdate(): void {
  if (!appUpdater || applying || !swStatus.updateReady) return;
  applying = true;
  appUpdater().catch(() => {
    applying = false;
  });
}

// Follow a registration's updates into `swStatus.updating`. A worker installing
// with no controller yet is the first install, not an update, so it is skipped.
export function watchSwUpdates(reg: ServiceWorkerRegistration, sw: ServiceWorkerContainer): void {
  const track = (worker: ServiceWorker | null): void => {
    if (!worker || !sw.controller) return;
    const settle = (): void => {
      // 'activated' is followed by the update reload; clearing here keeps the
      // chip honest if that reload never comes. A worker waiting on an open
      // editor stays 'installed', so the dot keeps pulsing until it's applied.
      if (worker.state === 'activated' || worker.state === 'redundant') {
        swStatus.updating = false;
        worker.removeEventListener('statechange', settle);
      }
    };
    swStatus.updating = true;
    worker.addEventListener('statechange', settle);
    settle();
  };
  track(reg.installing ?? reg.waiting);
  reg.addEventListener('updatefound', () => track(reg.installing));
}

// The browser only looks for a new service worker on a page load, so a tab or
// installed app left open would run the old build until reloaded. Ask the
// registration for an update when the page becomes visible again (at most every
// `minGapMs`) and once a day while it stays open; autoUpdate then installs it
// and reloads. Offline checks are skipped (update() would just reject).
export const SW_CHECK_MIN_GAP_MS = 5 * 60 * 1000;
export const SW_CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export function scheduleSwUpdateChecks(
  reg: Pick<ServiceWorkerRegistration, 'update'>,
  env: { doc: Document; nav: Pick<Navigator, 'onLine'>; now?: () => number } = { doc: document, nav: navigator },
): () => void {
  const now = env.now ?? Date.now;
  let lastCheck = now();
  const check = (): void => {
    if (!env.nav.onLine) return;
    lastCheck = now();
    reg.update().catch(() => {
      /* offline, or the server is down: the next check tries again */
    });
  };
  const onVisible = (): void => {
    if (env.doc.visibilityState === 'visible' && now() - lastCheck >= SW_CHECK_MIN_GAP_MS) check();
  };
  env.doc.addEventListener('visibilitychange', onVisible);
  const daily = setInterval(check, SW_CHECK_EVERY_MS);
  return () => {
    env.doc.removeEventListener('visibilitychange', onVisible);
    clearInterval(daily);
  };
}
