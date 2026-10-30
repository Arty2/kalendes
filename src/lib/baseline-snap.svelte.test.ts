// @vitest-environment happy-dom
import { textBaselineSnap } from './baseline-snap.svelte';

// The probe's bottom is the layout baseline; glyphs paint at it rounded to a
// whole pixel, within the scroller's content.
function stubBaseline(baseline: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'MAIN') return { top: 50 } as DOMRect;
    return { bottom: baseline } as DOMRect;
  });
}

afterEach(() => vi.restoreAllMocks());

describe('textBaselineSnap', () => {
  it('moves by the distance to the nearest whole pixel, up or down', () => {
    const text = document.body.appendChild(document.createElement('span'));
    stubBaseline(149.45);
    expect(textBaselineSnap(text)).toBeCloseTo(-0.45);
    stubBaseline(149.6);
    expect(textBaselineSnap(text)).toBeCloseTo(0.4);
    expect(text.childNodes.length).toBe(0); // the probe is gone again
  });

  it('measures within the scroller, so scrolling leaves it alone', () => {
    const main = document.body.appendChild(document.createElement('main'));
    const text = main.appendChild(document.createElement('span'));
    main.scrollTop = 0;
    stubBaseline(149.45); // 99.45 into the content
    expect(textBaselineSnap(text)).toBeCloseTo(-0.45);
  });
});
