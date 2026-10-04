import type { ParsedEvent } from './types';

// Undo for reschedules (drag, resize, Alt+arrow nudges) of local events. An
// entry keeps each touched lane's array from before the change and the one the
// change wrote: lanes are replaced, never mutated in place, so holding both
// references is free and restoring is one assignment — provided the lane is
// still the array the change wrote. Any later write (an edit, delete, import)
// makes the entry stale, and undo then refuses rather than clobber that write.
export type UndoEntry = {
  label: string;
  lanes: { feedId: string; before: ParsedEvent[]; after: ParsedEvent[] }[];
  // Detached repeat occurrence uid → the one-off uid it became.
  renames: Map<string, string>;
};

// Newest last. Raw: the lane arrays inside must not be deep-proxied.
const MAX_ENTRIES = 20;
export const undoStack = $state.raw<{ entries: UndoEntry[] }>({ entries: [] });

// The tray's undo bar: `message` is what it says, `canUndo` whether its UNDO
// button shows (false for the brief "Undone" / "Can't undo" notes).
export const undoBar = $state<{ message: string | null; canUndo: boolean }>({
  message: null,
  canUndo: false,
});

const BAR_MS = 8000;
const NOTE_MS = 2500;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function show(message: string, canUndo: boolean, ms: number): void {
  undoBar.message = message;
  undoBar.canUndo = canUndo;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(dismissUndoBar, ms);
}

export function dismissUndoBar(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  undoBar.message = null;
  undoBar.canUndo = false;
}

export function pushUndo(entry: UndoEntry): void {
  undoStack.entries = [...undoStack.entries, entry].slice(-MAX_ENTRIES);
  show(entry.label, true, BAR_MS);
}

export function popUndo(): UndoEntry | undefined {
  const entries = undoStack.entries;
  if (entries.length === 0) return undefined;
  undoStack.entries = entries.slice(0, -1);
  return entries[entries.length - 1];
}

export function clearUndo(): void {
  undoStack.entries = [];
}

// After an undo: name what was undone, and keep offering the next one down.
export function noteUndone(label: string): void {
  const next = undoStack.entries[undoStack.entries.length - 1];
  if (next) show(`Undone · ${next.label}`, true, BAR_MS);
  else show(`Undone: ${label}`, false, NOTE_MS);
}

export function noteUndoStale(): void {
  show("Can't undo: the calendar changed since", false, NOTE_MS);
}
