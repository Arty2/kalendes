// Pure layout for the 1W week grid (WeekGrid.svelte): which day column each
// event lands in, how overlapping events share a column, how all-day bars
// stack, and the keyboard focus walk over them. Column indexing is injected so
// this stays free of the component's scroll window and reactive state.
import { packLanes, AVG_CHAR_EM, BUTTON_PADDING_PX } from './layout';
import { zonedParts } from './format';
import type { DisplayEvent, Timezone } from './types';

export type TimedBlock = {
  ev: DisplayEvent;
  startMin: number;
  endMin: number;
  // The event runs on past this day's end / began before this day's start.
  continuesEnd: boolean;
  continuesStart: boolean;
  // Side by side within its group of events that start together.
  lane: number;
  laneCount: number;
  // How many earlier, still-running events this block is drawn over.
  indent: number;
};

type DaySlice = { ev: DisplayEvent; startMin: number; endMin: number; continuesEnd: boolean; continuesStart: boolean };

// Timed events in each day column they cover, in minutes of that day: a
// multi-day event gets a block on every day it touches (its first from its
// start, its last up to its end, any between whole). Overlaps lay out like
// most week grids: events starting within `nestGapMin` of each other share
// the width side by side; one starting later than that is drawn over the
// event(s) it overlaps, indented a step, so both titles stay readable
// (`nestGapMin` is about one title line of the grid). `colOf` maps an
// instant to its column in `tz`'s calendar days. Blocks come in start order,
// so later ones paint over earlier ones.
export function layoutTimedDays(
  events: readonly DisplayEvent[],
  dayCount: number,
  colOf: (d: Date) => number,
  tz: Timezone,
  nestGapMin = Infinity,
): TimedBlock[][] {
  const cols: DaySlice[][] = Array.from({ length: dayCount }, () => []);
  for (const ev of events) {
    if (ev.allDay) continue;
    const first = colOf(ev.start);
    const startMin = zonedParts(ev.start, tz).minutes;
    const endMinOfDay = zonedParts(ev.end, tz).minutes;
    let last = colOf(ev.end);
    let lastEnd = endMinOfDay;
    // Ending at exactly 00:00 ends the day before, at its midnight.
    if (last > first && endMinOfDay === 0) {
      last--;
      lastEnd = 1440;
    }
    if (last < first) last = first; // malformed: end before start
    if (last < 0 || first >= dayCount) continue;
    for (let idx = Math.max(0, first); idx <= Math.min(dayCount - 1, last); idx++) {
      const from = idx === first ? startMin : 0;
      let to = idx === last ? lastEnd : 1440;
      if (to < from) to = 1440; // malformed: clip to midnight
      cols[idx]!.push({ ev, startMin: from, endMin: to, continuesEnd: idx < last, continuesStart: idx > first });
    }
  }
  return cols.map((items) => arrangeDay(items, nestGapMin));
}

function arrangeDay(items: DaySlice[], nestGapMin: number): TimedBlock[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  type Placed = DaySlice & { indent: number; group: Placed[] };
  const placed: Placed[] = [];
  // A zero-length event still occupies its instant.
  const overlaps = (a: DaySlice, b: DaySlice): boolean =>
    a.startMin < Math.max(b.endMin, b.startMin + 1) && b.startMin < Math.max(a.endMin, a.startMin + 1);
  for (const item of sorted) {
    const over = placed.filter((p) => overlaps(p, item));
    const close = over.find((p) => item.startMin - p.startMin < nestGapMin);
    let entry: Placed;
    if (close) {
      entry = { ...item, indent: close.indent, group: close.group };
    } else {
      const indent = over.length ? Math.max(...over.map((p) => p.indent)) + 1 : 0;
      entry = { ...item, indent, group: [] };
    }
    entry.group.push(entry);
    placed.push(entry);
  }
  const lanes = new Map<Placed, { lane: number; laneCount: number }>();
  for (const g of new Set(placed.map((p) => p.group))) {
    const { packed, laneCount } = packLanes(g);
    for (const { item, lane } of packed) lanes.set(item, { lane, laneCount });
  }
  return placed.map((p) => ({
    ev: p.ev,
    startMin: p.startMin,
    endMin: p.endMin,
    continuesEnd: p.continuesEnd,
    continuesStart: p.continuesStart,
    ...lanes.get(p)!,
    indent: p.indent,
  }));
}

export type AllDayRow = {
  ev: DisplayEvent;
  from: number;
  span: number;
  lane: number;
  // Set on a segment capAllDay cut out of a longer bar: the event carries on
  // past this start / end (drawn as a dashed, square edge).
  cutStart?: boolean;
  cutEnd?: boolean;
};

