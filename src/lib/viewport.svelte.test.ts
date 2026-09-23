// @vitest-environment happy-dom
import {
  viewport,
  rebindViewport,
  PORTRAIT_MOBILE_QUERY,
  LANDSCAPE_MOBILE_QUERY,
  DARK_QUERY,
  REDUCED_MOTION_QUERY,
} from './viewport.svelte';

// A controllable matchMedia: flip a query with `set` and its listeners fire.
function fakeMatchMedia(initial: Record<string, boolean> = {}) {
  const state = new Map<string, boolean>(Object.entries(initial));
  const listeners = new Map<string, Set<() => void>>();
  const mm = (query: string): MediaQueryList =>
    ({
      media: query,
      get matches() {
        return state.get(query) ?? false;
      },
      addEventListener: (_: string, fn: () => void) => {
        if (!listeners.has(query)) listeners.set(query, new Set());
        listeners.get(query)!.add(fn);
      },
      removeEventListener: (_: string, fn: () => void) => {
        listeners.get(query)?.delete(fn);
      },
    }) as unknown as MediaQueryList;
  const set = (query: string, matches: boolean): void => {
    state.set(query, matches);
    for (const fn of listeners.get(query) ?? []) fn();
  };
  const count = (): number => [...listeners.values()].reduce((n, s) => n + s.size, 0);
  return { mm, set, count };
}

afterAll(() => rebindViewport());

describe('viewport', () => {
  it('seeds from the current media state', () => {
    const f = fakeMatchMedia({ [PORTRAIT_MOBILE_QUERY]: true, [DARK_QUERY]: true });
    rebindViewport(f.mm);
    expect(viewport).toEqual({
      isPortraitMobile: true,
      isLandscapeMobile: false,
      isDesktop: false,
      prefersDark: true,
      prefersReducedMotion: false,
    });
  });

  it('follows change events, one listener per query', () => {
    const f = fakeMatchMedia();
    rebindViewport(f.mm);
    expect(f.count()).toBe(4);
    expect(viewport.isDesktop).toBe(true);

    f.set(LANDSCAPE_MOBILE_QUERY, true);
    expect(viewport.isLandscapeMobile).toBe(true);
    expect(viewport.isDesktop).toBe(false);

    f.set(LANDSCAPE_MOBILE_QUERY, false);
    expect(viewport.isDesktop).toBe(true);

    f.set(REDUCED_MOTION_QUERY, true);
    expect(viewport.prefersReducedMotion).toBe(true);
    f.set(DARK_QUERY, true);
    expect(viewport.prefersDark).toBe(true);
  });

  it('drops the old listeners on rebind', () => {
    const first = fakeMatchMedia();
    rebindViewport(first.mm);
    const second = fakeMatchMedia();
    rebindViewport(second.mm);
    expect(first.count()).toBe(0);
    first.set(DARK_QUERY, true);
    expect(viewport.prefersDark).toBe(false);
  });
});
