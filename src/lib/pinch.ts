export type PinchHandlers = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  threshold?: number;
};

type Pointer = { id: number; x: number; y: number };

export function pinchZoom(node: HTMLElement, handlers: PinchHandlers): { destroy: () => void } {
  const threshold = handlers.threshold ?? 1.4;
  const pointers = new Map<number, Pointer>();
  let baselineDistance = 0;

  function dist(): number {
    if (pointers.size < 2) return 0;
    const [a, b] = [...pointers.values()];
    if (!a || !b) return 0;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
    if (pointers.size === 2) baselineDistance = dist();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && baselineDistance > 0) {
      const current = dist();
      if (current === 0) return;
      const ratio = current / baselineDistance;
      if (ratio >= threshold) {
        handlers.onZoomIn();
        baselineDistance = current;
      } else if (ratio <= 1 / threshold) {
        handlers.onZoomOut();
        baselineDistance = current;
      }
    }
  }

  function onPointerUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) baselineDistance = 0;
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerUp);

  return {
    destroy(): void {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
