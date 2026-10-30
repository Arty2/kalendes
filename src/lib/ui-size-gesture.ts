import { pinchZoom, ratioStepper } from './pinch';

// Pinch (touch), trackpad pinch and Ctrl+wheel over the toolbar, tray and
// Settings step the UI's font size instead of zooming the page. Each crossing
// of a threshold is one step, so a step's full-page reflow happens at most
// once per step, never per frame.

export type UiSizeGestureOptions = {
  onStep: (dir: 1 | -1) => void;
  // Two touches down: the surface's own one-finger gesture should stand down.
  onPinchStart?: () => void;
};

// Two-finger spread (or squeeze) per step.
export const PINCH_STEP_RATIO = 1.3;
// Ctrl+wheel distance per step, in px: one mouse notch (100px in Chrome, 3
// lines in Firefox) or a short trackpad pinch.
export const WHEEL_STEP_PX = 48;
// A pause this long starts the wheel count afresh.
export const WHEEL_IDLE_MS = 250;
const LINE_PX = 16;

// Safari's trackpad pinch: non-standard GestureEvent, not in the DOM lib.
type GestureLike = Event & { scale: number };

export function uiSizeGesture(node: HTMLElement, opts: UiSizeGestureOptions): { destroy: () => void } {
  const pinch = pinchZoom(node, {
    onZoomIn: () => opts.onStep(1),
    onZoomOut: () => opts.onStep(-1),
    onPinchStart: opts.onPinchStart,
    threshold: PINCH_STEP_RATIO,
  });

  let wheelAcc = 0;
  let lastWheelMs = 0;
  function onWheel(e: WheelEvent): void {
    // Chrome and Firefox report a trackpad pinch as Ctrl+wheel too.
    if (!e.ctrlKey) return;
    e.preventDefault();
    const now = e.timeStamp || performance.now();
    if (now - lastWheelMs > WHEEL_IDLE_MS) wheelAcc = 0;
    lastWheelMs = now;
    const px = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaMode === 2 ? e.deltaY * node.clientHeight : e.deltaY;
    wheelAcc += px;
    if (Math.abs(wheelAcc) >= WHEEL_STEP_PX) {
      // Wheel down / pinch in is smaller.
      opts.onStep(wheelAcc > 0 ? -1 : 1);
      wheelAcc = 0;
    }
  }

  // iOS Safari sends gesture events for a touch pinch as well as pointer
  // events; the pointer pinch above already steps it, so gesture events only
  // count with no touches down (a Mac trackpad).
  const gesture = ratioStepper(PINCH_STEP_RATIO, () => opts.onStep(1), () => opts.onStep(-1));
  function onGestureStart(e: Event): void {
    e.preventDefault();
    gesture.start(1);
  }
  function onGestureChange(e: Event): void {
    e.preventDefault();
    if (pinch.touches() > 0) return;
    gesture.feed((e as GestureLike).scale);
  }

  node.addEventListener('wheel', onWheel, { passive: false });
  node.addEventListener('gesturestart', onGestureStart);
  node.addEventListener('gesturechange', onGestureChange);

  return {
    destroy(): void {
      pinch.destroy();
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('gesturestart', onGestureStart);
      node.removeEventListener('gesturechange', onGestureChange);
    },
  };
}
