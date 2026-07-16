<script lang="ts">
  import {
    ui,
    config,
    focus,
    pushLog,
    selection,
    toggleSelected,
    addToSelection,
    focusEventByUid,
    isKiosk,
    openHoverPreview,
    closeHoverPreviewSoon,
    cancelHoverPreview,
  } from '../lib/state.svelte';
  import Icon from './Icon.svelte';
  import { travelIcon } from '../lib/icons';
  import { LANE_HEIGHT, ROW_PADDING_PX, AVG_CHAR_EM, BUTTON_PADDING_PX } from '../lib/layout';
  import { formatRange } from '../lib/format';
  import { formatEventTimeLabel } from '../lib/event-display';
  import { matchingRulesFor } from '../lib/rules';
  import { createLongPress } from '../lib/haptics';
  import type { CalendarColor, LaneEvent, StyleVariant, Travel } from '../lib/types';

  type Props = {
    event: LaneEvent;
    isMatch: boolean;
    isCurrent: boolean;
    isPast: boolean;
    isFocused: boolean;
    feedColor?: CalendarColor;
    feedStyle?: StyleVariant;
    feedTravel?: Travel;
    feedId: string;
    onFocusEvent?: (eventUid: string) => void;
  };
  const {
    event,
    isMatch,
    isCurrent,
    isPast,
    isFocused,
    feedColor,
    feedStyle,
    feedTravel,
    feedId,
    onFocusEvent,
  }: Props = $props();

  function open(): void {
    // Swallow the click synthesized right after a long-press so it doesn't
    // immediately toggle the just-selected pill back off (mouse and touch).
    if (press.didFire()) return;
    // A real click takes over from the hover preview.
    cancelHoverPreview();
    if (selection.mode) {
      const wasSelected = selection.uids.has(event.uid);
      toggleSelected(event.uid);
      if (wasSelected) {
        // Deselect: don't keep focus on the now-unselected event — move it to
        // the most recently selected remaining event instead.
        const remaining = [...selection.uids];
        const prev = remaining[remaining.length - 1];
        if (prev) focusEventByUid(prev);
        else {
          focus.feedId = null;
          focus.eventIndex = -1;
        }
      } else {
        focus.feedId = feedId;
        onFocusEvent?.(event.uid);
      }
      return;
    }
    focus.feedId = feedId;
    onFocusEvent?.(event.uid);
    ui.modalEvent = event;
  }

  function enterSelection(): void {
    // Long-press won — drop the hover preview so it doesn't linger on desktop.
    cancelHoverPreview();
    selection.mode = true;
    addToSelection(event.uid);
  }

  const dateLabel = $derived(
    formatRange(event.start, event.end, config.dateFormat, config.locale),
  );
  const timeLabel = $derived(
    event.allDay ? null : formatEventTimeLabel(event, config.timeFormat, config.timezone),
  );

  const styleAttr = $derived.by(() => {
    if (event.styleVariant !== 'none') return event.styleVariant;
    if (feedStyle) return feedStyle;
    return null;
  });
  // A matching rule's color overrides the calendar color, mirroring style.
  const colorAttr = $derived(event.ruleColor ?? feedColor ?? null);

  // Past events show only the first word of the title (the rest fades out via
  // the mask in global.css) — unless focused/selected/current, where the full
  // label is shown. Upcoming events always show the full title.
  const showFullLabel = $derived(
    isFocused || isCurrent || selection.uids.has(event.uid),
  );
  // Wide pills (multi-day events) have room for the whole label, so the
  // first-word truncation + fade mask are needless there. Estimate the title's
  // rendered width from its length and the current font size rather than
  // measuring the DOM: the root font-size is config.fontSize px, so the h3
  // (--fs-13) renders at config.fontSize * 13/14 px per em. AVG_CHAR_EM /
  // BUTTON_PADDING_PX are shared with assignLanes' label-width reservation.
  const labelFits = $derived(
    event.displayTitle.trim().length * AVG_CHAR_EM * (config.fontSize * 13 / 14) <=
      event.widthPx - BUTTON_PADDING_PX,
  );
  // A pill with a same-lane neighbour only has labelRoomPx of horizontal room
  // before its label would smear over that neighbour — clip + fade the label at
  // that edge (hover/focus reveal the full title, see global.css). Same width
  // estimate as labelFits. Past pills keep their first-word treatment instead.
  const labelClipped = $derived(
    event.labelRoomPx !== undefined &&
      event.displayTitle.trim().length * AVG_CHAR_EM * (config.fontSize * 13 / 14) >
        event.labelRoomPx - BUTTON_PADDING_PX,
  );
  const titleText = $derived(
    isPast && !showFullLabel && !labelFits
      ? (event.displayTitle.trim().split(/\s+/)[0] ?? '')
      : event.displayTitle,
  );

  // A small dot marks pills that a find-replace rule (filter) matched.
  const hasFilter = $derived(matchingRulesFor(event, config.rules).length > 0);

  // A per-event travel tag (local-lane events) counts like the feed's.
  const showLocation = $derived(
    !!event.displayLocation && (event.travel ?? feedTravel ?? 'none') !== 'none',
  );
  const travelIconName = $derived(travelIcon(event.travel ?? feedTravel));
  const showTime = $derived(!event.allDay && !!timeLabel);

  function copyContent(): void {
    if (isKiosk()) return;
    const lines = [event.displayTitle, dateLabel];
    if (timeLabel) lines.push(timeLabel);
    if (event.displayLocation) lines.push(event.displayLocation);
    if (event.displayDescription) {
      lines.push('');
      lines.push(event.displayDescription);
    }
    const text = lines.join('\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard
        .writeText(text)
        .then(() => pushLog('Copied event details'))
        .catch(() => pushLog('Copy failed', 'error'));
    }
  }

  // Lane metrics scale with the font-size setting so pills keep their relative
  // vertical spacing as text grows. Must match Timeline's row-height math.
  const laneH = $derived(Math.round(LANE_HEIGHT * (config.fontSize / 14)));
  const rowPad = $derived(Math.round(ROW_PADDING_PX * (config.fontSize / 14)));

  const press = createLongPress();

  function onPointerDown(): void {
    // Long-press to enter selection mode — on touch and mouse alike (desktop
    // has no other pointer entry; a quick click / dblclick cancels the timer).
    if (isKiosk()) return;
    press.start(enterSelection);
  }

  function cancelPress(): void {
    press.cancel();
  }

  // Mouse-only hover preview (touch keeps tap/long-press). Entering opens the
  // popover after a short intent delay; leaving closes it after a grace period.
  function onPointerEnter(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    openHoverPreview(event, (e.currentTarget as HTMLElement).getBoundingClientRect());
  }
  function onPointerLeave(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    closeHoverPreviewSoon();
  }
