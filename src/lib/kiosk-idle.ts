// A locked kiosk drifts back to its home view once nobody has touched it for a
// while, as wall displays do: whoever browsed it last shouldn't leave a card
// open or the view parked on some other month for the next person.

export const KIOSK_IDLE_MS = 5 * 60 * 1000;

// Anything a person does to the screen. `scroll` doesn't bubble, so every
// listener goes on the capture phase, which sees scrolls of inner elements too.
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

// Calls `onIdle` once `ms` pass without activity on `target`, then waits for
// the next activity before counting again — one return per idle spell, not a
// repeat every `ms` on a screen nobody is using. Returns the teardown.
export function watchIdle(target: EventTarget, ms: number, onIdle: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // The return to today scrolls the view itself; that scroll mustn't count as
  // a person and start the next count. Activity within a second of a return
  // is the return's own.
  let quietUntil = 0;
  const arm = (): void => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      quietUntil = Date.now() + 1000;
      onIdle();
    }, ms);
  };
  const onActivity = (): void => {
    if (Date.now() < quietUntil) return;
    arm();
  };
  for (const type of ACTIVITY_EVENTS) target.addEventListener(type, onActivity, { capture: true, passive: true });
  arm();
  return () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    for (const type of ACTIVITY_EVENTS) target.removeEventListener(type, onActivity, { capture: true });
  };
}
