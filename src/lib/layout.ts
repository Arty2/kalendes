import type { DisplayEvent, LaneEvent, Zoom } from './types';
import { MS_PER_DAY, startOfDay } from './time';
import { durationDays } from './format';

// Static fallbacks used in tests / before a viewport width is known.
// The live timeline derives px/day from viewport width via computePxPerDay
// so that 3M / 6M / 1Y / 2Y semantically fit N months in the visible area.
export const PX_PER_DAY: Record<Zoom, number> = {
  // The 1W week view renders its own grid (WeekGrid) and never uses pxPerDay;
  // this entry only satisfies the exhaustive Record<Zoom, …> type.
  week: 200,
  month: 40,
  quarter: 14,
  'half-year': 7,
  year: 3.5,
  '2-year': 1.8,
};

export const MONTHS_IN_VIEWPORT: Record<Zoom, number> = {
  // Placeholder only — the 1W week view uses WeekGrid, not pxPerDay.
  week: 0.25,
  month: 1,
  quarter: 3,
  'half-year': 6,
  year: 12,
  '2-year': 24,
};

export const MIN_PX_PER_DAY = 1.5;
export const AVG_DAYS_PER_MONTH = 365.25 / 12;

// Below this viewport width a portrait phone can't show two years without the
// month columns becoming unreadably thin, so 2-year keeps the floor (and scrolls)
// there. Matches the portrait breakpoint used by the header.
export const FIT_WHOLE_SPAN_MIN_WIDTH = 640;

export function computePxPerDay(zoom: Zoom, viewportWidth: number): number {
  if (!viewportWidth || viewportWidth <= 0) return PX_PER_DAY[zoom];
  const months = MONTHS_IN_VIEWPORT[zoom];
  const raw = viewportWidth / (months * AVG_DAYS_PER_MONTH);
  // Fit the whole span across the viewport (no floor) for the wide zooms so the
  // entire year / two years are visible at once on mobile rather than being
  // floored into a horizontal scroll. 1-year always fits; 2-year fits except on
  // narrow portrait phones.
  const fitWholeSpan =
    zoom === 'year' || (zoom === '2-year' && viewportWidth > FIT_WHOLE_SPAN_MIN_WIDTH);
  if (fitWholeSpan) return raw;
  const base = Math.max(MIN_PX_PER_DAY, raw);
  return zoom === 'month' ? base + 2 : base;
}

export const MIN_PILL_PX = 80;
export const MIN_VISUAL_PILL_PX = 8;
// Hairline gap kept between pills that share a lane, so back-to-back boxes
// read as separate events instead of one fused bar.
export const SAME_LANE_GAP_PX = 2;
export const LANE_HEIGHT = 32;
export const ROW_PADDING_PX = 6;

// A conservative average glyph advance (in em) used to estimate a title's
// rendered width without measuring the DOM. Shared with EventPill's label-fit
// heuristic so the two agree. BUTTON_PADDING_PX matches the pill button's 8px
// horizontal padding on each side.
export const AVG_CHAR_EM = 0.55;
export const BUTTON_PADDING_PX = 16;

// The fixed-pixel collision floors (MIN_PILL_PX and the label reservation)
// assume a desktop-ish px/day. On a compressed timeline (narrow viewport or a
// wide zoom) they span many days and force separated events into extra lanes,
// inflating row height. Scale them with px/day so the reserved footprint tracks
// the room a day actually has. Ref ~ month zoom on desktop -> scale 1 there
// (unchanged); MIN_SCALE keeps a floor so labels still get some separation.
export const COLLISION_FLOOR_REF_PX_PER_DAY = 40;
export const COLLISION_FLOOR_MIN_SCALE = 0.3;

/** Pixel offset of epoch-ms `ms` from `epoch` — left edge of the day, not centre. */
export function msToPx(ms: number, epoch: Date, pxPerDay: number): number {
  return ((ms - epoch.getTime()) / MS_PER_DAY) * pxPerDay;
}

/** Pixel offset of `date` from `epoch` — left edge of the day, not centre. */
export function dateToPx(date: Date, epoch: Date, pxPerDay: number): number {
  return msToPx(date.getTime(), epoch, pxPerDay);
}

export function pxToDate(px: number, epoch: Date, pxPerDay: number): Date {
  return new Date(epoch.getTime() + (px / pxPerDay) * MS_PER_DAY);
}

export const MID_COLUMN_MIN_PX_PER_DAY = 30;

