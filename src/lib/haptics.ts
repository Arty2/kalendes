function buzz(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  }
}

// 5ms is below what many phones (notably Firefox on Android) actually render,
// so taps felt dead there — bump to a perceptible minimum.
export function tap(): void {
  buzz(10);
}

export function longPress(): void {
  buzz(80);
}

// Tray expand = one longer pulse ("taaaap"); collapse = two short ("tap tap").
export function trayExpand(): void {
  buzz(45);
}

export function trayCollapse(): void {
  buzz([12, 40, 12]);
}

// Settings panel open: a firm single pulse, same strength as the tray opening.
export function panelOpen(): void {
  buzz(45);
}

// Calendars refreshing: a vibrate-pause-vibrate-pause pattern while loading.
export function loading(): void {
  buzz([40, 120, 40, 120]);
}

export function createLongPress(ms = 500): {
  start(callback: () => void): void;
  cancel(): void;
  didFire(): boolean;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  return {
    start(callback: () => void) {
      fired = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        longPress();
        callback();
      }, ms);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    didFire() {
      const v = fired;
      fired = false;
      return v;
    },
  };
}
