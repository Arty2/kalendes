// Chrome paints a line of text with its baseline rounded to the nearest whole CSS
// pixel, while a box beside it (an icon) paints at its exact fractional offset — so
// an icon placed against the layout's baseline can sit up to half a pixel off the
// glyphs actually drawn. textBaselineSnap says how far the text was moved, for the
// box to move the same way. The rounding is measured within the scroller's content
// (a scrolled layer paints relative to its own origin), so scrolling doesn't change it.

/** Pixels (−0.5…0.5) from `text`'s layout baseline to where its glyphs paint. */
export function textBaselineSnap(text: HTMLElement): number {
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0';
  text.appendChild(probe);
  let baseline = probe.getBoundingClientRect().bottom;
  probe.remove();
  const scroller = text.closest('main');
  if (scroller) baseline += scroller.scrollTop - scroller.getBoundingClientRect().top;
  return Math.round(baseline) - baseline;
}

// Bumped whenever a measured baseline may have moved: a web font finished loading,
// or the rows' container changed size (a row above grew, the font size changed).
// One observer and one font listener, however many rows read it.
export const textLayout = $state({ rev: 0 });
let watched: Element | null = null;
let observer: ResizeObserver | null = null;
let fontsHooked = false;

export function watchTextLayout(container: Element | null): void {
  if (typeof window === 'undefined' || !container || container === watched) return;
  const bump = (): void => {
    textLayout.rev++;
  };
  if (!fontsHooked && document.fonts) {
    document.fonts.addEventListener('loadingdone', bump);
    fontsHooked = true;
  }
  if (typeof ResizeObserver === 'undefined') return;
  observer ??= new ResizeObserver(bump);
  if (watched) observer.unobserve(watched);
  observer.observe(container);
  watched = container;
}