export function assignLanes(
  events: DisplayEvent[],
  pxPerDay: number,
  epoch: Date,
  collisionMinPx: number = MIN_PILL_PX,
  presorted = false,
  // Root em size (px) the pill title renders at, used to reserve a title's
  // estimated label width during collision so long labels push neighbours to a
  // new lane instead of visibly overlapping. 0 disables the reservation (keeps
  // the pre-existing packing for tests / callers that don't pass it).
  fontEmPx = 0,
  // When set, current/future events (end >= nowMs) claim the top lanes and past
  // events yield to them: a past event only drops to a lower lane where it would
  // actually overlap a current/future pill, otherwise it reuses the top lanes
  // (so rows stay as compact as the flat packing). Omit for flat greedy packing.
  nowMs?: number,
): { laneEvents: LaneEvent[]; laneCount: number } {
  if (events.length === 0) return { laneEvents: [], laneCount: 0 };
  // Sort order is independent of pxPerDay, so callers re-running this on every
  // zoom can pre-sort once and pass presorted to skip the per-frame sort.
  const sorted = presorted ? events : [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  const laneEvents: LaneEvent[] = [];
  const useFractional = pxPerDay >= MID_COLUMN_MIN_PX_PER_DAY;
  // Depends only on pxPerDay, so compute it once for the whole pass. Shrinks the
  // fixed-pixel collision floors as the timeline compresses (see the constants).
  const floorScale = Math.min(
    1,
    Math.max(COLLISION_FLOOR_MIN_SCALE, pxPerDay / COLLISION_FLOOR_REF_PX_PER_DAY),
  );

  // Hidden-style pills render as barely-visible ghosts, so overlapping one is
  // acceptable: they take the lane first-fit finds but never reserve space in
  // it — they can't push a real event to a new lane (and are skipped by the
  // same-lane clip pass below).
  const isGhost = (event: DisplayEvent): boolean => event.styleVariant === 'hidden';

  // Same-title lane affinity: instances of a recurring event (same trimmed
  // displayTitle) prefer the lane the title was first placed on, so a weekly
  // meeting reads as one row instead of being scattered by first-fit. The lane
  // is remembered from the first placement only — a blocked instance falls back
  // to first-fit for that one event without dragging the row elsewhere.
  const titleLanes = new Map<string, number>();
  const affinityLane = (event: DisplayEvent): number | undefined =>
    titleLanes.get(event.displayTitle.trim());
  const rememberLane = (event: DisplayEvent, lane: number): void => {
    const title = event.displayTitle.trim();
    if (title && !titleLanes.has(title)) titleLanes.set(title, lane);
  };

  // The horizontal footprint of a pill: `left`..`left + collisionWidth` is the
  // span used for stacking, `visualWidth` is the rendered width.
  const geom = (event: DisplayEvent): { left: number; right: number; visualWidth: number } => {
    const fractional = useFractional && !event.allDay;
    const left = fractional
      ? dateToPx(event.start, epoch, pxPerDay)
      : dateToPx(startOfDay(event.start), epoch, pxPerDay);
    const days = durationDays(event.start, event.end);
    const allowMinClamp = pxPerDay >= MID_COLUMN_MIN_PX_PER_DAY;
    const visualWidth = allowMinClamp
      ? Math.max(days * pxPerDay, MIN_VISUAL_PILL_PX)
      : days * pxPerDay;
    const realDurationPx = fractional
      ? ((event.end.getTime() - event.start.getTime()) / MS_PER_DAY) * pxPerDay
      : visualWidth;
    // Estimated on-screen label footprint. Only reserved on the non-fractional
    // path (all-day events and every event at wider zooms) — where thin pills
    // let long titles smear over neighbours; fractional timed events keep their
    // real-duration collision so concurrent meetings aren't force-stacked.
    const labelPx =
      fontEmPx > 0
        ? event.displayTitle.trim().length * AVG_CHAR_EM * fontEmPx + BUTTON_PADDING_PX
        : 0;
    // Fractional pills render at least MIN_VISUAL_PILL_PX wide (plus the
    // same-lane gap), so collision must reserve at least that much or two
    // short meetings minutes apart would share a lane with physically
    // overlapping boxes.
    const collisionWidth = fractional
      ? Math.max(realDurationPx, MIN_VISUAL_PILL_PX + SAME_LANE_GAP_PX)
      : Math.max(visualWidth, collisionMinPx * floorScale, labelPx * floorScale);
    return { left, right: left + collisionWidth, visualWidth };
  };

  // Rendered widths are day-rounded (durationDays floors to a whole day), so a
  // timed pill's box can reach past its collision footprint — e.g. an evening
  // meeting renders into the next day. Clip each pill at its same-lane
  // successor so boxes never physically overlap, and record how much room the
  // label has before it would smear over that neighbour (labelRoomPx —
  // EventPill fades the title at that edge).
  const clipToLaneNeighbours = (): void => {
    const byLane = new Map<number, LaneEvent[]>();
    for (const e of laneEvents) {
      if (isGhost(e)) continue; // ghosts neither clip nor get clipped
      const group = byLane.get(e.lane);
      if (group) group.push(e);
      else byLane.set(e.lane, [e]);
    }
    for (const group of byLane.values()) {
      group.sort((a, b) => a.leftPx - b.leftPx);
      for (let i = 0; i < group.length - 1; i++) {
        const e = group[i];
        const nextLeft = group[i + 1].leftPx;
        if (e.leftPx + e.widthPx > nextLeft) {
          e.widthPx = Math.max(MIN_VISUAL_PILL_PX, nextLeft - e.leftPx - SAME_LANE_GAP_PX);
        }
        e.labelRoomPx = nextLeft - e.leftPx;
      }
    }
  };

  if (nowMs === undefined) {
    // Flat greedy first-fit. Events arrive start-ascending, so a lane is free
    // once its last pill's right edge is at or before this pill's left edge.
    const laneEnds: number[] = [];
    for (const event of sorted) {
      const { left, right, visualWidth } = geom(event);
      const preferred = affinityLane(event);
      let lane =
        preferred !== undefined && laneEnds[preferred]! <= left
          ? preferred
          : laneEnds.findIndex((end) => end <= left);
      if (lane === -1) {
        // No free lane: a ghost overlaps whatever is on the top lane rather
        // than opening a new one; real events open the next lane as before.
        if (isGhost(event) && laneEnds.length > 0) lane = 0;
        else {
          lane = laneEnds.length;
          laneEnds.push(0);
        }
      }
      if (!isGhost(event)) laneEnds[lane] = right;
      rememberLane(event, lane);
      laneEvents.push({ ...event, lane, leftPx: left, widthPx: visualWidth });
    }
    clipToLaneNeighbours();
    return { laneEvents, laneCount: laneEnds.length };
  }

  // Keep current/future events on the top row(s) without inflating height:
  // place them first (they claim the lowest lanes), then place past events on
  // the lowest lane where they don't actually overlap anything. Past events
  // therefore reuse the top lanes wherever there's a gap (staying compact) and
  // only drop to a lower lane when they'd collide with a current/future pill.
  const laneSpans: { left: number; right: number }[][] = [];
  const place = (event: DisplayEvent): void => {
    const { left, right, visualWidth } = geom(event);
    const fits = (spans: { left: number; right: number }[]): boolean =>
      !spans.some((s) => s.left < right && left < s.right);
    const preferred = affinityLane(event);
    let lane =
      preferred !== undefined && fits(laneSpans[preferred]!)
        ? preferred
        : laneSpans.findIndex(fits);
    if (lane === -1) {
      // No free lane: ghosts overlap the top lane instead of opening one.
      if (isGhost(event) && laneSpans.length > 0) lane = 0;
      else {
        lane = laneSpans.length;
        laneSpans.push([]);
      }
    }
    if (!isGhost(event)) laneSpans[lane].push({ left, right });
    rememberLane(event, lane);
    laneEvents.push({ ...event, lane, leftPx: left, widthPx: visualWidth });
  };
  const past: DisplayEvent[] = [];
  for (const event of sorted) {
    if (event.end.getTime() < nowMs) past.push(event);
    else place(event);
  }
  for (const event of past) place(event);
  clipToLaneNeighbours();
  return { laneEvents, laneCount: laneSpans.length };
}

// Generic interval packer for the 1W week grid: greedily assigns each item to
// the first lane whose previous item has ended (by start/end minutes within a
// single day column), splitting overlapping events into side-by-side
// sub-columns. Items are packed in ascending-start order; `laneCount` is the
// number of side-by-side columns the day needs. Unlike assignLanes this is pure
// interval math (no pixels, no all-day clamping) so it stays trivially testable.
export type PackItem = { startMin: number; endMin: number };
export type Packed<T> = { item: T; lane: number };

export function packLanes<T extends PackItem>(
  items: T[],
): { packed: Packed<T>[]; laneCount: number } {
  if (items.length === 0) return { packed: [], laneCount: 0 };
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  );
  const laneEnds: number[] = [];
  const packed: Packed<T>[] = [];
  for (const item of sorted) {
    // First lane free at this item's start. A zero-length item still occupies a
    // lane for its instant, and a lane is reusable the moment its prior item
    // ends (end <= start), matching back-to-back calendar events sharing a lane.
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = item.endMin;
    packed.push({ item, lane });
  }
  return { packed, laneCount: laneEnds.length };
}

export type RangeBounds = { pastMonths?: number; futureMonths?: number };

export function rangeForToday(today: Date, bounds: RangeBounds = {}): { start: Date; end: Date } {
  const pastMonths = bounds.pastMonths ?? 12;
  const futureMonths = bounds.futureMonths ?? 24;
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - pastMonths, today.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + futureMonths, today.getUTCDate()),
  );
  return { start, end };
}
