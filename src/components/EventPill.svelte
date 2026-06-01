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
  } from '../lib/state.svelte';
  import { LANE_HEIGHT, ROW_PADDING_PX } from '../lib/layout';
  import { formatRange, formatTime } from '../lib/format';
  import { matchingRulesFor } from '../lib/rules';
  import { createLongPress } from '../lib/haptics';
  import type { CalendarColor, LaneEvent, StyleVariant, Travel } from '../lib/types';

  type Props = {
    event: LaneEvent;
    isMatch: boolean;
    isCurrent: boolean;
    isPast: boolean;
    isFocused: boolean;
    isHolidayFeed: boolean;
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
    isHolidayFeed,
    feedColor,
    feedStyle,
    feedTravel,
    feedId,
    onFocusEvent,
  }: Props = $props();

  function open(): void {
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
    selection.mode = true;
    addToSelection(event.uid);
  }

  const dateLabel = $derived(
    formatRange(event.start, event.end, config.dateFormat, config.locale),
  );
  const timeLabel = $derived(
    event.allDay
      ? null
      : formatTime(event.start, config.timeFormat, config.timezone) +
          ' — ' +
          formatTime(event.end, config.timeFormat, config.timezone),
  );

  const tooltip = $derived.by(() => {
    const parts: string[] = [event.displayTitle, dateLabel];
    if (timeLabel) parts.push(timeLabel);
    if (event.displayLocation) parts.push(event.displayLocation);
    return parts.join(' · ');
  });

  const styleAttr = $derived.by(() => {
    if (event.styleVariant !== 'none') return event.styleVariant;
    if (feedStyle) return feedStyle;
    if (isHolidayFeed) return 'bold';
    return null;
  });

  // Past events show only the first word of the title (the rest fades out via
  // the mask in global.css) — unless focused/selected/current, where the full
  // label is shown. Upcoming events always show the full title.
  const showFullLabel = $derived(
    isFocused || isCurrent || selection.uids.has(event.uid),
  );
  const titleText = $derived(
    isPast && !showFullLabel ? (event.displayTitle.trim().split(/\s+/)[0] ?? '') : event.displayTitle,
  );

  // A small dot marks pills that a find-replace rule (filter) matched.
  const hasFilter = $derived(matchingRulesFor(event, config.rules).length > 0);

  const showLocation = $derived(
    !!event.displayLocation &&
      feedTravel !== undefined &&
      feedTravel !== 'none',
  );
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

  function onPointerDown(e: PointerEvent): void {
    if (isKiosk()) return;
    if (e.pointerType !== 'touch') return;
    press.start(enterSelection);
  }

  function cancelPress(): void {
    press.cancel();
  }
</script>

<article
  data-all-day={event.allDay ? 'true' : null}
  data-match={isMatch ? 'true' : null}
  data-past={isPast ? 'true' : null}
  data-style={styleAttr}
  data-cal-color={feedColor ?? null}
  data-focus={isFocused ? 'true' : null}
  data-filter={hasFilter ? 'true' : null}
  data-selected={selection.uids.has(event.uid) ? 'true' : null}
  aria-current={isCurrent ? 'true' : null}
  style="left: {event.leftPx}px; width: {event.widthPx}px; top: {event.lane * laneH + rowPad}px;"
>
  <button
    type="button"
    onclick={open}
    ondblclick={copyContent}
    onpointerdown={onPointerDown}
    onpointerup={cancelPress}
    onpointercancel={cancelPress}
    onpointermove={cancelPress}
    aria-label="Open event {event.displayTitle}"
    title={tooltip}
  >
    <h3>{titleText}</h3>
    {#if showTime}
      <p class="meta meta-time" data-mono>{timeLabel}</p>
    {/if}
    {#if showLocation}
      <p class="meta meta-location">{event.displayLocation}</p>
    {/if}
  </button>
</article>

<style>
  article {
    position: absolute;
    min-height: 14px;
    border: 1px solid var(--ink);
    background: transparent;
    color: var(--ink);
    overflow: visible;
    box-sizing: border-box;
    z-index: 0;
  }
  article:hover,
  article:focus-within {
    z-index: 2;
  }
  /* Discreet backtick mark in the pill's top-left corner when a filter matches. */
  article[data-filter='true']::before {
    content: '`';
    position: absolute;
    top: -2px;
    left: 4px;
    font-size: var(--fs-14);
    font-weight: 700;
    line-height: 1;
    color: inherit;
    pointer-events: none;
    z-index: 3;
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
  h3 {
    margin: 0;
    font-size: var(--fs-12);
    font-weight: 400;
    line-height: 1.4;
    white-space: nowrap;
    overflow: visible;
    paint-order: stroke fill;
    -webkit-text-stroke: var(--stroke-w) var(--paper);
    text-shadow: 0 0 1px var(--paper);
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
    -webkit-text-stroke: var(--stroke-w) var(--paper);
    text-shadow: 0 0 1px var(--paper);
  }
</style>
