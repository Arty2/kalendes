import { dragStepCount, clampZoomIndex } from './zoom-drag';

describe('dragStepCount', () => {
  it('is zero below one step of travel', () => {
    expect(dragStepCount(0, 40)).toBe(0);
    expect(dragStepCount(39, 40)).toBe(0);
    expect(dragStepCount(-39, 40)).toBe(0);
  });

  it('steps one per stepPx of travel, in the drag direction', () => {
    expect(dragStepCount(40, 40)).toBe(1);
    expect(dragStepCount(-40, 40)).toBe(-1);
  });

  it('truncates toward zero (no rounding up a partial step)', () => {
    expect(dragStepCount(79, 40)).toBe(1);
    expect(dragStepCount(-79, 40)).toBe(-1);
    expect(dragStepCount(120, 40)).toBe(3);
  });

  it('is safe against a zero or negative step size', () => {
    expect(dragStepCount(200, 0)).toBe(0);
    expect(dragStepCount(200, -40)).toBe(0);
  });
});

describe('clampZoomIndex', () => {
  const TOTAL = 5;

  it('applies the step offset within range', () => {
    expect(clampZoomIndex(1, 2, TOTAL)).toBe(3);
    expect(clampZoomIndex(3, -2, TOTAL)).toBe(1);
  });

  it('clamps at the low end', () => {
    expect(clampZoomIndex(0, -1, TOTAL)).toBe(0);
    expect(clampZoomIndex(1, -5, TOTAL)).toBe(0);
  });

  it('clamps at the high end', () => {
    expect(clampZoomIndex(4, 1, TOTAL)).toBe(4);
    expect(clampZoomIndex(3, 9, TOTAL)).toBe(4);
  });
});
