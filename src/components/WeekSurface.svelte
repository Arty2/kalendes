<script lang="ts">
  import EventPill from './EventPill.svelte';
  import { focus } from '../lib/state.svelte';
  import { dateToPx } from '../lib/layout';
  import { MS_PER_DAY } from '../lib/time';
  import type { CalendarFeed, LaneEvent } from '../lib/types';

  type Props = {
    laneEvents: LaneEvent[];
    rangeStart: Date;
    pxPerDay: number;
    bodyHeight: number;
    feedsById: Record<string, CalendarFeed>;
    matchUids: Set<string>;
    currentMatchUid: string | null;
    weekendStrips: { left: number; width: number; past: boolean }[];
    dayTicksPx: { px: number; past: boolean }[];
    todayMs: number;
    visibleLeft: number;
    visibleRight: number;
  };
  const {
    laneEvents,
    rangeStart,
    pxPerDay,
    bodyHeight,
    feedsById,
    matchUids,
    currentMatchUid,
    weekendStrips,
    dayTicksPx,
    todayMs,
    visibleLeft,
    visibleRight,
  }: Props = $props();

  // Same overscan-window virtualization the per-feed rows use: only render
  // nodes intersecting the visible scroll window (everything before the window
  // is measured renders, to avoid a blank first paint).
  function inWindow(left: number, width: number): boolean {
    if (!(visibleRight > visibleLeft)) return true;
    return left <= visibleRight && left + width >= visibleLeft;
  }

  const sortedLaneEvents = $derived(
    [...laneEvents].sort((a, b) => a.start.getTime() - b.start.getTime()),
  );
  const vWeekend = $derived(weekendStrips.filter((w) => inWindow(w.left, w.width)));
  const vDayTicks = $derived(dayTicksPx.filter((d) => inWindow(d.px, 0)));
  const vLaneEvents = $derived(sortedLaneEvents.filter((e) => inWindow(e.leftPx, e.widthPx)));

  // Subtle six-hour subdivisions (00/06/12/18) between the day boundaries,
  // virtualized to the visible window (the full range spans years of hours).
  const SUBDIV_HOURS = 6;
  const vHourLines = $derived.by(() => {
    if (!(visibleRight > visibleLeft)) return [] as { px: number; past: boolean }[];
    const strideMs = SUBDIV_HOURS * 3_600_000;
    const startMs = rangeStart.getTime() + (Math.max(0, visibleLeft) / pxPerDay) * MS_PER_DAY;
    const endMs = rangeStart.getTime() + (visibleRight / pxPerDay) * MS_PER_DAY;
    const out: { px: number; past: boolean }[] = [];
    for (let t = Math.ceil(startMs / strideMs) * strideMs; t <= endMs; t += strideMs) {
      // Skip exact day boundaries — those are drawn as the stronger day lines.
      if (t % MS_PER_DAY === 0) continue;
      out.push({ px: dateToPx(new Date(t), rangeStart, pxPerDay), past: t < todayMs });
    }
    return out;
  });

  function feedFocus(uid: string): void {
    const idx = sortedLaneEvents.findIndex((e) => e.uid === uid);
    if (idx >= 0) focus.eventIndex = idx;
  }
</script>

<section class="week-surface" data-feed-id="__week__">
  <div class="week-body" style="height: {bodyHeight}px;">
    {#each vWeekend as w (w.left)}
      <i class="weekend-band" data-past={w.past ? 'true' : null} style="left: {w.left}px; width: {w.width}px"></i>
    {/each}
    {#each vHourLines as h (h.px)}
      <i class="hour-line" data-past={h.past ? 'true' : null} style="left: {h.px}px"></i>
    {/each}
    {#each vDayTicks as dx (dx.px)}
      <i class="day-line" data-past={dx.past ? 'true' : null} style="left: {dx.px}px"></i>
    {/each}
    {#each vLaneEvents as e (e.uid)}
      <EventPill
        event={e}
        isMatch={matchUids.has(e.uid)}
        isCurrent={currentMatchUid === e.uid}
        isPast={e.end.getTime() < todayMs}
        isFocused={false}
        feedColor={feedsById[e.feedId]?.color}
        feedStyle={feedsById[e.feedId]?.style}
        feedTravel={feedsById[e.feedId]?.travel}
        feedId={e.feedId}
        onFocusEvent={feedFocus}
      />
    {/each}
  </div>
</section>

<style>
  .week-surface {
    position: relative;
    width: max-content;
    min-width: 100%;
    border-top: var(--border-w) solid var(--ink);
    border-bottom: var(--border-w) solid var(--ink);
    box-sizing: border-box;
  }
  .week-body {
    position: relative;
    box-sizing: border-box;
    background: var(--paper);
  }
  .weekend-band {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--weekend-bg);
    pointer-events: none;
    z-index: 0;
  }
  .weekend-band[data-past='true'] {
    background: var(--weekend-bg-past);
  }
  .day-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: var(--border-w) solid var(--ink-faint);
    pointer-events: none;
    z-index: 0;
  }
  .hour-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: var(--border-w) dotted var(--ink-faint);
    pointer-events: none;
    z-index: 0;
    opacity: 0.5;
  }
  .day-line[data-past='true'],
  .hour-line[data-past='true'] {
    opacity: 0.3;
  }
</style>
