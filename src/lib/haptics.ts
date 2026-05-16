export function tap(): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(5);
  }
}

export function longPress(): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([10, 30, 10]);
  }
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
