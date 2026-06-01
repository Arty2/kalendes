// One-shot service-worker lifecycle signals for the UI. `offlineReady` flips
// true once the generated service worker has finished precaching the app shell
// (the first install), so the tray can briefly confirm the app now works
// offline. The flag is reset by the consumer after the flash has shown.
export const swStatus = $state<{ offlineReady: boolean }>({ offlineReady: false });
