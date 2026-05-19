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
});
