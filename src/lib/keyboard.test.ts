import { describe, it, expect, vi } from 'vitest';
import { handleShortcut } from './keyboard';

function key(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, cancelable: true, ...init });
}

describe('handleShortcut', () => {
  it('plain Enter triggers onEnter (open focused), not onSelect', () => {
    const onEnter = vi.fn();
    const onSelect = vi.fn();
    handleShortcut(key('Enter'), { onEnter, onSelect });
    expect(onEnter).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Shift+Enter triggers onSelect (select), not onEnter', () => {
    const onEnter = vi.fn();
    const onSelect = vi.fn();
    const e = key('Enter', { shiftKey: true });
    const handled = handleShortcut(e, { onEnter, onSelect });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onEnter).not.toHaveBeenCalled();
    expect(handled).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Ctrl/⌘+Enter no longer selects or opens', () => {
    const onEnter = vi.fn();
    const onSelect = vi.fn();
    handleShortcut(key('Enter', { ctrlKey: true }), { onEnter, onSelect });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('Ctrl+/ triggers onSearch', () => {
    const onSearch = vi.fn();
    handleShortcut(key('/', { ctrlKey: true }), { onSearch });
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('Cmd+, triggers onSettings', () => {
    const onSettings = vi.fn();
    handleShortcut(key(',', { metaKey: true }), { onSettings });
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

  it('Space triggers onSpace and preventDefaults', () => {
    const onSpace = vi.fn();
    const e = key(' ');
    const handled = handleShortcut(e, { onSpace });
    expect(onSpace).toHaveBeenCalledOnce();
    expect(handled).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Shift+Space triggers onCycleMarker, not onSpace', () => {
    const onCycleMarker = vi.fn();
    const onSpace = vi.fn();
    const e = key(' ', { shiftKey: true });
    const handled = handleShortcut(e, { onCycleMarker, onSpace });
    expect(onCycleMarker).toHaveBeenCalledOnce();
    expect(onSpace).not.toHaveBeenCalled();
    expect(handled).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  it('plain Space does not trigger onCycleMarker', () => {
    const onCycleMarker = vi.fn();
    const onSpace = vi.fn();
    handleShortcut(key(' '), { onCycleMarker, onSpace });
    expect(onCycleMarker).not.toHaveBeenCalled();
    expect(onSpace).toHaveBeenCalledOnce();
  });

  it('Space is ignored when focus is in an input', () => {
    const onSpace = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const e = key(' ');
    Object.defineProperty(e, 'target', { value: input });
    handleShortcut(e, { onSpace });
    expect(onSpace).not.toHaveBeenCalled();
    input.remove();
  });

  it('held Space (auto-repeat) is swallowed without re-firing onSpace', () => {
    const onSpace = vi.fn();
    const e = key(' ', { repeat: true });
    const handled = handleShortcut(e, { onSpace });
    expect(onSpace).not.toHaveBeenCalled();
    expect(handled).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  it('bare Google-Calendar keys route to their handlers', () => {
    const handlers = {
      onHelp: vi.fn(), onSearch: vi.fn(), onSettings: vi.fn(), onCreate: vi.fn(),
      onNextPage: vi.fn(), onPrevPage: vi.fn(), onRefresh: vi.fn(), onDelete: vi.fn(),
    };
    const cases: [string, keyof typeof handlers][] = [
      ['?', 'onHelp'],
      ['/', 'onSearch'],
      ['s', 'onSettings'],
      ['c', 'onCreate'],
      ['n', 'onNextPage'],
      ['j', 'onNextPage'],
      ['p', 'onPrevPage'],
      ['k', 'onPrevPage'],
      ['r', 'onRefresh'],
      ['#', 'onDelete'],
      ['Delete', 'onDelete'],
      ['Backspace', 'onDelete'],
    ];
    for (const [k, name] of cases) {
      const e = key(k);
      const handled = handleShortcut(e, { [name]: handlers[name] });
      expect(handlers[name], `key ${k}`).toHaveBeenCalled();
      expect(handled, `key ${k}`).toBe(true);
      expect(e.defaultPrevented, `key ${k}`).toBe(true);
    }
  });

  it('bare keys are ignored when focus is in an input', () => {
    const onCreate = vi.fn();
    const onSearch = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    for (const k of ['c', '/']) {
      const e = key(k);
      Object.defineProperty(e, 'target', { value: input });
      handleShortcut(e, { onCreate, onSearch });
    }
    expect(onCreate).not.toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
    input.remove();
  });

  it('Ctrl/⌘+R does NOT trigger onRefresh (browser reload preserved)', () => {
    const onRefresh = vi.fn();
    const e = key('r', { ctrlKey: true });
    const handled = handleShortcut(e, { onRefresh });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(handled).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });

  it('a declined onDelete leaves the key unhandled (e.g. a feed event)', () => {
    const onDelete = vi.fn(() => false);
    const e = key('Delete');
    const handled = handleShortcut(e, { onDelete });
    expect(onDelete).toHaveBeenCalledOnce();
    expect(handled).toBe(false);
    expect(e.defaultPrevented).toBe(false);
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
