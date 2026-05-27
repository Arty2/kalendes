<script lang="ts">
  import EventPill from './EventPill.svelte';
  import RowHeader from './RowHeader.svelte';
  import { ui, config, focus, selection, toggleSelected } from '../lib/state.svelte';
  import { dateToPx } from '../lib/layout';
  import { formatDate } from '../lib/format';
  import { today } from '../lib/today.svelte';
  import type { CalendarFeed, DisplayEvent, LaneEvent, StyleVariant } from '../lib/types';

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
      styleAttr: StyleVariant | null;
    }[];
    return [...visibleEvents]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((ev) => {
        const leftPx = dateToPx(ev.start, rangeStart, pxPerDay);
        const endPx = dateToPx(ev.end, rangeStart, pxPerDay);
        const widthPx = Math.max(pxPerDay, endPx - leftPx);
        const styleAttr =
          ev.styleVariant !== 'none'
            ? ev.styleVariant
            : (feed.style ?? (feed.category === 'holidays' ? 'bold' : null));
        return { ev, px: leftPx, leftPx, widthPx, multiDay: widthPx > pxPerDay * 1.5, styleAttr };
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
          data-cal-color={feed.color ?? null}
          data-style={d.styleAttr}
          data-past={d.ev.end.getTime() < todayMs ? 'true' : null}
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
    width: 10px;
    height: 10px;
    border-radius: 999px;
    border: 1px solid var(--ink);
    padding: 0;
    background: transparent;
    transform: translate(-50%, -50%);
    cursor: pointer;
  }
  .dot:focus {
    outline: none;
  }
  .span-bar {
    position: absolute;
    top: 50%;
    height: 4px;
    border: 1px solid var(--ink);
    border-radius: 999px;
    padding: 0;
    background: transparent;
    transform: translateY(-50%);
    cursor: pointer;
  }
  .span-bar:focus {
    outline: none;
  }
  /* Carry the calendar's color as the outline, matching expanded event pills. */
  .dot[data-cal-color='peach'], .span-bar[data-cal-color='peach'] { border-color: var(--cal-peach-border); }
  .dot[data-cal-color='amber'], .span-bar[data-cal-color='amber'] { border-color: var(--cal-amber-border); }
  .dot[data-cal-color='mint'], .span-bar[data-cal-color='mint'] { border-color: var(--cal-mint-border); }
  .dot[data-cal-color='teal'], .span-bar[data-cal-color='teal'] { border-color: var(--cal-teal-border); }
  .dot[data-cal-color='sky'], .span-bar[data-cal-color='sky'] { border-color: var(--cal-sky-border); }
  .dot[data-cal-color='lavender'], .span-bar[data-cal-color='lavender'] { border-color: var(--cal-lavender-border); }
  /* Carry the event/feed style variant, matching expanded pills. (striked has
     no pill representation since pills carry no text.) */
  .dot[data-style='bold'], .span-bar[data-style='bold'] { border-width: 2px; }
  /* Border-box keeps the outer size fixed, so bump the round pill 2px to keep
     the heavier 2px border visually balanced. */
  .dot[data-style='bold'] { width: 11px; height: 11px; }
  .dot[data-style='dashed'], .span-bar[data-style='dashed'] { border-style: dashed; }
  .dot[data-style='inverted'], .span-bar[data-style='inverted'] { background: var(--ink); }
  /* Past pills mute the same way expanded rows do. */
  .dot[data-past='true'], .span-bar[data-past='true'] {
    opacity: var(--past-opacity);
  }
  .dot[data-style='muted'], .span-bar[data-style='muted'] { opacity: 0.4; }
  .dot[data-style='hidden'], .span-bar[data-style='hidden'] {
    opacity: 0.25;
    filter: grayscale(1);
    cursor: not-allowed;
  }
  .dot[data-match='true'] {
    background: var(--accent);
    border-color: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .dot[data-highlight='true'],
  .dot[data-selected='true'] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .span-bar[data-match='true'],
  .span-bar[data-highlight='true'],
  .span-bar[data-selected='true'] {
    background: var(--accent);
    border-color: var(--accent);
  }
</style>
