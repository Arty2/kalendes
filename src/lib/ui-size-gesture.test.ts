// @vitest-environment happy-dom
import { uiSizeGesture, WHEEL_STEP_PX, WHEEL_IDLE_MS } from './ui-size-gesture';

function pe(id: number, x: number, type: string): PointerEvent {
  const ev = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(ev, 'pointerId', { value: id });
  Object.defineProperty(ev, 'pointerType', { value: 'touch' });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: 100 });
  return ev;
}

function wheel(deltaY: number, timeStamp: number, opts: { ctrlKey?: boolean; deltaMode?: number } = {}): WheelEvent {
  const ev = new Event('wheel', { bubbles: true, cancelable: true }) as WheelEvent;
  Object.defineProperty(ev, 'deltaY', { value: deltaY });
  Object.defineProperty(ev, 'deltaMode', { value: opts.deltaMode ?? 0 });
  Object.defineProperty(ev, 'ctrlKey', { value: opts.ctrlKey ?? true });
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  return ev;
}

function gesture(type: string, scale: number): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'scale', { value: scale });
  return ev;
}

function setup() {
  const node = document.createElement('div');
  const onStep = vi.fn();
  const onPinchStart = vi.fn();
  const handle = uiSizeGesture(node, { onStep, onPinchStart });
  return { node, onStep, onPinchStart, handle };
}

describe('uiSizeGesture', () => {
  it('steps up on a spread and down on a squeeze, announcing the pinch', () => {
    const { node, onStep, onPinchStart } = setup();
    node.dispatchEvent(pe(1, 100, 'pointerdown'));
    node.dispatchEvent(pe(2, 200, 'pointerdown'));
    expect(onPinchStart).toHaveBeenCalledTimes(1);
    node.dispatchEvent(pe(2, 240, 'pointermove')); // 140 / 100 ≥ 1.3
    expect(onStep).toHaveBeenLastCalledWith(1);
    node.dispatchEvent(pe(2, 190, 'pointermove')); // 90 / 140 ≤ 1/1.3
    expect(onStep).toHaveBeenLastCalledWith(-1);
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it('adds Ctrl+wheel up to one step per threshold, and cancels the page zoom', () => {
    const { node, onStep } = setup();
    const first = wheel(-WHEEL_STEP_PX / 2, 0);
    node.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(onStep).not.toHaveBeenCalled();
    node.dispatchEvent(wheel(-WHEEL_STEP_PX / 2, 10));
    expect(onStep).toHaveBeenCalledWith(1);
    node.dispatchEvent(wheel(100, 20)); // one mouse notch down
    expect(onStep).toHaveBeenLastCalledWith(-1);
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it('reads line deltas as px and starts afresh after a pause', () => {
    const { node, onStep } = setup();
    node.dispatchEvent(wheel(3, 0, { deltaMode: 1 })); // Firefox notch: 48px
    expect(onStep).toHaveBeenCalledWith(-1);
    node.dispatchEvent(wheel(WHEEL_STEP_PX - 1, 100));
    node.dispatchEvent(wheel(WHEEL_STEP_PX - 1, 100 + WHEEL_IDLE_MS + 1));
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it('leaves a plain wheel to scroll', () => {
    const { node, onStep } = setup();
    const ev = wheel(200, 0, { ctrlKey: false });
    node.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("steps on Safari's trackpad gesture, but not on its touch-pinch copy", () => {
    const { node, onStep } = setup();
    node.dispatchEvent(gesture('gesturestart', 1));
    node.dispatchEvent(gesture('gesturechange', 1.35));
    expect(onStep).toHaveBeenCalledWith(1);
    node.dispatchEvent(gesture('gesturechange', 1.0)); // 1 / 1.35 ≤ 1/1.3
    expect(onStep).toHaveBeenLastCalledWith(-1);
    onStep.mockClear();
    node.dispatchEvent(pe(1, 100, 'pointerdown'));
    node.dispatchEvent(gesture('gesturestart', 1));
    node.dispatchEvent(gesture('gesturechange', 2));
    expect(onStep).not.toHaveBeenCalled();
  });

  it('stops listening once destroyed', () => {
    const { node, onStep, handle } = setup();
    handle.destroy();
    node.dispatchEvent(wheel(-200, 0));
    expect(onStep).not.toHaveBeenCalled();
  });
});

describe('uiSizeGesture stale touches', () => {
  it('a primary touch drops a finger whose pointerup was missed', () => {
    const node = document.createElement('div');
    const onStep = vi.fn();
    const onPinchStart = vi.fn();
    uiSizeGesture(node, { onStep, onPinchStart });
    node.dispatchEvent(pe(1, 100, 'pointerdown')); // its pointerup never arrives
    const next = pe(2, 300, 'pointerdown');
    Object.defineProperty(next, 'isPrimary', { value: true });
    node.dispatchEvent(next);
    expect(onPinchStart).not.toHaveBeenCalled();
    node.dispatchEvent(pe(2, 500, 'pointermove'));
    expect(onStep).not.toHaveBeenCalled();
  });
});

describe('uiSizeGesture pinch end and Safari overlap', () => {
  it('reports the end once every finger of a pinch lifts', () => {
    const node = document.createElement('div');
    const onPinchEnd = vi.fn();
    uiSizeGesture(node, { onStep: vi.fn(), onPinchEnd });
    node.dispatchEvent(pe(1, 100, 'pointerdown'));
    node.dispatchEvent(pe(2, 200, 'pointerdown'));
    node.dispatchEvent(pe(2, 200, 'pointerup'));
    expect(onPinchEnd).not.toHaveBeenCalled();
    node.dispatchEvent(pe(1, 100, 'pointerup'));
    expect(onPinchEnd).toHaveBeenCalledTimes(1);
  });

  it('sees a pinch begun on a control that stops its events from bubbling', () => {
    const node = document.createElement('div');
    const child = document.createElement('button');
    node.append(child);
    child.addEventListener('pointerdown', (e) => e.stopPropagation());
    const onPinchStart = vi.fn();
    uiSizeGesture(node, { onStep: vi.fn(), onPinchStart });
    child.dispatchEvent(pe(1, 100, 'pointerdown'));
    child.dispatchEvent(pe(2, 200, 'pointerdown'));
    expect(onPinchStart).toHaveBeenCalledTimes(1);
  });

  it('ignores Ctrl+wheel while Safari gesture events step the pinch', () => {
    const { node, onStep } = setup();
    node.dispatchEvent(gesture('gesturestart', 1));
    node.dispatchEvent(wheel(-200, 0));
    expect(onStep).not.toHaveBeenCalled();
    node.dispatchEvent(gesture('gestureend', 1));
    node.dispatchEvent(wheel(-200, 10));
    expect(onStep).toHaveBeenCalledWith(1);
  });
});