</script>

<article
  data-all-day={event.allDay ? 'true' : null}
  data-match={isMatch ? 'true' : null}
  data-past={isPast ? 'true' : null}
  data-label-fits={isPast && !showFullLabel && labelFits ? 'true' : null}
  data-clip={!isPast && labelClipped ? 'true' : null}
  data-style={styleAttr}
  data-cal-color={colorAttr}
  data-focus={isFocused ? 'true' : null}
  data-filter={hasFilter ? 'true' : null}
  data-selected={selection.uids.has(event.uid) ? 'true' : null}
  aria-current={isCurrent ? 'true' : null}
  style="left: {event.leftPx}px; width: {event.widthPx}px; top: {event.lane * laneH + rowPad}px; max-height: {laneH - 1}px;{labelClipped ? ` --label-clip-w: ${event.labelRoomPx}px;` : ''}"
>
  <button
    type="button"
    onclick={open}
    ondblclick={copyContent}
    onpointerdown={onPointerDown}
    onpointerup={cancelPress}
    onpointercancel={cancelPress}
    onpointermove={cancelPress}
    onpointerenter={onPointerEnter}
    onpointerleave={onPointerLeave}
    aria-label="Open event {event.displayTitle}"
  >
    <span class="pill-content">
      <h3>{titleText}{#if (event.spanDays ?? 1) > 1}<span class="span-count" data-mono>&nbsp;×{event.spanDays}</span>{/if}</h3>
      {#if showTime}
        <p class="meta meta-time" data-mono>{timeLabel}</p>
      {/if}
      {#if showLocation}
        <p class="meta meta-location">
          {#if travelIconName}<Icon name={travelIconName} size={10} />{/if}{event.displayLocation}
        </p>
      {/if}
    </span>
  </button>
</article>

<style>
  article {
    position: absolute;
    min-height: 14px;
    border: var(--border-w) solid var(--ink-color);
    border-radius: var(--pill-radius);
    /* Shared translucent fill (page colour, or the calendar tint via
       --pill-fill overrides in global.css) — same at every zoom. */
    background: var(--pill-fill);
    color: var(--ink-color);
    overflow: visible;
    box-sizing: border-box;
    z-index: 0;
  }
  article:hover,
  article:focus-within {
    z-index: 2;
  }
  button {
    display: block;
    width: 100%;
    height: 100%;
    padding: 2px 8px;
    background: transparent;
    color: inherit;
    border: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    overflow: visible;
  }
  /* Pills colour themselves from container state (selected/current/focused inverted style), so
     opt out of the global chrome button hover/focus text tint. */
  button:hover,
  button:focus-visible {
    color: inherit;
  }
  /* Keep the label pinned to the visible left edge as a wide/multi-day pill
     scrolls under the viewport — the title/time/location stay readable instead
     of sliding off with the pill's left end. Shrink-wrapped so it can slide
     within the pill, and clamped to the pill's box so it never leaves it. */
  .pill-content {
    position: sticky;
    left: 8px;
    display: inline-block;
    vertical-align: top;
    max-width: 100%;
  }
  h3 {
    margin: 0;
    font-size: var(--fs-13);
    font-weight: 400;
    line-height: 1.4;
    white-space: nowrap;
    overflow: visible;
    paint-order: stroke fill;
    /* Non-solid pills halo their text with the page colour (legible over the
       grid / neighbours). Solid pills override this to their own bg colour in
       global.css, so a bg-matched halo is a solid-only treatment. */
    -webkit-text-stroke: var(--stroke-w) var(--paper-color);
    text-shadow: 0 0 1px var(--paper-color);
  }
  /* Consecutive-day span count (×N) trailing a merged run's title — same colour
     as the title text. */
  .span-count {
    color: inherit;
  }
  .meta {
    margin: 0;
    font-size: var(--fs-10);
    line-height: 1.2;
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: visible;
  }
  /* Pull the time up toward the title (reduces vertical reach so pills in
     adjacent lanes overlap less) and give it the same paper stroke as the
     title for legibility over neighbouring pills. */
  .meta-time {
    margin-top: -4px;
    paint-order: stroke fill;
    -webkit-text-stroke: var(--stroke-w) var(--paper-color);
    text-shadow: 0 0 1px var(--paper-color);
  }
  /* The travel charm sits inline before the location text. */
  .meta-location :global(.icon) {
    margin-right: 3px;
    vertical-align: -2px;
  }
</style>
