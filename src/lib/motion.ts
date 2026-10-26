import { config } from './state.svelte';
import { viewport } from './viewport.svelte';

// The Reduced-motion setting, resolved: 'auto' follows the OS. Same resolution
// as App.svelte's data-motion attribute.
export function reducedMotion(): boolean {
  return config.motion === 'reduced' || (config.motion === 'auto' && viewport.prefersReducedMotion);
}

// For programmatic scrolls: an explicit behavior:'smooth' in JS overrides the
// CSS scroll-behavior the reduced-motion stylesheet forces to auto, so every
// scrollTo / scrollBy / scrollIntoView that animates must ask here.
export function smoothBehavior(): ScrollBehavior {
  return reducedMotion() ? 'auto' : 'smooth';
}

// Scroll a card into view below its section's pinned heading (a sticky
// <summary>), not under it: scroll-margin takes the heading's height plus the
// card's own breathing room, measured now since it tracks the font size.
export function scrollIntoViewBelowHeading(el: HTMLElement, block: ScrollLogicalPosition = 'start'): void {
  const heading = el.closest('details')?.querySelector<HTMLElement>(':scope > summary');
  el.style.scrollMarginTop = `calc(${heading?.offsetHeight ?? 0}px + 1em)`;
  el.scrollIntoView({ block, behavior: smoothBehavior() });
}
