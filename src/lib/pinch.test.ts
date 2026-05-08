import { describe, it, expect, vi } from 'vitest';
import { pinchZoom } from './pinch';

function pe(id: number, x: number, y: number, type: string): PointerEvent {
  const ev = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(ev, 'pointerId', { value: id });
  Object.defineProperty(ev, 'pointerType', { value: 'touch' });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  return ev;
}

describe('pinchZoom', () => {
  it('fires onZoomIn when fingers spread past the threshold', () => {
    const node = document.createElement('div');
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    pinchZoom(node, { onZoomIn, onZoomOut });

    node.dispatchEvent(pe(1, 100, 100, 'pointerdown'));
    node.dispatchEvent(pe(2, 200, 100, 'pointerdown')); // baseline 100
    node.dispatchEvent(pe(2, 250, 100, 'pointermove')); // ratio 1.5 > 1.4
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('fires onZoomOut when fingers pinch in past the inverse threshold', () => {
    const node = document.createElement('div');
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    pinchZoom(node, { onZoomIn, onZoomOut });

    node.dispatchEvent(pe(1, 100, 100, 'pointerdown'));
    node.dispatchEvent(pe(2, 300, 100, 'pointerdown')); // baseline 200
    node.dispatchEvent(pe(2, 240, 100, 'pointermove')); // 140 / 200 = 0.7 < 1/1.4
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onZoomIn).not.toHaveBeenCalled();
  });

  it('does nothing for a single-finger drag', () => {
    const node = document.createElement('div');
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    pinchZoom(node, { onZoomIn, onZoomOut });

    node.dispatchEvent(pe(1, 100, 100, 'pointerdown'));
    node.dispatchEvent(pe(1, 300, 100, 'pointermove'));
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('cleans up on destroy', () => {
    const node = document.createElement('div');
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const handle = pinchZoom(node, { onZoomIn, onZoomOut });
    handle.destroy();
    node.dispatchEvent(pe(1, 100, 100, 'pointerdown'));
    node.dispatchEvent(pe(2, 200, 100, 'pointerdown'));
    node.dispatchEvent(pe(2, 400, 100, 'pointermove'));
    expect(onZoomIn).not.toHaveBeenCalled();
  });
});
