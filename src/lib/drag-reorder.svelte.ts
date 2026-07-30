import { config } from './state.svelte';
import { longPress } from './haptics';

// A tiny pointer-based list reorder controller shared by the Settings lists
// (calendars + filters). No library, no HTML5 drag (which doesn't work on
// touch) — raw pointer events, matching the codebase's gesture style.
//
// The reorder is DEFERRED to drop: while dragging, the list order (and the
// numbered order badges) stay put, and an accent drop-line marks the gap where
// the grabbed row will land — the bottom edge of the row above the gap, or the
// top edge of the first row when dropping at the very top. Only on pointerup is
// the new order committed (via `onReorder`); the displaced rows then settle with
// Svelte's `animate:flip`. Persistence rides the existing config autosave.

type Options = {
  // Current visual order of item ids (top → bottom).
  getOrderedIds: () => string[];
  // The row element for an id (its <li>), for midpoint measurement.
  getRowEl: (id: string) => HTMLElement | undefined;
  // Apply a new id order to the underlying config.
  onReorder: (orderedIds: string[]) => void;
};

export function createDragReorder(opts: Options) {
  let draggingId = $state<string | null>(null);
  // The row + edge the accent drop-line is drawn on while dragging (marks where
  // the grabbed row will land). Null when hovering the grabbed row's own slot.
  let dropTargetId = $state<string | null>(null);
  let dropEdge = $state<'top' | 'bottom' | null>(null);
  // Insertion index (0..n) in the current order that the indicator represents;
  // committed on drop. -1 when there's no valid drop (a no-op move).
  let dropIndex = -1;

  function clearIndicator(): void {
    dropTargetId = null;
    dropEdge = null;
    dropIndex = -1;
  }

  function move(e: PointerEvent): void {
    if (draggingId == null) return;
    const ids = opts.getOrderedIds();
    const from = ids.indexOf(draggingId);
    if (from < 0) return;
    const y = e.clientY;
    // Insertion index: the first row whose vertical midpoint sits below the
    // pointer (insert before it); past every midpoint → append at the end.
    let k = ids.length;
    for (let i = 0; i < ids.length; i++) {
      const el = opts.getRowEl(ids[i]!);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) { k = i; break; }
    }
    // Dropping back into the grabbed row's own slot is a no-op — no indicator.
    if (k === from || k === from + 1) { clearIndicator(); return; }
    dropIndex = k;
    // Gap-edge (before/after): mark the bottom edge of the row above the gap; at
    // the very top there is no row above, so mark the top edge of the first row.
    if (k === 0) {
      dropTargetId = ids[0] ?? null;
      dropEdge = 'top';
    } else {
      dropTargetId = ids[k - 1] ?? null;
      dropEdge = 'bottom';
    }
  }

  function commit(): void {
    if (draggingId == null || dropIndex < 0) return;
    const ids = opts.getOrderedIds();
    const from = ids.indexOf(draggingId);
    if (from < 0) return;
    const next = ids.filter((id) => id !== draggingId);
    // Removing the grabbed row shifts everything after it up one, so an insertion
    // index past the original slot lands one earlier.
    const insertAt = from < dropIndex ? dropIndex - 1 : dropIndex;
    next.splice(insertAt, 0, draggingId);
    opts.onReorder(next);
  }

  function detach(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }

  function onUp(): void {
    if (draggingId == null) return;
    commit();
    draggingId = null;
    clearIndicator();
    detach();
  }

  // A cancelled gesture (e.g. the browser stealing the pointer) aborts without
  // reordering — the drop is only committed on a real pointerup.
  function onCancel(): void {
    if (draggingId == null) return;
    draggingId = null;
    clearIndicator();
    detach();
  }

  function startDrag(e: PointerEvent, id: string): void {
    if (typeof window === 'undefined') return;
    // Ignore non-primary mouse buttons; allow touch/pen.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    draggingId = id;
    clearIndicator();
    longPress();
    e.preventDefault();
    e.stopPropagation();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  return {
    get draggingId() {
      return draggingId;
    },
    get dropTargetId() {
      return dropTargetId;
    },
    get dropEdge() {
      return dropEdge;
    },
    startDrag,
  };
}

// Reduced-motion-aware duration for `animate:flip` on the reorder lists.
// Mirrors App.svelte's data-motion resolution ('auto' follows the OS).
export function reorderFlipDuration(): number {
  const reduced =
    config.motion === 'reduced' ||
    (config.motion === 'auto' &&
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches);
  return reduced ? 0 : 160;
}
