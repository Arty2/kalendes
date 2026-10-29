// @vitest-environment happy-dom
import { clearKioskHome, readKioskHome, saveKioskHome, watchIdle } from './kiosk-idle';
import type { KioskHome } from './types';

describe('watchIdle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for a first activity, so an untouched screen keeps what it shows', () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    const stop = watchIdle(target, 1000, onIdle);
    vi.advanceTimersByTime(10_000);
    expect(onIdle).not.toHaveBeenCalled();
    stop();
  });

  it('fires once per idle spell', () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    const stop = watchIdle(target, 1000, onIdle);
    target.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(2);
    stop();
  });

  it('counts from the last activity', () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    const stop = watchIdle(target, 1000, onIdle);
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
      target.dispatchEvent(new Event(type));
      vi.advanceTimersByTime(900);
    }
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it("doesn't count the app's own scrolling", () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    const stop = watchIdle(target, 1000, onIdle);
    target.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(900);
    target.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(100);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops counting once torn down', () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    const stop = watchIdle(target, 1000, onIdle);
    target.dispatchEvent(new Event('pointerdown'));
    stop();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});

describe('kiosk home', () => {
  const home: KioskHome = {
    pin: 'p1.a',
    zoom: 'quarter',
    lastNonWeek: 'quarter',
    markerMs: null,
    markerEndMs: null,
    collapsed: { work: true },
  };
  afterEach(() => clearKioskHome());

  it('reads back the home saved for the same lock only', () => {
    saveKioskHome(home);
    expect(readKioskHome('p1.a')).toEqual(home);
    expect(readKioskHome('p1.b')).toBeNull();
    clearKioskHome();
    expect(readKioskHome('p1.a')).toBeNull();
  });

  it('reads nothing from damaged storage', () => {
    sessionStorage.setItem('calendar-timeline:kiosk-home', '{');
    expect(readKioskHome('p1.a')).toBeNull();
  });
});
