// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { pinchZoom } from './pinch';

function pe(id: number, x: number, y: number, type: string): PointerEvent {
  const ev = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(ev, 'pointerId', { value: id });
  Object.defineProperty(ev, 'pointerType', { value: 'touch' });
  // The first finger down is the primary one, as in a browser.
  Object.defineProperty(ev, 'isPrimary', { value: id === 1 });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  return ev;
}

describe('pinchZoom', () => {
  it('fires onZoomIn when fingers spread past the threshold', () => {
    const node = document.body.appendChild(document.createElement('div'));
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
    const node = document.body.appendChild(document.createElement('div'));
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
    const node = document.body.appendChild(document.createElement('div'));
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    pinchZoom(node, { onZoomIn, onZoomOut });

    node.dispatchEvent(pe(1, 100, 100, 'pointerdown'));
    node.dispatchEvent(pe(1, 300, 100, 'pointermove'));
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('cleans up on destroy', () => {
    const node = document.body.appendChild(document.createElement('div'));
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

describe('pinchZoom tracking', () => {
  it('hears a lift that lands off the node, ending the pinch', () => {
    const node = document.body.appendChild(document.createElement('div'));
    const onPinchEnd = vi.fn();
    pinchZoom(node, { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onPinchEnd });
    node.dispatchEvent(pe(1, 100, 100, 'pointerdown'));
    node.dispatchEvent(pe(2, 200, 100, 'pointerdown'));
    document.body.dispatchEvent(pe(1, 100, 100, 'pointerup'));
    document.body.dispatchEvent(pe(2, 200, 100, 'pointerup'));
    expect(onPinchEnd).toHaveBeenCalledTimes(1);
  });

  it('a new primary touch drops a stale pinch without ending it later', () => {
    const node = document.body.appendChild(document.createElement('div'));
    const onPinchEnd = vi.fn();
    pinchZoom(node, { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onPinchEnd });
    node.dispatchEvent(pe(1, 100, 100, 'pointerdown'));
    node.dispatchEvent(pe(2, 200, 100, 'pointerdown')); // their lifts are never heard
    node.dispatchEvent(pe(1, 100, 100, 'pointerdown')); // a fresh single tap
    node.dispatchEvent(pe(1, 100, 100, 'pointerup'));
    expect(onPinchEnd).not.toHaveBeenCalled();
  });

  it('leaves out touches a child keeps to itself unless asked to capture', () => {
    const node = document.body.appendChild(document.createElement('div'));
    const child = node.appendChild(document.createElement('span'));
    child.addEventListener('pointerdown', (e) => e.stopPropagation());
    const onPinchStart = vi.fn();
    pinchZoom(node, { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onPinchStart });
    child.dispatchEvent(pe(1, 100, 100, 'pointerdown'));
    node.dispatchEvent(pe(2, 200, 100, 'pointerdown'));
    expect(onPinchStart).not.toHaveBeenCalled();
  });
});
