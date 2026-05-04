import type { DisplayEvent, LaneEvent, Zoom } from './types';
import { MS_PER_DAY } from './time';

export const PX_PER_DAY: Record<Zoom, number> = {
  month: 40,
  quarter: 14,
  'half-year': 7,
  year: 3.5,
};

export const MIN_PILL_PX = 80;
export const MIN_VISUAL_PILL_PX = 8;
export const LANE_HEIGHT = 40;
export const ROW_PADDING_PX = 8;

export function dateToPx(date: Date, epoch: Date, pxPerDay: number): number {
  return ((date.getTime() - epoch.getTime()) / MS_PER_DAY) * pxPerDay;
}

export function pxToDate(px: number, epoch: Date, pxPerDay: number): Date {
  return new Date(epoch.getTime() + (px / pxPerDay) * MS_PER_DAY);
}

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
  for (const event of sorted) {
    const leftPx = dateToPx(event.start, epoch, pxPerDay);
    const rawWidth = ((event.end.getTime() - event.start.getTime()) / MS_PER_DAY) * pxPerDay;
    const visualWidth = Math.max(rawWidth, MIN_VISUAL_PILL_PX);
    const collisionWidth = Math.max(rawWidth, collisionMinPx);
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
  const pastMonths = bounds.pastMonths ?? 24;
  const futureMonths = bounds.futureMonths ?? 36;
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - pastMonths, today.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + futureMonths, today.getUTCDate()),
  );
  return { start, end };
}
