import type { DisplayEvent, LaneEvent, Zoom } from './types';
import { MS_PER_DAY, startOfDay } from './time';
import { durationDays } from './format';

// Static fallbacks used in tests / before a viewport width is known.
// The live timeline derives px/day from viewport width via computePxPerDay
// so that 3M / 6M / 1Y / 2Y semantically fit N months in the visible area.
export const PX_PER_DAY: Record<Zoom, number> = {
  month: 40,
  quarter: 14,
  'half-year': 7,
  year: 3.5,
  '2-year': 1.8,
};

export const MONTHS_IN_VIEWPORT: Record<Zoom, number> = {
  month: 1,
  quarter: 3,
  'half-year': 6,
  year: 12,
  '2-year': 24,
};

export const MIN_PX_PER_DAY = 1.5;
export const AVG_DAYS_PER_MONTH = 365.25 / 12;

export function computePxPerDay(zoom: Zoom, viewportWidth: number): number {
  if (!viewportWidth || viewportWidth <= 0) return PX_PER_DAY[zoom];
  const months = MONTHS_IN_VIEWPORT[zoom];
  const raw = viewportWidth / (months * AVG_DAYS_PER_MONTH);
  const base = Math.max(MIN_PX_PER_DAY, raw);
  return zoom === 'month' ? base + 2 : base;
}

export const MIN_PILL_PX = 80;
export const MIN_VISUAL_PILL_PX = 8;
export const LANE_HEIGHT = 32;
export const ROW_PADDING_PX = 6;

/** Pixel offset of `date` from `epoch` — left edge of the day, not centre. */
export function dateToPx(date: Date, epoch: Date, pxPerDay: number): number {
  return ((date.getTime() - epoch.getTime()) / MS_PER_DAY) * pxPerDay;
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
): { laneEvents: LaneEvent[]; laneCount: number } {
  if (events.length === 0) return { laneEvents: [], laneCount: 0 };
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  const laneEnds: number[] = [];
  const laneEvents: LaneEvent[] = [];
  const useFractional = pxPerDay >= MID_COLUMN_MIN_PX_PER_DAY;
  for (const event of sorted) {
    const fractional = useFractional && !event.allDay;
    const leftPx = fractional
      ? dateToPx(event.start, epoch, pxPerDay)
      : dateToPx(startOfDay(event.start), epoch, pxPerDay);
    const days = durationDays(event.start, event.end);
    const visualWidth = Math.max(days * pxPerDay, MIN_VISUAL_PILL_PX);
    const realDurationPx = fractional
      ? ((event.end.getTime() - event.start.getTime()) / MS_PER_DAY) * pxPerDay
      : visualWidth;
    const collisionWidth = fractional
      ? Math.max(1, realDurationPx)
      : Math.max(visualWidth, collisionMinPx);
    let lane = laneEnds.findIndex((end) => end <= leftPx);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = leftPx + collisionWidth;
    laneEvents.push({ ...event, lane, leftPx, widthPx: visualWidth });
  }
  return { laneEvents, laneCount: laneEnds.length };
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
