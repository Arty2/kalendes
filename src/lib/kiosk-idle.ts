// A locked kiosk drifts back to its home view once nobody has touched it for a
// while, as wall displays do: whoever browsed it last shouldn't leave a card
// open or the view parked on some other month for the next person.

import type { KioskHome } from './types';
import { USER_INPUT_EVENTS } from './user-input';

export const KIOSK_IDLE_MS = 5 * 60 * 1000;

// Calls `onIdle` once `ms` pass after the last activity on `target`. It counts
// only from a first activity, so a screen nobody has touched (signage) keeps
// what it shows, and it fires once per idle spell, not every `ms` on a screen
// nobody is using. Activity just stamps the time; one timer, when it comes due,
// re-schedules itself for whatever is left. Returns the teardown.
export function watchIdle(target: EventTarget, ms: number, onIdle: () => void): () => void {
  let lastActivity = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = (): void => {
    const left = lastActivity + ms - Date.now();
    if (left > 0) {
      timer = setTimeout(check, left);
      return;
    }
    timer = null;
    onIdle();
  };
  const onActivity = (): void => {
    lastActivity = Date.now();
    if (timer == null) timer = setTimeout(check, ms);
  };
  for (const type of USER_INPUT_EVENTS) target.addEventListener(type, onActivity, { capture: true, passive: true });
  return () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    for (const type of USER_INPUT_EVENTS) target.removeEventListener(type, onActivity, { capture: true });
  };
}

// The home view is read when the lock begins and kept for the tab's session,
// so a reload (an app update reloads a kiosk by itself) doesn't adopt the
// zoom a visitor left in the URL, or the rows they collapsed (which persist).
// Keyed by the PIN hash: a new lock is a new home, as is an imported link
// (share-import.svelte.ts clears it and bumps `ui.kioskHomeRev`).
const HOME_KEY = 'calendar-timeline:kiosk-home';

export function readKioskHome(pin: string): KioskHome | null {
  try {
    const raw = sessionStorage.getItem(HOME_KEY);
    if (!raw) return null;
    const home = JSON.parse(raw) as KioskHome;
    return home?.pin === pin ? home : null;
  } catch {
    return null;
  }
}

export function saveKioskHome(home: KioskHome): void {
  try {
    sessionStorage.setItem(HOME_KEY, JSON.stringify(home));
  } catch {
    // Without storage the home holds until the next reload.
  }
}

export function clearKioskHome(): void {
  try {
    sessionStorage.removeItem(HOME_KEY);
  } catch {
    // Nothing to clear.
  }
}
