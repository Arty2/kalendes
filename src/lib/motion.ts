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
