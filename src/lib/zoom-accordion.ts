// Pure window math for the toolbar's accordion zoom nav: when the row can't
// fit every zoom button, the ones at the edges collapse into thin slivers and
// the expanded buttons form a contiguous window that always contains the
// active zoom. Kept DOM-free so it can be unit-tested; Toolbar.svelte does the
// measuring and feeds the numbers in.

// Max number of expanded buttons that fit: k expanded + (total - k) slivers
// must fit in `budget` px. Deterministic in budget — no feedback loop with the
// collapse state it drives. Always returns at least 1 so the active zoom stays
// expanded even when nothing truly fits.
export function fitCount(budget: number, buttonW: number, sliverW: number, total: number): number {
  for (let k = total; k > 1; k--) {
    if (k * buttonW + (total - k) * sliverW <= budget) return k;
  }
  return 1;
}

// Minimal-movement contiguous window: keep prevStart while the active index is
// already inside [start, start + count); otherwise slide just enough to
// include it. Clamped to [0, total - count]. Minimal movement (rather than
// centering on the active zoom) keeps the window still while the active zoom
// moves within it, so stepping through zooms doesn't churn the whole row.
export function slideWindow(prevStart: number, active: number, count: number, total: number): number {
  const maxStart = Math.max(0, total - count);
  let start = Math.min(Math.max(prevStart, 0), maxStart);
  if (active < start) start = active;
  else if (active > start + count - 1) start = active - count + 1;
  return Math.min(Math.max(start, 0), maxStart);
}
