// Service-worker lifecycle signals for the UI. `offlineReady` flips true once
// the generated service worker has finished precaching the app shell (the
// first install), so the tray can briefly confirm the app now works offline;
// the consumer resets it after the flash has shown. `updating` is true while a
// new version's worker installs over one already controlling the page — the
// status chip's dot pulses amber until it takes over (autoUpdate then reloads)
// or the install fails.
export const swStatus = $state<{ offlineReady: boolean; updating: boolean }>({
  offlineReady: false,
  updating: false,
});

// Follow a registration's updates into `swStatus.updating`. A worker installing
// with no controller yet is the first install, not an update, so it is skipped.
export function watchSwUpdates(reg: ServiceWorkerRegistration, sw: ServiceWorkerContainer): void {
  const track = (worker: ServiceWorker | null): void => {
    if (!worker || !sw.controller) return;
    const settle = (): void => {
      // 'activated' is followed by the autoUpdate reload; clearing here keeps
      // the chip honest if that reload never comes.
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
