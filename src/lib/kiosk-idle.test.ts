import { watchIdle } from './kiosk-idle';

describe('watchIdle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the idle time, and not again until there is activity', () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    const stop = watchIdle(target, 1000, onIdle);
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(2);
    stop();
  });

  it('restarts the count on each activity', () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    const stop = watchIdle(target, 1000, onIdle);
    for (const type of ['pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
      vi.advanceTimersByTime(900);
      target.dispatchEvent(new Event(type));
    }
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it("ignores the return's own scroll right after it fires", () => {
    const target = new EventTarget();
    const onIdle = vi.fn(() => target.dispatchEvent(new Event('scroll')));
    const stop = watchIdle(target, 1000, onIdle);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(500);
    target.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops counting once torn down', () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    watchIdle(target, 1000, onIdle)();
    target.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