// All-day events span the (UTC) day columns they cover, clamped to the window,
// and stack into lanes so concurrent ones don't overlap. Each bar reserves at
// least the columns its title needs (the same footprint reservation
// assignLanes uses for the horizontal zooms), so a long label pushes the next
// event to a lower lane instead of smearing over it. `utcColOf` indexes the
// date-only value by its UTC calendar day; `fontEmPx` is the bar title's em.
export function layoutAllDay(
  events: readonly DisplayEvent[],
  dayCount: number,
  utcColOf: (d: Date) => number,
  metrics: { fontEmPx: number; dayW: number },
): { rows: AllDayRow[]; laneCount: number } {
  const items: { from: number; span: number; ev: DisplayEvent; startMin: number; endMin: number }[] = [];
  for (const ev of events) {
    const startIdx = utcColOf(ev.start);
    const lastIdx = utcColOf(new Date(Math.max(ev.start.getTime(), ev.end.getTime() - 1)));
    if (lastIdx < 0 || startIdx >= dayCount) continue;
    const from = Math.max(0, startIdx);
    const to = Math.min(dayCount - 1, lastIdx);
    const span = to - from + 1;
    const labelPx = ev.displayTitle.trim().length * AVG_CHAR_EM * metrics.fontEmPx + BUTTON_PADDING_PX;
    const footprintCols = Math.max(span, Math.ceil(labelPx / metrics.dayW));
    items.push({ from, span, ev, startMin: from, endMin: from + footprintCols });
  }
  const { packed, laneCount } = packLanes(items);
  const rows = packed.map(({ item, lane }) => ({ ev: item.ev, from: item.from, span: item.span, lane }));
  return { rows, laneCount };
}

// The all-day strip under a lane cap. Lanes above the last one show as laid
// out; the last shown lane (maxLanes - 1) is shared by everything from it
// down. On a day where only one such bar falls it shows there (clipped to
// those days, so a long bar that is crowded out elsewhere still appears where
// it has room); a day with two or more gets a "+N" chip instead.
export function capAllDay(
  rows: readonly AllDayRow[],
  dayCount: number,
  maxLanes: number,
): { shown: AllDayRow[]; chips: { col: number; n: number }[] } {
  const last = maxLanes - 1;
  const counts = new Array<number>(dayCount).fill(0);
  const over = rows.filter((r) => r.lane >= last);
  for (const r of over) {
    for (let c = r.from; c < r.from + r.span && c < dayCount; c++) counts[c]!++;
  }
  const shown = rows.filter((r) => r.lane < last);
  for (const r of over) {
    let from = -1;
    for (let c = r.from; c <= r.from + r.span; c++) {
      const alone = c < r.from + r.span && c < dayCount && counts[c] === 1;
      if (alone && from < 0) from = c;
      if (!alone && from >= 0) {
        shown.push({
          ev: r.ev,
          from,
          span: c - from,
          lane: last,
          ...(from > r.from ? { cutStart: true } : {}),
          ...(c < r.from + r.span ? { cutEnd: true } : {}),
        });
        from = -1;
      }
    }
  }
  const chips: { col: number; n: number }[] = [];
  for (let c = 0; c < dayCount; c++) if (counts[c]! > 1) chips.push({ col: c, n: counts[c]! });
  return { shown, chips };
}

// A predicate: does a bar's lane hold another bar on the very next day? Only
// then is its title clipped — otherwise it may overflow into the free space.
export function allDayClipTest(rows: readonly AllDayRow[]): (r: AllDayRow) => boolean {
  const occupied = new Set<string>();
  for (const r of rows) {
    for (let c = r.from; c < r.from + r.span; c++) occupied.add(`${r.lane}:${c}`);
  }
  return (r) => occupied.has(`${r.lane}:${r.from + r.span}`);
}

// A day's timed events in start order — the Up/Down focus sequence.
export function dayFocusItems(blocks: readonly TimedBlock[] | undefined): { uid: string; startMin: number }[] {
  return (blocks ?? [])
    .map((b) => ({ uid: b.ev.uid, startMin: b.startMin }))
    .sort((a, b) => a.startMin - b.startMin);
}

// Where a focused uid sits: its column and index in that day's focus order.
export function locateFocusedUid(
  timedByDay: readonly TimedBlock[][],
  uid: string | null,
): { col: number; idx: number } | null {
  if (uid == null) return null;
  for (let col = 0; col < timedByDay.length; col++) {
    const idx = dayFocusItems(timedByDay[col]).findIndex((it) => it.uid === uid);
    if (idx >= 0) return { col, idx };
  }
  return null;
}

// The first column from `from` (inclusive) walking by `dir` that has a timed
// event, or -1.
export function nearestDayWithEvents(timedByDay: readonly TimedBlock[][], from: number, dir: number): number {
  for (let col = from; col >= 0 && col < timedByDay.length; col += dir) {
    if ((timedByDay[col] ?? []).length) return col;
  }
  return -1;
}

// The slot a drag down the empty hour grid covers: from the SNAP_MIN slot it
// was pressed in to the slot line nearest the pointer, either direction, at
// least one slot long and within the day.
export function createDragSpan(pressMin: number, pointerMin: number, snap: number): { startMin: number; endMin: number } {
  const clamp = (m: number): number => Math.max(0, Math.min(1440, m));
  const anchor = clamp(Math.floor(clamp(pressMin) / snap) * snap);
  const at = clamp(pointerMin);
  if (at >= anchor) {
    const start = Math.min(anchor, 1440 - snap);
    return { startMin: start, endMin: Math.max(start + snap, clamp(Math.round(at / snap) * snap)) };
  }
  return { startMin: Math.min(anchor, Math.round(at / snap) * snap), endMin: Math.min(1440, anchor + snap) };
}
