<script lang="ts">
  import EventPill from './EventPill.svelte';
  import RowHeader from './RowHeader.svelte';
  import { ui, config, focus, selection, toggleSelected, effectiveFeedTz } from '../lib/state.svelte';
  import { dateToPx } from '../lib/layout';
  import { formatDate } from '../lib/format';
  import { mergeConsecutiveDays } from '../lib/event-display';
  import { today } from '../lib/today.svelte';
  import { clock } from '../lib/clock.svelte';
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
    dayTicksPx: { px: number; past: boolean }[];
    thickStrips: { left: number; width: number }[];
    thinStrips: { left: number; width: number }[];
    rowIndex: number;
    visibleLeft: number;
    visibleRight: number;
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
    dayTicksPx,
    thickStrips,
    thinStrips,
    rowIndex,
    visibleLeft,
    visibleRight,
  }: Props = $props();

  const visibleEvents = $derived(
    events.filter((e) => !e.hidden || e.styleVariant === 'hidden'),
  );
  const sortedLaneEvents = $derived(
    [...laneEvents].sort((a, b) => a.start.getTime() - b.start.getTime()),
  );

  // Viewport virtualization: only render nodes intersecting the scroll window
  // (with overscan, computed in Timeline). Returns true when the window isn't
  // measured yet so the first paint renders everything.
  function inWindow(left: number, width: number): boolean {
    if (!(visibleRight > visibleLeft)) return true;
    return left <= visibleRight && left + width >= visibleLeft;
  }
  const vThick = $derived(thickStrips.filter((o) => inWindow(o.left, o.width)));
  const vThin = $derived(thinStrips.filter((o) => inWindow(o.left, o.width)));
  const vDayTicks = $derived(dayTicksPx.filter((d) => inWindow(d.px, 0)));
  // Preserve each event's index in the full sorted list so focus/keyboard
  // navigation (which addresses events by index) stays correct when the
  // rendered set is a filtered subset.
  const vLaneEvents = $derived(
    sortedLaneEvents
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => inWindow(e.leftPx, e.widthPx)),
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
    // Merge consecutive-day runs so a collapsed feed shows one continuous
    // span-bar instead of a row of dots (matching the expanded lane behaviour).
    const merged = mergeConsecutiveDays(visibleEvents, effectiveFeedTz(feed.id) ?? config.timezone);
    return [...merged]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((ev) => {
        const leftPx = dateToPx(ev.start, rangeStart, pxPerDay);
        const endPx = dateToPx(ev.end, rangeStart, pxPerDay);
        const widthPx = Math.max(pxPerDay, endPx - leftPx);
        const styleAttr =
          ev.styleVariant !== 'none' ? ev.styleVariant : (feed.style ?? null);
        return { ev, px: leftPx, leftPx, widthPx, multiDay: widthPx > pxPerDay * 1.5, styleAttr };
      });
  });

  const vDots = $derived(
    dots.map((d, i) => ({ d, i })).filter(({ d }) => inWindow(d.leftPx, d.widthPx)),
  );

  const todayMs = $derived(today.value.getTime());

  // Day-granular "past" (end before the start of today), but never dim an event
  // the now-line sits inside of. A merged/combined bar that spans the current
  // instant — or a timed event running through the pre-dawn window where UTC
  // start-of-day is still ahead of the local clock — is current, not past.
  function isPastEvent(e: { start: Date; end: Date }): boolean {
    if (e.start.getTime() <= clock.now && clock.now < e.end.getTime()) return false;
    return e.end.getTime() < todayMs;
  }

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

  const isFocusedRow = $derived(focus.feedId === feed.id);
</script>

