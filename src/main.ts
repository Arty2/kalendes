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

// The first-paint ghost UI (index.html) is a fixed overlay, so the real app can
// mount and paint *underneath* it, then the overlay cross-fades out to reveal it —
// no layout shift (the app is in flow below the fixed skeleton the whole time).
const skeleton = document.getElementById('app-skeleton');

mount(App, { target });

if (skeleton) {
  const reduceMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    skeleton.remove();
  } else {
    // Double rAF: let the freshly-mounted app paint one frame underneath before
    // the overlay starts fading, so nothing shows through mid-transition.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        skeleton.addEventListener('transitionend', () => skeleton.remove(), { once: true });
        // Fallback if transitionend never fires (e.g. the tab is backgrounded).
        setTimeout(() => skeleton.remove(), 600);
        skeleton.classList.add('is-hiding');
      }),
    );
  }
}

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
