import { mount } from 'svelte';
import App from './App.svelte';
import { registerSW } from 'virtual:pwa-register';
import { swStatus } from './lib/sw-status.svelte';

// Always open on today: stop the browser from restoring the timeline's prior
// scroll position on reload, which otherwise overrides the center-on-today pass.
if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
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
