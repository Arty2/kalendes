export type ShortcutHandler = (e: KeyboardEvent) => boolean | void;

export type Shortcuts = {
  onEnter?: ShortcutHandler;
  onSearch?: ShortcutHandler;
  onSettings?: ShortcutHandler;
  onPrevEvent?: ShortcutHandler;
  onNextEvent?: ShortcutHandler;
  onPrevRow?: ShortcutHandler;
  onNextRow?: ShortcutHandler;
  onEscape?: ShortcutHandler;
  onToggleSelect?: ShortcutHandler;
  onToggleWeek?: ShortcutHandler;
  onZoomPreset?: (key: string, e: KeyboardEvent) => boolean | void;
};

// Bare keys that jump to a zoom level or to today: '.'→1W, '1'–'5'→1M/3M/6M/1Y/2Y,
// '0'→today. Held without a modifier so Ctrl/Cmd+number (tab switching) is left alone.
const ZOOM_PRESET_KEYS = new Set(['.', '0', '1', '2', '3', '4', '5']);

export function isInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function handleShortcut(e: KeyboardEvent, s: Shortcuts): boolean {
  const inField = isInField(e.target);
  if (e.key === 'Escape') {
    if (s.onEscape && s.onEscape(e) !== false) {
      e.preventDefault();
      return true;
    }
    return false;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === '/') {
    if (s.onSearch && s.onSearch(e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  if (mod && (e.key === 'o' || e.key === 'O')) {
    if (s.onSettings && s.onSettings(e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  if (inField) return false;
  if (!mod && ZOOM_PRESET_KEYS.has(e.key)) {
    if (s.onZoomPreset && s.onZoomPreset(e.key, e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  if (e.key === 'Enter') {
    if (s.onEnter && s.onEnter(e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  if (e.key === 'ArrowLeft') {
    if (s.onPrevEvent && s.onPrevEvent(e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  if (e.key === 'ArrowRight') {
    if (s.onNextEvent && s.onNextEvent(e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  if (e.key === 'ArrowUp') {
    if (s.onPrevRow && s.onPrevRow(e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  if (e.key === 'ArrowDown') {
    if (s.onNextRow && s.onNextRow(e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  if (e.key === ' ') {
    if (s.onToggleSelect && s.onToggleSelect(e) !== false) {
      e.preventDefault();
      return true;
    }
    // With no event focused, select-toggle declines and Space instead flips
    // the 1W week view on/off (back to the last horizontal zoom).
    if (s.onToggleWeek && s.onToggleWeek(e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  return false;
}
