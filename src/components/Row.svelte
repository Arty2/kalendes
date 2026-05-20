<script lang="ts">
  import EventPill from './EventPill.svelte';
  import RowHeader from './RowHeader.svelte';
  import { ui, config, focus, selection, toggleSelected } from '../lib/state.svelte';
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
    monthStartsPx: { px: number; past: boolean }[];
    weekendStrips: { left: number; width: number; past: boolean }[];
    dayTicksPx: { px: number; past: boolean }[];
    thickStrips: { left: number; width: number }[];
    thinStrips: { left: number; width: number }[];
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
    thickStrips,
    thinStrips,
    rowIndex,
  }: Props = $props();

  const visibleEvents = $derived(
    events.filter((e) => !e.hidden || e.styleVariant === 'hidden'),
  );
  const sortedLaneEvents = $derived(
    [...laneEvents].sort((a, b) => a.start.getTime() - b.start.getTime()),
  );

  function focusByUid(uid: string): void {
    const idx = sortedLaneEvents.findIndex((e) => e.uid === uid);
    if (idx >= 0) focus.eventIndex = idx;
  }

  // Collapsed rows: single-day events render as dots; multi-day events render
  // as a thin bar spanning their full duration.
  const dots = $derived.by(() => {
    if (!feed.collapsed) return [] as {
      ev: DisplayEvent;
      px: number;
      leftPx: number;
      widthPx: number;
      multiDay: boolean;
    }[];
    return [...visibleEvents]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((ev) => {
        const leftPx = dateToPx(ev.start, rangeStart, pxPerDay);
        const endPx = dateToPx(ev.end, rangeStart, pxPerDay);
        const widthPx = Math.max(pxPerDay, endPx - leftPx);
        return { ev, px: leftPx, leftPx, widthPx, multiDay: widthPx > pxPerDay * 1.5 };
      });
  });

  const todayMs = $derived(today.value.getTime());

  function dotLabel(ev: DisplayEvent): string {
    return ev.displayTitle + ' · ' + formatDate(ev.start, config.dateFormat, config.locale);
  }

  function openDot(ev: DisplayEvent): void {
    if (selection.mode) {
      toggleSelected(ev.uid);
      return;
    }
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
        <i class="weekend-band" data-past={w.past ? 'true' : null} style="left: {w.left}px; width: {w.width}px"></i>
      {/each}
      {#each thickStrips as o, i (i)}
        <i class="holiday-strip" style="left: {o.left}px; width: {o.width}px"></i>
      {/each}
      {#each thinStrips as o, i (i)}
        <i class="observance-strip" style="left: {o.left}px; width: {o.width}px"></i>
      {/each}
      {#each dayTicksPx as dx, i (i)}
        <i class="day-line" data-past={dx.past ? 'true' : null} style="left: {dx.px}px"></i>
      {/each}
      {#each monthStartsPx as mx, i (i)}
        <i class="grid-line" data-past={mx.past ? 'true' : null} style="left: {mx.px}px"></i>
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
      {#each thickStrips as o, i (i)}
        <i class="holiday-strip" style="left: {o.left}px; width: {o.width}px"></i>
      {/each}
      {#each thinStrips as o, i (i)}
        <i class="observance-strip" style="left: {o.left}px; width: {o.width}px"></i>
      {/each}
      {#each dayTicksPx as dx, i (i)}
        <i class="day-line" data-past={dx.past ? 'true' : null} style="left: {dx.px}px"></i>
      {/each}
      {#each monthStartsPx as mx, i (i)}
        <i class="grid-line" data-past={mx.past ? 'true' : null} style="left: {mx.px}px"></i>
      {/each}
      {#each dots as d, i (d.ev.uid)}
        <button
          type="button"
          class={d.multiDay ? 'span-bar' : 'dot'}
          data-highlight={isHighlightedDot(d.ev, i) ? 'true' : null}
          data-focused={isFocusedRow && focus.eventIndex === i ? 'true' : null}
          data-match={matchUids.has(d.ev.uid) ? 'true' : null}
          data-selected={selection.uids.has(d.ev.uid) ? 'true' : null}
          style={d.multiDay
            ? `left: ${d.leftPx}px; width: ${d.widthPx}px`
            : `left: ${d.px + pxPerDay / 2}px`}
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
  .holiday-strip {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 0;
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 4px,
      var(--holiday-stripe) 4px,
      var(--holiday-stripe) 5px
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
  /* Collapsed rows show dashed month separators. */
  .row-collapsed .grid-line {
    border-left-style: dashed;
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
  /* Past separators are subtler. */
  .grid-line[data-past='true'],
  .day-line[data-past='true'] {
    opacity: 0.4;
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
  }
  .dot:focus {
    outline: none;
  }
  .dot[data-match='true'] {
    width: 12px;
    height: 12px;
    background: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .dot[data-highlight='true'],
  .dot[data-selected='true'] {
    width: 12px;
    height: 12px;
    background: var(--accent);
  }
  .span-bar {
    position: absolute;
    top: 50%;
    height: 6px;
    border: none;
    border-radius: 3px;
    padding: 0;
    background: var(--ink);
    transform: translateY(-50%);
    cursor: pointer;
  }
  .span-bar:focus {
    outline: none;
  }
  .span-bar[data-match='true'],
  .span-bar[data-highlight='true'],
  .span-bar[data-selected='true'] {
    background: var(--accent);
  }
</style>
