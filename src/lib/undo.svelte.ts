import type { ParsedEvent } from './types';

// Undo / redo for local-lane changes: reschedules (drag, resize, Alt+arrow
// nudges), deletes, and tray Move / Copy. An entry keeps each touched lane's
// array from before the change and the one the change wrote: lanes are
// replaced, never mutated in place, so holding both references is free, and
// undo / redo are one assignment per lane — provided the lane is still the
// array the other side left. Any other write (an edit, an import) makes the
// entry stale, and undo / redo then refuse rather than clobber that write.
export type UndoEntry = {
  label: string;
  lanes: { feedId: string; before: ParsedEvent[]; after: ParsedEvent[] }[];
  // Detached repeat occurrence uid → the one-off uid it became.
  renames: Map<string, string>;
};

// Newest last in both. Raw fields: the lane arrays inside must not be
// deep-proxied, and every change replaces the arrays, so readers (the bar's
// undo / redo buttons) react on identity.
const MAX_ENTRIES = 20;
class UndoHistory {
  entries = $state.raw<UndoEntry[]>([]);
  redo = $state.raw<UndoEntry[]>([]);
}
export const undoStack = new UndoHistory();

// What the tray's status bar says about the last change. It has no timer: it
// stays until the user does something else (StatusBar dismisses it on a tap
// elsewhere or a key other than undo / redo / nudge) or a lane edit outdates
// the history. The undo / redo buttons themselves live on the bar for good.
export const undoBar = $state<{ message: string | null }>({ message: null });

export function dismissUndoBar(): void {
  undoBar.message = null;
}

export function pushUndo(entry: UndoEntry): void {
  undoStack.entries = [...undoStack.entries, entry].slice(-MAX_ENTRIES);
  // A new change forks history: what was undone can't be redone over it.
  if (undoStack.redo.length) undoStack.redo = [];
  undoBar.message = entry.label;
}

export function peekUndo(): UndoEntry | undefined {
  return undoStack.entries[undoStack.entries.length - 1];
}

export function peekRedo(): UndoEntry | undefined {
  return undoStack.redo[undoStack.redo.length - 1];
}

// Move the newest entry from one side to the other (after a successful undo or
// redo). The caller has already applied it.
export function shiftUndone(): void {
  const e = peekUndo();
  if (!e) return;
  undoStack.entries = undoStack.entries.slice(0, -1);
  undoStack.redo = [...undoStack.redo, e];
  undoBar.message = `Undone: ${e.label}`;
}

export function shiftRedone(): void {
  const e = peekRedo();
  if (!e) return;
  undoStack.redo = undoStack.redo.slice(0, -1);
  undoStack.entries = [...undoStack.entries, e];
  undoBar.message = `Redone: ${e.label}`;
}

export function clearUndo(): void {
  if (undoStack.entries.length) undoStack.entries = [];
  if (undoStack.redo.length) undoStack.redo = [];
}

// A lane was written by something other than an undoable change: every entry
// touching it is outdated, and history only replays in order, so all of it
// goes, and the bar with it.
export function invalidateUndoFor(feedId: string): void {
  const touches = (e: UndoEntry): boolean => e.lanes.some((l) => l.feedId === feedId);
  if (!undoStack.entries.some(touches) && !undoStack.redo.some(touches)) return;
  clearUndo();
  dismissUndoBar();
}

export function noteUndoStale(what: 'undo' | 'redo'): void {
  undoBar.message = `Can't ${what}: the calendar changed since`;
}
