export type WheelZoomHandlers = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  throttleMs?: number;
};

const PINCH_DELTA_MAX = 50;
const DEFAULT_THROTTLE_MS = 180;

export function isZoomIntent(e: WheelEvent): boolean {
  if (e.shiftKey) return true;
  if (e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaY) < PINCH_DELTA_MAX) return true;
  return false;
}

export function wheelZoom(node: HTMLElement, handlers: WheelZoomHandlers): { destroy: () => void } {
  const throttleMs = handlers.throttleMs ?? DEFAULT_THROTTLE_MS;
  let lastFireMs = 0;

  function onWheel(e: WheelEvent): void {
    if (!isZoomIntent(e)) return;
    e.preventDefault();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastFireMs < throttleMs) return;
    lastFireMs = now;
    if (e.deltaY > 0) handlers.onZoomOut();
    else if (e.deltaY < 0) handlers.onZoomIn();
  }

  node.addEventListener('wheel', onWheel, { passive: false });

  return {
    destroy(): void {
      node.removeEventListener('wheel', onWheel);
    },
  };
}
