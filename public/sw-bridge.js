// Imported into the generated service worker (vite.config.ts → workbox.importScripts).
//
// The app runs vite-plugin-pwa in 'prompt' mode: a new worker installs and
// waits until the page posts SKIP_WAITING (once Settings and the event editor
// are closed). Pages built before that (<= 0.51.9, 'autoUpdate') never post it
// — they expect the worker to take over by itself and just reload when it does —
// so a new worker would wait behind them forever, the status dot stuck on
// "updating". On install, ask every open window whether it can apply updates
// itself; current pages answer (main.ts). If any window stays silent, it's an
// old page (or frozen), so take over at once, as those pages expect.
const PING = 'kalendes:sw-ping';
const PONG = 'kalendes:sw-pong';
const ANSWER_WAIT_MS = 3000;
const answered = new Set();

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === PONG && event.source) answered.add(event.source.id);
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.length === 0) return;
      for (const w of windows) w.postMessage({ type: PING });
      const deadline = Date.now() + ANSWER_WAIT_MS;
      while (Date.now() < deadline && !windows.every((w) => answered.has(w.id))) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!windows.every((w) => answered.has(w.id))) await self.skipWaiting();
    })(),
  );
});
