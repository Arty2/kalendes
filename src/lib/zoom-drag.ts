// Touch-drag stepping for the toolbar's zoom nav: dragging a finger horizontally
// across the zoom buttons steps through the zoom levels — right toward the
// longer ranges (2Y), left toward the shorter ones (1M) — one step per button's
// width of travel. Kept DOM-free so it can be unit-tested; Toolbar.svelte owns
// the pointer plumbing and feeds the accumulated dx in.

// How many whole steps a horizontal displacement of `dx` px represents, at
// `stepPx` px per step. Truncates toward zero so a half-step doesn't fire, and
// is sign-symmetric (drag left = negative, right = positive).
export function dragStepCount(dx: number, stepPx: number): number {
  if (stepPx <= 0) return 0;
  const n = Math.trunc(dx / stepPx);
  return n === 0 ? 0 : n; // normalize -0 (from small negative dx) to 0
}

// Clamp an index + step offset to a valid zoom index. Overshoot past either end
// is absorbed (the caller still advances its drag anchor), so reversing the
// drag steps back immediately with no dead zone.
export function clampZoomIndex(current: number, steps: number, total: number): number {
  return Math.min(Math.max(current + steps, 0), total - 1);
}
