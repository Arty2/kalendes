<script lang="ts">
  import EventPill from './EventPill.svelte';
  import RowHeader from './RowHeader.svelte';
  import { ui, config, focus } from '../lib/state.svelte';
  import { dateToPx } from '../lib/layout';
  import { formatDate } from '../lib/format';
  import { today } from '../lib/today.svelte';
  import type { CalendarFeed, DisplayEvent, LaneEvent } from '../lib/types';

  type Props = {
    feed: CalendarFeed;
    events: DisplayEvent[];
    laneEvents: LaneEvent[];
    rangeStart: Date;
    pxPerDay: number;
    bodyHeight: number;
    matchUids: Set<string>;
    currentMatchUid: string | null;
    scrollEl: HTMLElement | undefined;
    monthStartsPx: number[];
    weekendStrips: { left: number; width: number }[];
    dayTicksPx: number[];
    observanceStrips: { left: number; width: number }[];
    rowIndex: number;
  };
  function isHighlightedDot(ev: DisplayEvent, idx: number): boolean {
    if (currentMatchUid && currentMatchUid === ev.uid) return true;
    if (focus.feedId === feed.id && focus.eventIndex === idx) return true;
    return false;
  }
  const {
    feed,
    events,
    laneEvents,
    rangeStart,
    pxPerDay,
    bodyHeight,
    matchUids,
    currentMatchUid,
    scrollEl,
    monthStartsPx,
    weekendStrips,
    dayTicksPx,
    observanceStrips,
    rowIndex,
  }: Props = $props();

  const visibleEvents = $derived(events.filter((e) => !e.hidden));
  const sortedLaneEvents = $derived(
    [...laneEvents].sort((a, b) => a.start.getTime() - b.start.getTime()),
  );

  function focusByUid(uid: string): void {
    const idx = sortedLaneEvents.findIndex((e) => e.uid === uid);
    if (idx >= 0) focus.eventIndex = idx;
  }

  const dots = $derived.by(() => {
    if (!feed.collapsed) return [] as { px: number; ev: DisplayEvent }[];
    return [...visibleEvents]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((ev) => ({ ev, px: dateToPx(ev.start, rangeStart, pxPerDay) }));
  });

  const todayMs = $derived(today.value.getTime());

  function dotLabel(ev: DisplayEvent): string {
    return ev.displayTitle + ' · ' + formatDate(ev.start, config.dateFormat, config.locale);
  }

  function openDot(ev: DisplayEvent): void {
    ui.modalEvent = ev;
  }

  const isHolidayFeed = $derived(feed.category === 'holidays');
  const isFocusedRow = $derived(focus.feedId === feed.id);
</script>

<section class="row" data-feed-id={feed.id} data-category={feed.category} data-collapsed={feed.collapsed ? 'true' : null}>
  <RowHeader {feed} {visibleEvents} {rangeStart} {pxPerDay} {scrollEl} {rowIndex} />
  {#if !feed.collapsed}
    <div class="row-body" style="height: {bodyHeight}px;">
      {#each weekendStrips as w, i (i)}
        <i class="weekend-band" style="left: {w.left}px; width: {w.width}px"></i>
      {/each}
      {#each observanceStrips as o, i (i)}
        <i class="observance-strip" style="left: {o.left}px; width: {o.width}px"></i>
      {/each}
      {#each dayTicksPx as dx, i (i)}
        <i class="day-line" style="left: {dx}px"></i>
      {/each}
      {#each monthStartsPx as mx, i (i)}
        <i class="grid-line" style="left: {mx}px"></i>
      {/each}
      {#each sortedLaneEvents as e, i (e.uid)}
        <EventPill
          event={e}
          isMatch={matchUids.has(e.uid)}
          isCurrent={currentMatchUid === e.uid}
          isPast={e.end.getTime() < todayMs}
          isFocused={isFocusedRow && focus.eventIndex === i}
          isHolidayFeed={isHolidayFeed}
          feedColor={feed.color}
          feedStyle={feed.style}
          feedTravel={feed.travel}
          feedId={feed.id}
          onFocusEvent={focusByUid}
        />
      {/each}
    </div>
  {:else}
    <div class="row-collapsed">
      {#each observanceStrips as o, i (i)}
        <i class="observance-strip" style="left: {o.left}px; width: {o.width}px"></i>
      {/each}
      {#each dayTicksPx as dx, i (i)}
        <i class="day-line" style="left: {dx}px"></i>
      {/each}
      {#each monthStartsPx as mx, i (i)}
        <i class="grid-line" style="left: {mx}px"></i>
      {/each}
      {#each dots as d, i (d.ev.uid)}
        <button
          type="button"
          class="dot"
          data-highlight={isHighlightedDot(d.ev, i) ? 'true' : null}
          data-focused={isFocusedRow && focus.eventIndex === i ? 'true' : null}
          data-match={matchUids.has(d.ev.uid) ? 'true' : null}
          style="left: {d.px + pxPerDay / 2}px"
          aria-label={dotLabel(d.ev)}
          title={dotLabel(d.ev)}
          onclick={() => {
            focus.feedId = feed.id;
            focus.eventIndex = i;
            openDot(d.ev);
          }}
        ></button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .row {
    position: relative;
    width: max-content;
    min-width: 100%;
    background: var(--paper-2);
    border-top: 1px solid var(--ink);
    box-sizing: border-box;
  }
  .row:last-of-type {
    border-bottom: 1px solid var(--ink);
  }
  .row[data-collapsed='true'] {
    background: var(--paper);
  }
  .row-body {
    position: relative;
    box-sizing: border-box;
    background: var(--paper);
  }
  .row-collapsed {
    position: relative;
    height: 16px;
    background: var(--paper);
  }
  .observance-strip {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 0;
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 9px,
      var(--holiday-stripe) 9px,
      var(--holiday-stripe) 10px
    );
    background-attachment: fixed;
    opacity: 0.6;
  }
  .grid-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1px solid var(--ink);
    pointer-events: none;
    z-index: 0;
  }
  .day-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1px solid var(--ink-faint);
    pointer-events: none;
    z-index: 0;
  }
  .weekend-band {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--weekend-bg);
    pointer-events: none;
    z-index: 0;
  }
  .dot {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    border: none;
    padding: 0;
    background: var(--ink);
    transform: translate(-50%, -50%);
    cursor: pointer;
  }
  .dot:hover, .dot:focus-visible {
    width: 12px;
    height: 12px;
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .dot[data-match='true'] {
    width: 12px;
    height: 12px;
    background: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .dot[data-highlight='true'] {
    width: 12px;
    height: 12px;
    background: var(--accent);
  }
</style>
