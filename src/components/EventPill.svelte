<script lang="ts">
  import { ui, config, focus, pushLog } from '../lib/state.svelte';
  import { LANE_HEIGHT, ROW_PADDING_PX } from '../lib/layout';
  import { formatRange, formatTime } from '../lib/format';
  import { longPress } from '../lib/haptics';
  import type { CalendarColor, LaneEvent, StyleVariant } from '../lib/types';

  type Props = {
    event: LaneEvent;
    isMatch: boolean;
    isCurrent: boolean;
    isPast: boolean;
    isFocused: boolean;
    isHolidayFeed: boolean;
    feedColor?: CalendarColor;
    feedStyle?: StyleVariant;
    rowIndex: number;
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
    rowIndex,
    onFocusEvent,
  }: Props = $props();

  function open(): void {
    if (rowIndex >= 0) {
      focus.rowIndex = rowIndex;
      onFocusEvent?.(event.uid);
    }
    ui.modalEvent = event;
  }

  const dateLabel = $derived(
    formatRange(event.start, event.end, config.dateFormat, config.locale, event.allDay),
  );
  const timeLabel = $derived(
    event.allDay
      ? null
      : formatTime(event.start, config.timeFormat, config.timezone) +
          ' – ' +
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
    if (isHolidayFeed) return 'inverted-dashed';
    return null;
  });

  function copyContent(): void {
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

  let pressTimer: ReturnType<typeof setTimeout> | null = null;

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      longPress();
      copyContent();
    }, 500);
  }

  function cancelPress(): void {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }
</script>

<article
  data-all-day={event.allDay ? 'true' : null}
  data-match={isMatch ? 'true' : null}
  data-past={isPast ? 'true' : null}
  data-style={styleAttr}
  data-cal-color={feedColor ?? null}
  data-focus={isFocused ? 'true' : null}
  aria-current={isCurrent ? 'true' : null}
  style="left: {event.leftPx}px; width: {event.widthPx}px; top: {event.lane * LANE_HEIGHT + ROW_PADDING_PX}px;"
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
    <h3>{event.displayTitle}</h3>
  </button>
</article>

<style>
  article {
    position: absolute;
    height: 28px;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    overflow: visible;
    box-sizing: border-box;
    z-index: 0;
  }
  article:hover,
  article:focus-within {
    z-index: 2;
  }
  article[aria-current='true'],
  article[data-focus='true'] {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  button {
    display: block;
    width: 100%;
    height: 100%;
    padding: 4px 8px;
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
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
    overflow: visible;
    paint-order: stroke fill;
    -webkit-text-stroke: 0.5px var(--paper);
    text-shadow: 0 0 1px var(--paper);
  }
</style>
