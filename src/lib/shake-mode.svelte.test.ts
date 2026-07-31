import { config, ui, rollShake, shakeArmed, displayPalette, displayScheme } from './state.svelte';
import { PALETTE_FLAVORS } from './types';

// The 'shake' Flavor/Scheme modes: config stores the mode, ui holds the rolled
// value for the session. These cover the arm/roll/clear/resolve contract that
// App.svelte's effects depend on.
beforeEach(() => {
  config.palette = 'pepper';
  config.scheme = 'auto';
  ui.shakePalette = null;
  ui.shakeScheme = null;
});

describe('shakeArmed', () => {
  it('is false while both axes hold a concrete value', () => {
    config.palette = 'juniper';
    config.scheme = 'dark';
    expect(shakeArmed()).toBe(false);
  });

  it('is true when either axis is in shake mode', () => {
    config.palette = 'shake';
    expect(shakeArmed()).toBe(true);
    config.palette = 'pepper';
    config.scheme = 'shake';
    expect(shakeArmed()).toBe(true);
  });
});

describe('rollShake', () => {
  it('arms an unrolled axis so the mode has something to render', () => {
    config.palette = 'shake';
    expect(rollShake()).toBe(true);
    expect(PALETTE_FLAVORS).toContain(ui.shakePalette);
  });

  it('leaves an already-rolled axis alone unless forced', () => {
    config.palette = 'shake';
    rollShake();
    const first = ui.shakePalette;
    expect(rollShake()).toBe(false);
    expect(ui.shakePalette).toBe(first);
  });

  it('re-rolls to a different value when forced, so a shake always shows', () => {
    config.palette = 'shake';
    rollShake();
    for (let i = 0; i < 20; i++) {
      const before = ui.shakePalette;
      expect(rollShake(true)).toBe(true);
      expect(ui.shakePalette).not.toBe(before);
    }
  });

  it('never touches an axis holding an explicit choice', () => {
    config.palette = 'sage';
    config.scheme = 'dark';
    expect(rollShake(true)).toBe(false);
    expect(config.palette).toBe('sage');
    expect(config.scheme).toBe('dark');
    expect(ui.shakePalette).toBeNull();
    expect(ui.shakeScheme).toBeNull();
  });

  it('clears the roll when the mode is switched away, so re-arming re-rolls', () => {
    config.palette = 'shake';
    rollShake();
    expect(ui.shakePalette).not.toBeNull();
    config.palette = 'rose';
    rollShake();
    expect(ui.shakePalette).toBeNull();
  });

  it('rolls the two axes independently', () => {
    config.scheme = 'shake';
    rollShake();
    expect(ui.shakeScheme).not.toBeNull();
    expect(ui.shakePalette).toBeNull();
  });

  it('never writes the mode back into config — the mode has to survive reload', () => {
    config.palette = 'shake';
    config.scheme = 'shake';
    rollShake(true);
    expect(config.palette).toBe('shake');
    expect(config.scheme).toBe('shake');
  });
});

describe('displayPalette / displayScheme', () => {
  it('passes a concrete choice straight through', () => {
    config.palette = 'cinnamon';
    config.scheme = 'light';
    expect(displayPalette()).toBe('cinnamon');
    expect(displayScheme(true)).toBe('light');
  });

  it('resolves auto against the OS preference', () => {
    config.scheme = 'auto';
    expect(displayScheme(true)).toBe('dark');
    expect(displayScheme(false)).toBe('light');
  });

  it('resolves shake to the current roll', () => {
    config.palette = 'shake';
    config.scheme = 'shake';
    ui.shakePalette = 'bergamot';
    ui.shakeScheme = 'dark';
    expect(displayPalette()).toBe('bergamot');
    // The roll wins over the OS preference.
    expect(displayScheme(false)).toBe('dark');
  });

  it('never leaks the mode itself to the DOM before a roll lands', () => {
    config.palette = 'shake';
    config.scheme = 'shake';
    expect(displayPalette()).toBe('pepper');
    expect(displayScheme(true)).toBe('dark');
    expect(displayScheme(false)).toBe('light');
  });
});
