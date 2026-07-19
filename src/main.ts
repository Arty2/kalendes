import { mount } from 'svelte';
import App from './App.svelte';
import { registerSW } from 'virtual:pwa-register';
import { swStatus } from './lib/sw-status.svelte';

// Always open on today: stop the browser from restoring the timeline's prior
// scroll position on reload, which otherwise overrides the center-on-today pass.
if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

// Recover from a failed dynamic import — a chunk renamed by a new deploy while a
// stale page / service worker still references the old name would otherwise blank
// the app. Reload once to pull the fresh index + chunks; a short cooldown in
// sessionStorage prevents a reload loop if the chunk is genuinely unreachable.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    let allow = false;
    try {
      const KEY = 'kalendes:preload-reload-at';
      const last = Number(sessionStorage.getItem(KEY) ?? '0');
      if (Date.now() - last >= 10_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        allow = true;
      }
    } catch {
      // No sessionStorage (private mode) — skip the auto-reload rather than risk a loop.
    }
    if (allow) location.reload();
  });
}

const target = document.getElementById('app');
if (!target) throw new Error('No #app element');

mount(App, { target });

if (import.meta.env.PROD) {
  registerSW({
    immediate: true,
    // First install finished precaching the shell — let the tray flash a brief
    // "offline ready" confirmation.
    onOfflineReady() {
      swStatus.offlineReady = true;
    },
  });
}
