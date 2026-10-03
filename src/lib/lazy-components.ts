import type { Component } from 'svelte';

// Components most sessions never open (settings, the dialogs, the 1W grid) ship
// as their own chunks instead of in the main bundle, which the first paint has
// to download, parse and compile. `Lazy.svelte` mounts one once it's needed;
// `prefetchLazyComponents` pulls them all in once the app is idle, so a first
// open doesn't wait on the network. (The service worker precaches every chunk,
// so offline opens work too.)

// `any` here only for the shared cache; each loader's props are checked where
// Lazy is used.
export type ComponentLoader<P extends Record<string, any> = any> = () => Promise<{ default: Component<P> }>;

export const loadSettingsPanel = () => import('../components/SettingsPanel.svelte');
export const loadEventModal = () => import('../components/EventModal.svelte');
export const loadAddEventModal = () => import('../components/AddEventModal.svelte');
export const loadShareImportModal = () => import('../components/ShareImportModal.svelte');
export const loadKioskPinModal = () => import('../components/KioskPinModal.svelte');
export const loadShortcutsModal = () => import('../components/ShortcutsModal.svelte');
export const loadWeekGrid = () => import('../components/WeekGrid.svelte');

// Resolved components by loader, so a Lazy that remounts (e.g. switching back to
// 1W) renders synchronously instead of blanking for a frame.
const resolved = new Map<ComponentLoader, Component>();

export function resolvedComponent(loader: ComponentLoader): Component | undefined {
  return resolved.get(loader);
}

export function loadComponent(loader: ComponentLoader): Promise<Component> {
  const hit = resolved.get(loader);
  if (hit) return Promise.resolve(hit);
  return loader().then((m) => {
    resolved.set(loader, m.default as Component);
    return m.default as Component;
  });
}

const ALL: ComponentLoader[] = [
  loadEventModal,
  loadAddEventModal,
  loadSettingsPanel,
  loadWeekGrid,
  loadShortcutsModal,
  loadKioskPinModal,
  loadShareImportModal,
];

// Warm every lazy chunk once the main thread is idle after startup. Failures are
// left to the next real open (and main.ts's preload-error reload).
export function prefetchLazyComponents(): void {
  if (typeof window === 'undefined') return;
  const run = (): void => {
    for (const loader of ALL) void loadComponent(loader).catch(() => {});
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
