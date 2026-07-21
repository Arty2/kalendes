import { config } from './state.svelte';
import { longPress } from './haptics';

// A tiny pointer-based list reorder controller shared by the Settings lists
// (calendars + filters). No library, no HTML5 drag (which doesn't work on
// touch) — raw pointer events, matching the codebase's gesture style.
//
// The grabbed row stays keyed in its {#each}; as the pointer crosses a
// neighbour's midpoint the list is reordered live (via `onReorder`) and the
// displaced rows animate with Svelte's `animate:flip`. Persistence rides the
// existing config autosave (the same path the old move buttons used).

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

  function move(e: PointerEvent): void {
    if (draggingId == null) return;
    const ids = opts.getOrderedIds();
    const idx = ids.indexOf(draggingId);
    if (idx < 0) return;
    const y = e.clientY;

    // Crossed the next row's midpoint → move down one slot.
    if (idx < ids.length - 1) {
      const el = opts.getRowEl(ids[idx + 1]!);
      if (el) {
        const r = el.getBoundingClientRect();
        if (y > r.top + r.height / 2) {
          const next = [...ids];
          next.splice(idx, 1);
          next.splice(idx + 1, 0, draggingId);
          opts.onReorder(next);
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
          opts.onReorder(next);
          return;
        }
      }
    }
  }

  function end(): void {
    if (draggingId == null) return;
    draggingId = null;
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  }

  function startDrag(e: PointerEvent, id: string): void {
    if (typeof window === 'undefined') return;
    // Ignore non-primary mouse buttons; allow touch/pen.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    draggingId = id;
    longPress();
    e.preventDefault();
    e.stopPropagation();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  return {
    get draggingId() {
      return draggingId;
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
