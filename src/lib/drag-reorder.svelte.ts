import { config } from './state.svelte';
import { longPress } from './haptics';

// A tiny pointer-based list reorder controller shared by the Settings lists
// (calendars + filters). No library, no HTML5 drag (which doesn't work on
// touch) — raw pointer events, matching the codebase's gesture style.
//
// While dragging, the grabbed row is shown LIVE at the drop position (the list
// previews the new order, with displaced rows sliding via `animate:flip`) and
// the grabbed row renders entirely in the accent colour. The order-number badges
// stay frozen to their pre-drag values until the drop — only on pointerup is the
// new order committed (via `onReorder`) and the numbers re-sequenced. Persistence
// rides the existing config autosave.

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
  // Live preview order shown while dragging (the grabbed row moved to the hovered
  // slot). Null when not dragging → the component renders its own order.
  let previewIds = $state<string[] | null>(null);
  // Order snapshot captured at drag start, driving the order-number badges so
  // they don't renumber until the drop commits.
  let frozenIds: string[] = [];

  function move(e: PointerEvent): void {
    if (draggingId == null || previewIds == null) return;
    const ids = previewIds;
    const idx = ids.indexOf(draggingId);
    if (idx < 0) return;
    const y = e.clientY;
    // Crossed the next row's midpoint → move the grabbed row down one slot.
    if (idx < ids.length - 1) {
      const el = opts.getRowEl(ids[idx + 1]!);
      if (el) {
        const r = el.getBoundingClientRect();
        if (y > r.top + r.height / 2) {
          const next = [...ids];
          next.splice(idx, 1);
          next.splice(idx + 1, 0, draggingId);
          previewIds = next;
          return;
        }
      }
    }
    // Crossed the previous row's midpoint → move up one slot.
    if (idx > 0) {
      const el = opts.getRowEl(ids[idx - 1]!);
      if (el) {
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          const next = [...ids];
          next.splice(idx, 1);
          next.splice(idx - 1, 0, draggingId);
          previewIds = next;
          return;
        }
      }
    }
  }

  function detach(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }

  function onUp(): void {
    if (draggingId == null) return;
    const order = previewIds;
    const frozen = frozenIds;
    draggingId = null;
    previewIds = null;
    frozenIds = [];
    detach();
    // Commit only a real change (the preview differs from the frozen order).
    if (order && order.join(' ') !== frozen.join(' ')) opts.onReorder(order);
  }

  // A cancelled gesture (e.g. the browser stealing the pointer) aborts without
  // reordering — the drop is only committed on a real pointerup.
  function onCancel(): void {
    if (draggingId == null) return;
    draggingId = null;
    previewIds = null;
    frozenIds = [];
    detach();
  }

  function startDrag(e: PointerEvent, id: string): void {
    if (typeof window === 'undefined') return;
    // Ignore non-primary mouse buttons; allow touch/pen.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    frozenIds = opts.getOrderedIds();
    previewIds = [...frozenIds];
    draggingId = id;
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
    // The live preview order while dragging (null otherwise).
    get previewIds() {
      return previewIds;
    },
    // 1-based badge number for a row: its frozen position while dragging (so the
    // numbers hold until the drop), else -1 for the caller to use the live index.
    frozenNumberOf(id: string): number {
      const i = frozenIds.indexOf(id);
      return i < 0 ? -1 : i + 1;
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