<section class="row" data-feed-id={feed.id} data-category={feed.category} data-collapsed={feed.collapsed ? 'true' : null}>
  <RowHeader {feed} {visibleEvents} {rangeStart} {pxPerDay} {scrollEl} {rowIndex} />
  {#if !feed.collapsed}
    <div class="row-body" style="height: {bodyHeight}px;">
      {#each vThick as o (o.left)}
        <i class="holiday-strip" style="left: {o.left}px; width: {o.width}px"></i>
      {/each}
      {#each vThin as o (o.left)}
        <i class="observance-strip" style="left: {o.left}px; width: {o.width}px"></i>
      {/each}
      {#each vDayTicks as dx (dx.px)}
        <i class="day-line" data-past={dx.past ? 'true' : null} style="left: {dx.px}px"></i>
      {/each}
      {#each vLaneEvents as { e, i } (e.uid)}
        <EventPill
          event={e}
          isMatch={matchUids.has(e.uid)}
          isCurrent={currentMatchUid === e.uid}
          isPast={isPastEvent(e)}
          isFocused={isFocusedRow && focus.eventIndex === i}
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
      {#each vThick as o (o.left)}
        <i class="holiday-strip" style="left: {o.left}px; width: {o.width}px"></i>
      {/each}
      {#each vThin as o (o.left)}
        <i class="observance-strip" style="left: {o.left}px; width: {o.width}px"></i>
      {/each}
      {#each vDayTicks as dx (dx.px)}
        <i class="day-line" data-past={dx.past ? 'true' : null} style="left: {dx.px}px"></i>
      {/each}
      {#each vDots as { d, i } (d.ev.uid)}
        <button
          type="button"
          class={d.multiDay ? 'span-bar' : 'dot'}
          data-cal-color={d.ev.ruleColor ?? feed.color ?? null}
          data-style={d.styleAttr}
          data-past={isPastEvent(d.ev) ? 'true' : null}
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
    border-top: var(--border-w) solid var(--ink-color);
    box-sizing: border-box;
  }
  /* The first feed sits right under the time header's own rule, which reads as
     a doubled line — paint its top border in the page colour instead (the
     border stays, so row heights don't shift between first and later rows). */
  .row:first-of-type {
    border-top-color: var(--paper-color);
  }
  .row:last-of-type {
    border-bottom: var(--border-w) solid var(--ink-color);
  }
  .row[data-collapsed='true'] {
    background: var(--paper-color);
  }
  .row-body {
    position: relative;
    box-sizing: border-box;
    background: var(--paper-color);
  }
  .row-collapsed {
    position: relative;
    height: 16px;
    background: var(--paper-color);
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
  .day-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: var(--border-w) solid var(--ink-faint);
    pointer-events: none;
    z-index: 0;
  }
  /* Past separators are subtler. */
  .day-line[data-past='true'] {
    opacity: 0.4;
  }
  .dot {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    border-radius: 999px;
    border: var(--border-w) solid var(--ink-color);
    padding: 0;
    /* Same translucent fill as expanded pills (page colour, or the calendar tint
       via the --pill-fill overrides below), so a collapsed pill carries its bg
       colour too. */
    background: var(--pill-fill);
    transform: translate(-50%, -50%);
    cursor: pointer;
  }
  .dot:focus {
    outline: none;
  }
  .span-bar {
    position: absolute;
    top: 50%;
    height: 10px;
    border: var(--border-w) solid var(--ink-color);
    border-radius: 999px;
    padding: 0;
    background: var(--pill-fill);
    transform: translateY(-50%);
    cursor: pointer;
  }
  .span-bar:focus {
    outline: none;
  }
  /* Carry the calendar's colour as the outline AND flip --pill-fill to the tint,
     matching expanded pills (styles/global.css) so the fill above is coloured. */
  .dot[data-cal-color='peach'], .span-bar[data-cal-color='peach'] { border-color: var(--cal-peach-border); --pill-fill: color-mix(in srgb, var(--cal-peach-bg) var(--pill-alpha), transparent); }
  .dot[data-cal-color='amber'], .span-bar[data-cal-color='amber'] { border-color: var(--cal-amber-border); --pill-fill: color-mix(in srgb, var(--cal-amber-bg) var(--pill-alpha), transparent); }
  .dot[data-cal-color='mint'], .span-bar[data-cal-color='mint'] { border-color: var(--cal-mint-border); --pill-fill: color-mix(in srgb, var(--cal-mint-bg) var(--pill-alpha), transparent); }
  .dot[data-cal-color='teal'], .span-bar[data-cal-color='teal'] { border-color: var(--cal-teal-border); --pill-fill: color-mix(in srgb, var(--cal-teal-bg) var(--pill-alpha), transparent); }
  .dot[data-cal-color='sky'], .span-bar[data-cal-color='sky'] { border-color: var(--cal-sky-border); --pill-fill: color-mix(in srgb, var(--cal-sky-bg) var(--pill-alpha), transparent); }
  .dot[data-cal-color='lavender'], .span-bar[data-cal-color='lavender'] { border-color: var(--cal-lavender-border); --pill-fill: color-mix(in srgb, var(--cal-lavender-bg) var(--pill-alpha), transparent); }
  /* Outline keeps the calendar's tinted border but no colour fill — just the
     outline, even when a colour applies (2-attr selector beats the fills above). */
  .dot[data-style='outline'][data-cal-color], .span-bar[data-style='outline'][data-cal-color] { --pill-fill: color-mix(in srgb, var(--paper-color) var(--pill-alpha), transparent); }
  /* Carry the event/feed style variant, matching expanded pills. (striked has
     no pill representation since pills carry no text.) */
  .dot[data-style='bold'], .span-bar[data-style='bold'] { border-width: calc(var(--border-w) + 1px); }
  /* Border-box keeps the outer size fixed, so bump the round pill 2px to keep
     the heavier 2px border visually balanced. */
  .dot[data-style='bold'] { width: 12px; height: 12px; }
  /* Keep the focused bold dot at its prior size so focusing doesn't enlarge it. */
  .dot[data-style='bold'][data-focused='true'] { width: 11px; height: 11px; }
  .dot[data-style='dashed'], .span-bar[data-style='dashed'] { border-style: dashed; }
  .dot[data-style='inverted'], .span-bar[data-style='inverted'] { background: var(--ink-color); }
  /* A colored calendar's Solid (inverted) pill fills with the calendar bg tint
     and keeps its coloured border — identical to expanded pills, so a feed looks
     the same collapsed or expanded. 2-attr selectors beat the ink fill above. */
  .dot[data-style='inverted'][data-cal-color='peach'], .span-bar[data-style='inverted'][data-cal-color='peach'] { background: var(--cal-peach-bg); }
  .dot[data-style='inverted'][data-cal-color='amber'], .span-bar[data-style='inverted'][data-cal-color='amber'] { background: var(--cal-amber-bg); }
  .dot[data-style='inverted'][data-cal-color='mint'], .span-bar[data-style='inverted'][data-cal-color='mint'] { background: var(--cal-mint-bg); }
  .dot[data-style='inverted'][data-cal-color='teal'], .span-bar[data-style='inverted'][data-cal-color='teal'] { background: var(--cal-teal-bg); }
  .dot[data-style='inverted'][data-cal-color='sky'], .span-bar[data-style='inverted'][data-cal-color='sky'] { background: var(--cal-sky-bg); }
  .dot[data-style='inverted'][data-cal-color='lavender'], .span-bar[data-style='inverted'][data-cal-color='lavender'] { background: var(--cal-lavender-bg); }
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
    background: var(--accent-color);
    border-color: var(--accent-color);
    outline: 2px solid var(--accent-color);
    outline-offset: 1px;
  }
  .dot[data-highlight='true'],
  .dot[data-selected='true'] {
    background: var(--accent-color);
    border-color: var(--accent-color);
  }
  .span-bar[data-match='true'],
  .span-bar[data-highlight='true'],
  .span-bar[data-selected='true'] {
    background: var(--accent-color);
    border-color: var(--accent-color);
  }
</style>
