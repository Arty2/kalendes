// Pointer recognition for drag-to-reschedule, shared by EventPill (horizontal
// zooms) and WeekEvent (1W) so the gesture can't drift between the two views.
// It only decides WHEN a drag starts, moves, ends or is cancelled; the view that
// owns the geometry supplies a `DragSource` that turns pointer coordinates into
// a preview and commits it (see Row.svelte / WeekGrid.svelte, and event-drag.ts
// for the date math).
//
// It has to coexist with the pill's other gestures:
// - tap opens the modal — a press released inside the slop is still a click;
// - long-press selects into the tray — the pill keeps its own long-press timer
//   and calls `arm()` when it fires. A draggable pill applies that selection on
//   release, not at the hold: selecting opens the tray, which on a wide screen
//   is a side panel that reflows the view under a finger about to drag;
// - touch scrolling and panning — on touch, moving before the hold has landed
//   is a scroll, never a drag. Only a held finger drags (and the pill then
//   blocks the native scroll through `holding`). A mouse or pen drags as soon
//   as it leaves the slop, since for them a press-and-move has no other meaning
//   on a pill.

import { HOLD_SLOP_PX } from './marker-hold';

/** Which part of a pill was grabbed: its body, or a resize edge. */
export type DragPart = 'body' | 'start' | 'end';

export type DragSession = {
  move(x: number, y: number): void;
  /** `commit` false = cancelled (Esc, pointercancel): drop the preview. */
  end(commit: boolean): void;
};

/** Start a drag of `part` grabbed at viewport (x, y), or refuse it with null. */
export type DragSource = (part: DragPart, x: number, y: number) => DragSession | null;

export type MoveResult = 'idle' | 'pending' | 'dragging' | 'dropped';

export type PointerDrag = {
  down(e: PointerEvent, part: DragPart): void;
  /** The pill's long-press fired: on touch, movement from here drags. */
  arm(): void;
  move(e: PointerEvent): MoveResult;
  /** True when the release ended a drag (the pill should not treat it as a tap). */
  up(e: PointerEvent): boolean;
  cancel(): void;
  /** Armed or dragging — while true, native touch scrolling must be blocked. */
  readonly holding: boolean;
  readonly dragging: boolean;
  /** True once for the click that trails a drag; the pill swallows it. */
  consumeClick(): boolean;
};

type Pending = {
  pid: number;
  x: number;
  y: number;
  part: DragPart;
  touch: boolean;
  armed: boolean;
  target: Element | null;
};

export function createPointerDrag(
  source: () => DragSource | null | undefined,
  opts: {
    slopPx?: number;
    /** A drag began (the pill drops its long-press / armed state). */
    onBegin?: () => void;
  } = {},
): PointerDrag {
  const slop = opts.slopPx ?? HOLD_SLOP_PX;
  let pending: Pending | null = null;
  let session: DragSession | null = null;
  let swallow = false;

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !session) return;
    // Capture phase, so App's Escape (which clears the selection) never sees it.
    e.preventDefault();
    e.stopImmediatePropagation();
    cancel();
  }

  function finish(): void {
    if (pending?.target) {
      try {
        (pending.target as HTMLElement).releasePointerCapture?.(pending.pid);
      } catch {
        /* capture may already be released */
      }
    }
    if (session && typeof window !== 'undefined') window.removeEventListener('keydown', onKey, true);
    pending = null;
    session = null;
  }

  function cancel(): void {
    const s = session;
    finish();
    if (s) {
      s.end(false);
      swallow = true;
    }
  }

  return {
    down(e, part) {
      swallow = false;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!source()) return;
      pending = {
        pid: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        part,
        touch: e.pointerType === 'touch',
        armed: false,
        target: e.currentTarget as Element | null,
      };
      // Capture from the press, not from the drag's start: a 6px resize edge is
      // left behind by the very first move, which would then never reach us.
      // (Touch already has implicit capture; the click still lands on the
      // pressed element, since it holds the capture.)
      try {
        (pending.target as HTMLElement | null)?.setPointerCapture?.(pending.pid);
      } catch {
        /* the pointer may already be gone */
      }
    },
    arm() {
      if (pending && !session) pending.armed = true;
    },
    move(e) {
      if (!pending || e.pointerId !== pending.pid) return 'idle';
      if (session) {
        session.move(e.clientX, e.clientY);
        return 'dragging';
      }
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < slop) return 'pending';
      // An unheld touch that travels is a scroll/pan: let the browser have it.
      if (pending.touch && !pending.armed) {
        finish();
        return 'dropped';
      }
      const s = source()?.(pending.part, pending.x, pending.y) ?? null;
      if (!s) {
        finish();
        return 'dropped';
      }
      session = s;
      opts.onBegin?.();
      if (typeof window !== 'undefined') window.addEventListener('keydown', onKey, true);
      s.move(e.clientX, e.clientY);
      return 'dragging';
    },
    up(e) {
      if (!pending || e.pointerId !== pending.pid) return false;
      const s = session;
      finish();
      if (!s) return false;
      s.end(true);
      swallow = true;
      return true;
    },
    cancel,
    get holding() {
      return session != null || pending?.armed === true;
    },
    get dragging() {
      return session != null;
    },
    consumeClick() {
      const v = swallow;
      swallow = false;
      return v;
    },
  };
}

/**
 * Block native touch scrolling on `el` while `drag` holds the pointer. Needs a
 * non-passive listener: CSS touch-action is fixed at touchstart, before we know
 * whether the press will become a drag.
 */
export function blockTouchScroll(el: HTMLElement, drag: PointerDrag): () => void {
  const onTouchMove = (e: TouchEvent): void => {
    if (drag.holding && e.cancelable) e.preventDefault();
  };
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  return () => el.removeEventListener('touchmove', onTouchMove);
}
