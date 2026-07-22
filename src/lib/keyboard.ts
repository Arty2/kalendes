export type ShortcutHandler = (e: KeyboardEvent) => boolean | void;

export type Shortcuts = {
  // Plain Enter: open the focused event (or a dialog's primary action).
  onEnter?: ShortcutHandler;
  // Shift+Enter: select the focused event (multi-select).
  onSelect?: ShortcutHandler;
  // Search: Ctrl/⌘+/ or a bare '/' (Google Calendar).
  onSearch?: ShortcutHandler;
  // Settings: Ctrl/⌘+, or a bare 's' (Google Calendar).
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
  // Google-Calendar-style single keys (bare, no Ctrl/⌘/Alt).
  onHelp?: ShortcutHandler; // '?'  — keyboard-shortcuts modal
  onCreate?: ShortcutHandler; // 'c' — new event
  onCycleMarker?: ShortcutHandler; // Shift+Space — cycle between today and the day marker
  onNextPage?: ShortcutHandler; // 'n' / 'j' — page the view forward
  onPrevPage?: ShortcutHandler; // 'p' / 'k' — page the view back
  onRefresh?: ShortcutHandler; // 'r' — refresh feeds
  onDelete?: ShortcutHandler; // '#' / Delete / Backspace — delete the focused (local) event
};

// Bare keys that jump to a zoom level or to today: '.'→1W, '1'–'5'→1M/3M/6M/1Y/2Y,
// '0'→today. Held without a modifier so Ctrl/Cmd+number (tab switching) is left alone.
const ZOOM_PRESET_KEYS = new Set(['.', '0', '1', '2', '3', '4', '5']);

// The user-facing catalogue of the shortcuts wired below, rendered by the
// long-press-search shortcuts modal. Colocated with handleShortcut so the two
// stay in step when a binding changes.
//
// Each entry lists one or more `chords` — alternative ways to trigger the same
// action. A chord is an array of keys pressed together, rendered "X + Y"; the
// alternatives are rendered as separate <kbd> groups. So an "also …" fallback
// (e.g. Ctrl/⌘+/ for search) is a second chord, not prose in the label.
export const KEYBOARD_SHORTCUTS: { chords: string[][]; label: string }[] = [
  { chords: [['1'], ['…'], ['5']], label: 'Zoom to 1M / 3M / 6M / 1Y / 2Y' },
  { chords: [['.']], label: '1W week view' },
  { chords: [['0']], label: 'Jump to today' },
  { chords: [['Shift', 'Space']], label: 'Cycle between today and the day marker' },
  { chords: [['n'], ['p'], ['j'], ['k']], label: 'Page the view forward / back' },
  { chords: [['←'], ['→']], label: 'Previous / next event (day, or paging in a dialog)' },
  { chords: [['↑'], ['↓']], label: 'Adjacent calendar lane (within the day in 1W)' },
  { chords: [['Space']], label: 'Toggle 1W week view; double-tap to jump to today' },
  { chords: [['Enter']], label: 'Open the focused event; in a dialog, its primary action' },
  { chords: [['Shift', 'Enter']], label: 'Select the focused event' },
  { chords: [['Ctrl/⌘', 's']], label: 'Save the open edit form (calendar / event / filter)' },
  { chords: [['#'], ['Del']], label: 'Delete the focused event (local calendars only)' },
  { chords: [['c']], label: 'New event' },
  { chords: [['/'], ['Ctrl/⌘', '/']], label: 'Search' },
  { chords: [['s'], ['Ctrl/⌘', ',']], label: 'Open / close settings' },
  { chords: [['r']], label: 'Refresh feeds' },
  { chords: [['?']], label: 'Keyboard shortcuts (this list)' },
  { chords: [['Esc']], label: 'Close the topmost layer, then clear the selection' },
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
  // Google-Calendar-style single keys. Gated to no Ctrl/⌘/Alt so browser combos
  // (notably Ctrl/⌘+R reload) are left alone; they sit after the in-field guard so
  // they never fire while typing. Each dispatches only when its handler accepts
  // (returns !== false), so e.g. Delete on a non-local event stays unhandled.
  if (!mod && !e.altKey) {
    const bare: [boolean, ShortcutHandler | undefined][] = [
      [e.key === '?', s.onHelp],
      [e.key === '/', s.onSearch],
      [e.key === 's', s.onSettings],
      [e.key === 'c', s.onCreate],
      [e.key === 'n' || e.key === 'j', s.onNextPage],
      [e.key === 'p' || e.key === 'k', s.onPrevPage],
      [e.key === 'r', s.onRefresh],
      [e.key === '#' || e.key === 'Delete' || e.key === 'Backspace', s.onDelete],
    ];
    for (const [match, handler] of bare) {
      if (!match) continue;
      if (handler && handler(e) !== false) {
        e.preventDefault();
        return true;
      }
    }
  }
  if (e.key === 'Enter') {
    // Shift+Enter selects the focused event; plain Enter opens it (or, when a
    // dialog is open, the caller returns false so the dialog's own Enter wins).
    if (e.shiftKey) {
      if (s.onSelect && s.onSelect(e) !== false) {
        e.preventDefault();
        return true;
      }
      return false;
    }
    if (mod) return false;
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
    // Shift+Space cycles today ↔ the day marker; plain Space toggles 1W.
    if (e.shiftKey) {
      if (s.onCycleMarker && s.onCycleMarker(e) !== false) {
        e.preventDefault();
        return true;
      }
      return false;
    }
    if (s.onSpace && s.onSpace(e) !== false) {
      e.preventDefault();
      return true;
    }
  }
  return false;
}
