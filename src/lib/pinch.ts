export type PinchHandlers = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  // A second touch landed: the gesture is a pinch from here on.
  onPinchStart?: () => void;
  // The last finger of a pinch lifted.
  onPinchEnd?: () => void;
  threshold?: number;
};

type Pointer = { id: number; x: number; y: number };

export type RatioStepper = {
  // Measure from `base` (a finger distance, or a gesture's scale).
  start: (base: number) => void;
  stop: () => void;
  // One step each time `value` crosses `threshold`× (or 1/threshold×) the
  // last base; the base then moves to `value`.
  feed: (value: number) => void;
};

export function ratioStepper(threshold: number, onIn: () => void, onOut: () => void): RatioStepper {
  let base = 0;
  return {
    start: (b) => { base = b; },
    stop: () => { base = 0; },
    feed(value) {
      if (base <= 0 || !(value > 0)) return;
      const ratio = value / base;
      if (ratio >= threshold) {
        onIn();
        base = value;
      } else if (ratio <= 1 / threshold) {
        onOut();
        base = value;
      }
    },
  };
}

export function pinchZoom(
  node: HTMLElement,
  handlers: PinchHandlers,
): { destroy: () => void; touches: () => number } {
  const stepper = ratioStepper(handlers.threshold ?? 1.4, handlers.onZoomIn, handlers.onZoomOut);
  const pointers = new Map<number, Pointer>();
  let pinching = false;

  function dist(): number {
    if (pointers.size < 2) return 0;
    const [a, b] = [...pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    // A primary touch means no other finger is down: drop any entry whose
    // pointerup never reached this node, or it would pair with this finger.
    if (e.isPrimary) pointers.clear();
    pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      stepper.start(dist());
      pinching = true;
      handlers.onPinchStart?.();
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
    if (pointers.size === 2) stepper.feed(dist());
  }

  function onPointerUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) stepper.stop();
    if (pointers.size === 0 && pinching) {
      pinching = false;
      handlers.onPinchEnd?.();
    }
  }

  // Capture phase: a control inside that stops its pointer events from
  // bubbling still counts toward the pinch.
  node.addEventListener('pointerdown', onPointerDown, true);
  node.addEventListener('pointermove', onPointerMove, true);
  node.addEventListener('pointerup', onPointerUp, true);
  node.addEventListener('pointercancel', onPointerUp, true);

  return {
    touches: () => pointers.size,
    destroy(): void {
      node.removeEventListener('pointerdown', onPointerDown, true);
      node.removeEventListener('pointermove', onPointerMove, true);
      node.removeEventListener('pointerup', onPointerUp, true);
      node.removeEventListener('pointercancel', onPointerUp, true);
    },
  };
}
