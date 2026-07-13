import { describe, it, expect, vi } from 'vitest';
import { handleShortcut } from './keyboard';

function key(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, cancelable: true, ...init });
}

describe('handleShortcut', () => {
  it('Enter triggers onEnter', () => {
    const onEnter = vi.fn();
    handleShortcut(key('Enter'), { onEnter });
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it('Ctrl+/ triggers onSearch', () => {
    const onSearch = vi.fn();
    handleShortcut(key('/', { ctrlKey: true }), { onSearch });
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('Cmd+O triggers onSettings', () => {
    const onSettings = vi.fn();
    handleShortcut(key('o', { metaKey: true }), { onSettings });
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it('arrows trigger event/row handlers', () => {
    const handlers = {
      onPrevEvent: vi.fn(),
      onNextEvent: vi.fn(),
      onPrevRow: vi.fn(),
      onNextRow: vi.fn(),
    };
    handleShortcut(key('ArrowLeft'), handlers);
    handleShortcut(key('ArrowRight'), handlers);
    handleShortcut(key('ArrowUp'), handlers);
    handleShortcut(key('ArrowDown'), handlers);
    expect(handlers.onPrevEvent).toHaveBeenCalledOnce();
    expect(handlers.onNextEvent).toHaveBeenCalledOnce();
    expect(handlers.onPrevRow).toHaveBeenCalledOnce();
    expect(handlers.onNextRow).toHaveBeenCalledOnce();
  });

  it('Escape triggers onEscape even when focus is in an input', () => {
    const onEscape = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const e = key('Escape');
    Object.defineProperty(e, 'target', { value: input });
    handleShortcut(e, { onEscape });
    expect(onEscape).toHaveBeenCalledOnce();
    input.remove();
  });

  it('ignores plain Enter when focus is in an input', () => {
    const onEnter = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const e = key('Enter');
    Object.defineProperty(e, 'target', { value: input });
    handleShortcut(e, { onEnter });
    expect(onEnter).not.toHaveBeenCalled();
    input.remove();
  });

  it('Ctrl+/ still works inside an input', () => {
    const onSearch = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const e = key('/', { ctrlKey: true });
    Object.defineProperty(e, 'target', { value: input });
    handleShortcut(e, { onSearch });
    expect(onSearch).toHaveBeenCalledOnce();
    input.remove();
  });

  it('Space triggers onToggleSelect and preventDefaults', () => {
    const onToggleSelect = vi.fn();
    const e = key(' ');
    const handled = handleShortcut(e, { onToggleSelect });
    expect(onToggleSelect).toHaveBeenCalledOnce();
    expect(handled).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Space is ignored when focus is in an input', () => {
    const onToggleSelect = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const e = key(' ');
    Object.defineProperty(e, 'target', { value: input });
    handleShortcut(e, { onToggleSelect });
    expect(onToggleSelect).not.toHaveBeenCalled();
    input.remove();
  });

  it('Space falls through to onToggleWeek when select-toggle declines', () => {
    const onToggleSelect = vi.fn(() => false);
    const onToggleWeek = vi.fn();
    const e = key(' ');
    const handled = handleShortcut(e, { onToggleSelect, onToggleWeek });
    expect(onToggleSelect).toHaveBeenCalledOnce();
    expect(onToggleWeek).toHaveBeenCalledOnce();
    expect(handled).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Space does not reach onToggleWeek when an event was toggled', () => {
    const onToggleWeek = vi.fn();
    handleShortcut(key(' '), { onToggleSelect: vi.fn(), onToggleWeek });
    expect(onToggleWeek).not.toHaveBeenCalled();
  });

  it('zoom-preset keys trigger onZoomPreset and preventDefault', () => {
    for (const k of ['.', '0', '1', '2', '3', '4', '5']) {
      const onZoomPreset = vi.fn();
      const e = key(k);
      const handled = handleShortcut(e, { onZoomPreset });
      expect(onZoomPreset, `key ${k}`).toHaveBeenCalledWith(k, e);
      expect(handled, `key ${k}`).toBe(true);
      expect(e.defaultPrevented, `key ${k}`).toBe(true);
    }
  });

  it('zoom-preset does not fire when focus is in an input', () => {
    const onZoomPreset = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const e = key('1');
    Object.defineProperty(e, 'target', { value: input });
    handleShortcut(e, { onZoomPreset });
    expect(onZoomPreset).not.toHaveBeenCalled();
    input.remove();
  });

  it('zoom-preset does not fire with a modifier held', () => {
    const onZoomPreset = vi.fn();
    handleShortcut(key('1', { ctrlKey: true }), { onZoomPreset });
    handleShortcut(key('1', { metaKey: true }), { onZoomPreset });
    expect(onZoomPreset).not.toHaveBeenCalled();
  });

  it('zoom-preset can decline, leaving the event unhandled', () => {
    const onZoomPreset = vi.fn(() => false);
    const e = key('1');
    const handled = handleShortcut(e, { onZoomPreset });
    expect(onZoomPreset).toHaveBeenCalledOnce();
    expect(handled).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });
});
