export type ShortcutHandler = (e: KeyboardEvent) => boolean | void;

export type Shortcuts = {
  // Plain Enter: open the focused event (or a dialog's primary action).
  onEnter?: ShortcutHandler;
  // Ctrl/⌘+Enter: select the focused event (multi-select).
  onSelect?: ShortcutHandler;
  onSearch?: ShortcutHandler;
  onSettings?: ShortcutHandler;
  onPrevEvent?: ShortcutHandler;
  onNextEvent?: ShortcutHandler;
  onPrevRow?: ShortcutHandler;
  onNextRow?: ShortcutHandler;
  onEscape?: ShortcutHandler;
  // Space: single tap toggles 1W, double tap jumps to today — the caller owns
  // the tap timing, so it just receives the raw press here.
  onSpace?: ShortcutHandler;
  onZoomPreset?: (key: string, e: KeyboardEvent) => boolean | void;
};

// Bare keys that jump to a zoom level or to today: '.'→1W, '1'–'5'→1M/3M/6M/1Y/2Y,
// '0'→today. Held without a modifier so Ctrl/Cmd+number (tab switching) is left alone.
const ZOOM_PRESET_KEYS = new Set(['.', '0', '1', '2', '3', '4', '5']);

// The user-facing catalogue of the shortcuts wired below, rendered by the
// long-press-search shortcuts modal. Colocated with handleShortcut so the two
// stay in step when a binding changes.
export const KEYBOARD_SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl/⌘', '/'], label: 'Toggle search' },
  { keys: ['Ctrl/⌘', ','], label: 'Open / close settings' },
  { keys: ['1', '…', '5'], label: 'Zoom to 1M / 3M / 6M / 1Y / 2Y' },
  { keys: ['.'], label: '1W week view' },
  { keys: ['0'], label: 'Jump to today' },
  { keys: ['←', '→'], label: 'Previous / next event (day, or paging in a dialog)' },
  { keys: ['↑', '↓'], label: 'Adjacent calendar lane (within the day in 1W)' },
  { keys: ['Space'], label: 'Toggle 1W week view; double-tap to jump to today' },
  { keys: ['Enter'], label: 'Open the focused event; in a dialog, its primary action' },
  { keys: ['Ctrl/⌘', 'Enter'], label: 'Select the focused event' },
  { keys: ['Esc'], label: 'Close the topmost layer, then clear the selection' },
];

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
  if (mod && e.key === ',') {
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
    // Ctrl/⌘+Enter selects the focused event; plain Enter opens it (or, when a
    // dialog is open, the caller returns false so the dialog's own Enter wins).
    if (mod) {
      if (s.onSelect && s.onSelect(e) !== false) {
        e.preventDefault();
        return true;
      }
      return false;
    }
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
    // Auto-repeat while the key is held shouldn't machine-gun the toggle or read
    // as a double-tap, so swallow repeats as handled no-ops.
    if (e.repeat) {
      e.preventDefault();
      return true;
    }
    if (s.onSpace && s.onSpace(e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  return false;
}
