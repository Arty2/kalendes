import { describe, it, expect, vi } from 'vitest';
import { wheelZoom, isZoomIntent } from './wheel-zoom';

function we(opts: {
  deltaY: number;
  deltaMode?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
}): WheelEvent {
  const ev = new Event('wheel', { bubbles: true, cancelable: true }) as WheelEvent;
  Object.defineProperty(ev, 'deltaY', { value: opts.deltaY });
  Object.defineProperty(ev, 'deltaX', { value: 0 });
  Object.defineProperty(ev, 'deltaMode', { value: opts.deltaMode ?? 0 });
  Object.defineProperty(ev, 'shiftKey', { value: opts.shiftKey ?? false });
  Object.defineProperty(ev, 'ctrlKey', { value: opts.ctrlKey ?? false });
  return ev;
}

describe('isZoomIntent', () => {
  it('treats Shift+Wheel as zoom', () => {
    expect(isZoomIntent(we({ shiftKey: true, deltaY: 100 }))).toBe(true);
  });

  it('treats small Ctrl+Wheel pixel deltas as touchpad pinch zoom', () => {
    expect(isZoomIntent(we({ ctrlKey: true, deltaY: 4 }))).toBe(true);
    expect(isZoomIntent(we({ ctrlKey: true, deltaY: -8 }))).toBe(true);
  });

  it('skips real keyboard Ctrl+Wheel (large pixel delta)', () => {
    expect(isZoomIntent(we({ ctrlKey: true, deltaY: 120 }))).toBe(false);
  });

  it('skips line-mode Ctrl+Wheel (keyboard-driven)', () => {
    expect(isZoomIntent(we({ ctrlKey: true, deltaY: 1, deltaMode: 1 }))).toBe(false);
  });

  it('skips a plain wheel scroll', () => {
    expect(isZoomIntent(we({ deltaY: 100 }))).toBe(false);
  });
});

describe('wheelZoom', () => {
  it('fires onZoomOut on Shift+Wheel down', () => {
    const node = document.createElement('div');
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    wheelZoom(node, { onZoomIn, onZoomOut });
    node.dispatchEvent(we({ shiftKey: true, deltaY: 100 }));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onZoomIn).not.toHaveBeenCalled();
  });

  it('fires onZoomIn on touchpad pinch (small Ctrl+Wheel up)', () => {
    const node = document.createElement('div');
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    wheelZoom(node, { onZoomIn, onZoomOut });
    node.dispatchEvent(we({ ctrlKey: true, deltaY: -4 }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('does not fire on real keyboard Ctrl+Wheel', () => {
    const node = document.createElement('div');
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    wheelZoom(node, { onZoomIn, onZoomOut });
    node.dispatchEvent(we({ ctrlKey: true, deltaY: 120 }));
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('throttles repeated shift+wheel events within the throttle window', () => {
    const node = document.createElement('div');
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    wheelZoom(node, { onZoomIn, onZoomOut, throttleMs: 200 });
    node.dispatchEvent(we({ shiftKey: true, deltaY: 100 }));
    node.dispatchEvent(we({ shiftKey: true, deltaY: 100 }));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('cleans up on destroy', () => {
    const node = document.createElement('div');
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const handle = wheelZoom(node, { onZoomIn, onZoomOut });
    handle.destroy();
    node.dispatchEvent(we({ shiftKey: true, deltaY: 100 }));
    expect(onZoomOut).not.toHaveBeenCalled();
  });
});
