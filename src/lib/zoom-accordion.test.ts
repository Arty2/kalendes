import { fitCount, slideWindow } from './zoom-accordion';

describe('fitCount', () => {
  // 5 buttons of 40px, slivers of 8px — the toolbar's real shape.
  const B = 40;
  const S = 8;

  it('returns total when everything fits exactly', () => {
    expect(fitCount(5 * B, B, S, 5)).toBe(5);
  });

  it('drops to total-1 when one px short of a full fit', () => {
    expect(fitCount(5 * B - 1, B, S, 5)).toBe(4);
  });

  it('accounts for sliver width of the collapsed buttons', () => {
    // 4 expanded + 1 sliver = 168px: exact fit keeps 4, one px less keeps 3.
    expect(fitCount(4 * B + S, B, S, 5)).toBe(4);
    expect(fitCount(4 * B + S - 1, B, S, 5)).toBe(3);
  });

  it('never returns less than 1, even with no room at all', () => {
    expect(fitCount(0, B, S, 5)).toBe(1);
    expect(fitCount(-100, B, S, 5)).toBe(1);
  });

  it('returns total for a generous budget', () => {
    expect(fitCount(10_000, B, S, 5)).toBe(5);
  });
});

describe('slideWindow', () => {
  const TOTAL = 5;

  it('keeps the window still while the active index is inside it', () => {
    expect(slideWindow(1, 1, 3, TOTAL)).toBe(1);
    expect(slideWindow(1, 2, 3, TOTAL)).toBe(1);
    expect(slideWindow(1, 3, 3, TOTAL)).toBe(1);
  });

  it('slides minimally left when the active index is left of the window', () => {
    expect(slideWindow(2, 1, 3, TOTAL)).toBe(1);
    expect(slideWindow(2, 0, 3, TOTAL)).toBe(0);
  });

  it('slides minimally right when the active index is right of the window', () => {
    expect(slideWindow(0, 3, 3, TOTAL)).toBe(1);
    expect(slideWindow(0, 4, 3, TOTAL)).toBe(2);
  });

  it('clamps prevStart when the window grows', () => {
    // Window was [3..4] (count 2); growing to count 4 must pull start back.
    expect(slideWindow(3, 4, 4, TOTAL)).toBe(1);
  });

  it('re-anchors on the active index when the window shrinks past it', () => {
    // Window was [0..3]; shrinking to count 2 with active at 3 slides to [2..3].
    expect(slideWindow(0, 3, 2, TOTAL)).toBe(2);
  });

  it('is always 0 when everything is expanded', () => {
    expect(slideWindow(3, 4, TOTAL, TOTAL)).toBe(0);
  });

  it('pins to the active index when only one button fits', () => {
    expect(slideWindow(0, 3, 1, TOTAL)).toBe(3);
    expect(slideWindow(4, 0, 1, TOTAL)).toBe(0);
  });

  it('matches the spec examples: count 4 collapses the far edge', () => {
    // Active 1M → [ 1M ][ 3M ][ 6M ][ 1Y ]] (2Y sliver).
    expect(slideWindow(0, 0, 4, TOTAL)).toBe(0);
    // Active 2Y → [[ 3M ][ 6M ][ 1Y ][ 2Y ] (1M sliver).
    expect(slideWindow(0, 4, 4, TOTAL)).toBe(1);
  });
});
