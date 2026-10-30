export type PinchHandlers = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  // A second touch landed: the gesture is a pinch from here on.
  onPinchStart?: () => void;
  // The last finger of a pinch lifted.
  onPinchEnd?: () => void;
  threshold?: number;
  // Hear touches in the capture phase, so a control inside that stops its
  // pointer events from bubbling still counts (the UI-size surfaces). Off for
  // the timeline, whose marker line stops propagation to stay out of gestures.
  capture?: boolean;
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
    // A primary touch means no other finger is down: drop any entry (and pinch)
    // left by a lift this instance never heard, or it would pair with this finger.
    if (e.isPrimary) {
      pointers.clear();
      pinching = false;
    }
    if (pointers.size === 0) track(true);
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
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) stepper.stop();
    if (pointers.size > 0) return;
    track(false);
    if (pinching) {
      pinching = false;
      handlers.onPinchEnd?.();
    }
  }

  // A tracked finger's moves and lift are heard on the window, wherever they
  // land — off the node, or after a capture there was released — so none is
  // left behind. Attached only while a finger is down.
  function track(on: boolean): void {
    if (on) {
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerUp, true);
    } else {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
    }
  }

  const capture = handlers.capture ?? false;
  node.addEventListener('pointerdown', onPointerDown, capture);

  return {
    touches: () => pointers.size,
    destroy(): void {
      node.removeEventListener('pointerdown', onPointerDown, capture);
      if (pointers.size > 0) track(false);
      pointers.clear();
    },
  };
}
