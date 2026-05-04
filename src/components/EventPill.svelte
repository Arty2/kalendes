<script lang="ts">
  import { ui, config, focus } from '../lib/state.svelte';
  import { LANE_HEIGHT, ROW_PADDING_PX } from '../lib/layout';
  import { formatRange, formatTime } from '../lib/format';
  import type { LaneEvent } from '../lib/types';

  type Props = {
    event: LaneEvent;
    isMatch: boolean;
    isCurrent: boolean;
    isPast: boolean;
    isFocused: boolean;
    isHolidayFeed: boolean;
  };
  const { event, isMatch, isCurrent, isPast, isFocused, isHolidayFeed }: Props = $props();

  function open(): void {
    ui.modalEvent = event;
    focus.eventIndex = -1;
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

  const styleAttr = $derived.by(() => {
    if (event.styleVariant !== 'none') return event.styleVariant;
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
        .then(() => {
          ui.toast = 'Copied';
          setTimeout(() => {
            if (ui.toast === 'Copied') ui.toast = null;
          }, 2000);
        })
        .catch(() => {
          ui.toast = 'Copy failed';
          setTimeout(() => {
            if (ui.toast === 'Copy failed') ui.toast = null;
          }, 2000);
        });
    }
  }

  let pressTimer: ReturnType<typeof setTimeout> | null = null;

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    pressTimer = setTimeout(() => {
      pressTimer = null;
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
    title={event.displayTitle}
  >
    <h3>{event.displayTitle}</h3>
    {#if event.displayLocation?.trim()}
      <p class="loc">{event.displayLocation}</p>
    {/if}
    <time data-mono datetime={event.start.toISOString()}>{dateLabel}</time>
    {#if timeLabel}
      <time data-mono class="time" datetime={event.start.toISOString()}>{timeLabel}</time>
    {/if}
  </button>
</article>

<style>
  article {
    position: absolute;
    height: 48px;
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
    padding: 2px 6px;
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
    line-height: 1.2;
    white-space: nowrap;
  }
  p {
    margin: 0;
    font-size: 10px;
    line-height: 1.2;
    white-space: nowrap;
  }
  time {
    display: block;
    font-size: 10px;
    line-height: 1.2;
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .time {
    color: var(--ink);
    opacity: 0.85;
  }
</style>
