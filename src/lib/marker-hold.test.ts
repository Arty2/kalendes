import { createDayHold, HOLD_SLOP_PX } from './marker-hold';

const DAY = 24 * 60 * 60 * 1000;
const d = (n: number): number => Date.UTC(2026, 4, n);
const FAR = HOLD_SLOP_PX + 5;

describe('createDayHold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arms after the hold window when the pointer never moves', () => {
    const onArm = vi.fn();
    const hold = createDayHold(500);
    hold.start(d(1), 100, onArm);
    vi.advanceTimersByTime(499);
    expect(onArm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('keeps running while the pointer drifts inside the same day', () => {
    const onArm = vi.fn();
    const hold = createDayHold(500);
    hold.start(d(1), 100, onArm);
    for (let t = 0; t < 500; t += 50) {
      vi.advanceTimersByTime(50);
      hold.move(d(1), 100 + (t % 100 ? 2 : -2));
    }
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('survives wobble across a day boundary — the start line sits on one', () => {
    // The regression that pixel slop exists for: the marker line is drawn at a
    // day boundary, so ±3px of trackpad drift alternates days every move. Without
    // the slop each of those restarted the clock and the hold never landed.
    const onArm = vi.fn();
    const hold = createDayHold(500);
    hold.start(d(2), 100, onArm);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(50);
      hold.move(i % 2 ? d(1) : d(2), 100 + (i % 2 ? -3 : 3));
    }
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('restarts against the new day when the pointer deliberately moves there', () => {
    const onArm = vi.fn();
    const hold = createDayHold(500);
    hold.start(d(1), 100, onArm);
    vi.advanceTimersByTime(400);
    hold.move(d(3), 100 + FAR);
    // The original deadline passes without arming — the clock restarted.
    vi.advanceTimersByTime(100);
    expect(onArm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('does not re-arm once armed, however far the pointer then travels', () => {
    const onArm = vi.fn();
    const hold = createDayHold(500);
    hold.start(d(1), 100, onArm);
    vi.advanceTimersByTime(500);
    expect(onArm).toHaveBeenCalledTimes(1);
    hold.move(d(4), 100 + 10 * FAR);
    vi.advanceTimersByTime(2000);
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('never arms after cancel', () => {
    const onArm = vi.fn();
    const hold = createDayHold(500);
    hold.start(d(1), 100, onArm);
    vi.advanceTimersByTime(400);
    hold.cancel();
    vi.advanceTimersByTime(1000);
    hold.move(d(2), 100 + FAR);
    vi.advanceTimersByTime(1000);
    expect(onArm).not.toHaveBeenCalled();
  });

  it('reports didArm once, then resets', () => {
    const hold = createDayHold(500);
    hold.start(d(1), 100, () => {});
    vi.advanceTimersByTime(500);
    hold.cancel();
    expect(hold.didArm()).toBe(true);
    expect(hold.didArm()).toBe(false);
  });

  it('reports didArm false for a release that never armed', () => {
    const hold = createDayHold(500);
    hold.start(d(1), 100, () => {});
    vi.advanceTimersByTime(200);
    hold.cancel();
    expect(hold.didArm()).toBe(false);
  });

  it('needs BOTH a new day and real travel to restart', () => {
    // Travel far without leaving the day: no restart, so the original deadline
    // still arms on time.
    const onArm = vi.fn();
    const hold = createDayHold(500);
    hold.start(d(1), 100, onArm);
    vi.advanceTimersByTime(400);
    hold.move(d(1), 100 + 10 * FAR);
    vi.advanceTimersByTime(100);
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('measures days, not milliseconds — adjacent UTC days are distinct', () => {
    const onArm = vi.fn();
    const hold = createDayHold(500);
    hold.start(d(1), 100, onArm);
    vi.advanceTimersByTime(499);
    hold.move(d(1) + DAY, 100 + FAR);
    vi.advanceTimersByTime(499);
    expect(onArm).not.toHaveBeenCalled();
  });
});
