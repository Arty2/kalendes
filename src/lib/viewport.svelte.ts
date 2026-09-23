// The one reactive read of the viewport media queries. Components read
// `viewport.*` instead of re-declaring matchMedia, so the breakpoints live in
// one place and each query has a single listener for the whole app.
//
// These are the raw device facts only: the `motion` / `scheme` / `spacing` /
// `traySide` settings that override them are resolved where they always were
// (App.svelte, drag-reorder, the settings labels).

/** Phone held upright: portrait and at most this wide. */
export const PORTRAIT_MOBILE_MAX = 640;
/** Phone on its side: landscape and at most this wide. */
export const LANDSCAPE_MOBILE_MAX = 900;

export const PORTRAIT_MOBILE_QUERY = `(orientation: portrait) and (max-width: ${PORTRAIT_MOBILE_MAX}px)`;
export const LANDSCAPE_MOBILE_QUERY = `(orientation: landscape) and (max-width: ${LANDSCAPE_MOBILE_MAX}px)`;
export const DARK_QUERY = '(prefers-color-scheme: dark)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export interface Viewport {
  isPortraitMobile: boolean;
  isLandscapeMobile: boolean;
  /** Neither phone query matches. */
  isDesktop: boolean;
  prefersDark: boolean;
  prefersReducedMotion: boolean;
}

export const viewport = $state<Viewport>({
  isPortraitMobile: false,
  isLandscapeMobile: false,
  isDesktop: true,
  prefersDark: false,
  prefersReducedMotion: false,
});

type MatchMedia = (query: string) => MediaQueryList;

/**
 * Attach one listener per query and seed `viewport` from their current state.
 * Runs once at import; tests call it again with a fake `matchMedia`. Returns a
 * function that detaches the listeners. Without `matchMedia` (SSR, node tests)
 * the defaults above stand: a desktop with no OS preferences.
 */
function bindViewport(
  mm: MatchMedia | undefined = typeof matchMedia === 'undefined' ? undefined : matchMedia,
): () => void {
  if (!mm) return () => {};
  const portrait = mm(PORTRAIT_MOBILE_QUERY);
  const landscape = mm(LANDSCAPE_MOBILE_QUERY);
  const dark = mm(DARK_QUERY);
  const reduced = mm(REDUCED_MOTION_QUERY);
  const update = (): void => {
    viewport.isPortraitMobile = portrait.matches;
    viewport.isLandscapeMobile = landscape.matches;
    viewport.isDesktop = !portrait.matches && !landscape.matches;
    viewport.prefersDark = dark.matches;
    viewport.prefersReducedMotion = reduced.matches;
  };
  update();
  const lists = [portrait, landscape, dark, reduced];
  for (const l of lists) l.addEventListener('change', update);
  return () => {
    for (const l of lists) l.removeEventListener('change', update);
  };
}

let unbind = bindViewport();

/** Test hook: rebind against a (fake) matchMedia, dropping the previous listeners. */
export function rebindViewport(mm?: MatchMedia): void {
  unbind();
  unbind = bindViewport(mm);
}
