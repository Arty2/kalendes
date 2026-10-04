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
// button shows, and `next` names the change UNDO would revert when the message
// is about another one (right after an undo). It has no timer: it stays until
// the user does something else (StatusBar dismisses it on a tap elsewhere or a
// key other than undo / nudge) or a lane edit outdates the history.
export const undoBar = $state<{ message: string | null; canUndo: boolean; next: string | null }>({
  message: null,
  canUndo: false,
  next: null,
});

function show(message: string, canUndo: boolean, next: string | null = null): void {
  undoBar.message = message;
  undoBar.canUndo = canUndo;
  undoBar.next = next;
}

export function dismissUndoBar(): void {
  undoBar.message = null;
  undoBar.canUndo = false;
  undoBar.next = null;
}

export function pushUndo(entry: UndoEntry): void {
  undoStack.entries = [...undoStack.entries, entry].slice(-MAX_ENTRIES);
  show(entry.label, true);
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

// A lane was written by something other than a reschedule or an undo: every
// entry touching it is outdated, and undo goes newest-first, so the whole
// history goes, and the bar with it.
export function invalidateUndoFor(feedId: string): void {
  if (!undoStack.entries.some((e) => e.lanes.some((l) => l.feedId === feedId))) return;
  clearUndo();
  dismissUndoBar();
}

// After an undo: say so, and while earlier changes remain keep offering them one
// at a time, naming the one UNDO reverts next.
export function noteUndone(label: string): void {
  const next = undoStack.entries[undoStack.entries.length - 1];
  if (next) show(`Undone · next: ${next.label}`, true, next.label);
  else show(`Undone: ${label}`, false);
}

export function noteUndoStale(): void {
  show("Can't undo: the calendar changed since", false);
}
