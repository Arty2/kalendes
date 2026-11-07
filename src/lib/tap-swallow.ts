// Swallows the rest of a tap that has already done its job — its pointerup,
// click and dblclick — before anything else on the page hears it. For a tap
// that changes the view under the finger at pointerdown (a header double tap
// drilling into another zoom): the rest of it would land on the new view, as a
// tap there. Kept out of any component: the one that saw the pointerdown may be
// the one the view change unmounts, and its listeners with it.

const REST = ['pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'] as const;
// The browser sends a double tap's dblclick straight after its click; past
// the click only that is still the same tap.
const DBLCLICK_GRACE_MS = 100;
let until = 0;
let dblclickOnly = false;
let installed = false;

function swallow(e: Event): void {
  if (Date.now() >= until) return;
  if (dblclickOnly && e.type !== 'dblclick') return;
  // Immediate, so other window listeners don't hear it either.
  e.stopImmediatePropagation();
  e.preventDefault();
  if (e.type === 'dblclick') until = 0;
  // A tap with no dblclick (most touch browsers) ends at its click, so the
  // next real tap isn't eaten.
  else if (e.type === 'click') {
    until = Date.now() + DBLCLICK_GRACE_MS;
    dblclickOnly = true;
  }
}

/** Listens once for good, on the window's capture phase. Call it early (at
 *  mount), so it runs ahead of window listeners added later. */
export function installTapSwallow(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const t of REST) window.addEventListener(t, swallow, true);
}

/** Swallow the current tap's remaining events for the next `ms`, or up to its
 *  dblclick. */
export function swallowRestOfTap(ms: number): void {
  installTapSwallow();
  until = Date.now() + ms;
  dblclickOnly = false;
}
