<script lang="ts">
  import {
    ui,
    config,
    selection,
    toggleSelected,
    addToSelection,
    focusEventByUid,
    isKiosk,
  } from '../lib/state.svelte';
  import { formatTime } from '../lib/format';
  import { createLongPress } from '../lib/haptics';
  import type { CalendarColor, DisplayEvent, StyleVariant } from '../lib/types';

  type Props = {
    event: DisplayEvent;
    // Primary zone (weekTzTop) the grid is laid out in — the time label reads in
    // the same zone the block is positioned by, so they never disagree.
    tz: string;
    feedColor?: CalendarColor;
    feedStyle?: StyleVariant;
    // 'block' = a timed grid block (title + time); 'bar' = an all-day strip bar.
    mode?: 'block' | 'bar';
    isMatch?: boolean;
    isCurrent?: boolean;
    isPast?: boolean;
    // Absolute placement (top/height/left/width) computed by WeekGrid.
    placement: string;
  };
  const {
    event,
    tz,
    feedColor,
    feedStyle,
    mode = 'block',
    isMatch = false,
    isCurrent = false,
    isPast = false,
    placement,
  }: Props = $props();

  // Mirror EventPill: a matching rule's color/style overrides the calendar's.
  const colorAttr = $derived(event.ruleColor ?? feedColor ?? null);
  const styleAttr = $derived.by<StyleVariant | null>(() => {
    if (event.styleVariant !== 'none') return event.styleVariant;
    if (feedStyle) return feedStyle;
    return null;
  });

  const timeLabel = $derived(
    event.allDay
      ? null
      : formatTime(event.start, config.timeFormat, tz) +
          '–' +
          formatTime(event.end, config.timeFormat, tz),
  );
  const tooltip = $derived(
    timeLabel ? event.displayTitle + ' · ' + timeLabel : event.displayTitle,
  );

  // Click opens the event, mirroring EventPill's selection-aware behaviour: in
  // bulk-selection mode a tap toggles membership instead of opening the modal.
  function open(): void {
    if (selection.mode) {
      const wasSelected = selection.uids.has(event.uid);
      toggleSelected(event.uid);
      if (!wasSelected) focusEventByUid(event.uid);
      return;
    }
    ui.modalEvent = event;
  }

  function enterSelection(): void {
    selection.mode = true;
    addToSelection(event.uid);
  }

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
  class="wg-event"
  data-mode={mode}
  data-match={isMatch ? 'true' : null}
  data-past={isPast ? 'true' : null}
  data-style={styleAttr}
  data-cal-color={colorAttr}
  data-selected={selection.uids.has(event.uid) ? 'true' : null}
  aria-current={isCurrent ? 'true' : null}
  style={placement}
>
  <button
    type="button"
    onclick={open}
    onpointerdown={onPointerDown}
    onpointerup={cancelPress}
    onpointercancel={cancelPress}
    onpointermove={cancelPress}
    aria-label="Open event {event.displayTitle}"
    title={tooltip}
  >
    <span class="title">{event.displayTitle}</span>
    {#if mode === 'block' && timeLabel}
      <span class="time" data-mono>{timeLabel}</span>
    {/if}
  </button>
</article>

<style>
  .wg-event {
    position: absolute;
    box-sizing: border-box;
    border: var(--border-w) solid var(--ink);
    border-radius: var(--btn-radius);
    background: var(--paper-2);
    color: var(--ink);
    overflow: hidden;
    z-index: 1;
  }
  .wg-event:hover,
  .wg-event:focus-within {
    z-index: 3;
  }
  .wg-event[data-mode='block'] {
    /* Leave a hairline gap on the right so side-by-side sub-columns read as
       separate blocks rather than a solid band. */
    margin-right: 1px;
  }
  button {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 100%;
    height: 100%;
    padding: 1px 4px;
    background: transparent;
    color: inherit;
    border: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    overflow: hidden;
  }
  .wg-event[data-mode='bar'] button {
    flex-direction: row;
    align-items: center;
  }
  .title {
    font-size: var(--fs-11);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .time {
    font-size: var(--fs-10);
    line-height: 1.1;
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Filled tint per calendar colour. The class+attribute selector (0,2,1)
     outranks global.css's tag+attribute rules, so the fill wins while those
     still supply the border colour and the bold/inverted/etc. style treatments. */
  .wg-event[data-cal-color='peach'] { background: var(--cal-peach-bg); border-color: var(--cal-peach-border); }
  .wg-event[data-cal-color='amber'] { background: var(--cal-amber-bg); border-color: var(--cal-amber-border); }
  .wg-event[data-cal-color='mint'] { background: var(--cal-mint-bg); border-color: var(--cal-mint-border); }
  .wg-event[data-cal-color='teal'] { background: var(--cal-teal-bg); border-color: var(--cal-teal-border); }
  .wg-event[data-cal-color='sky'] { background: var(--cal-sky-bg); border-color: var(--cal-sky-border); }
  .wg-event[data-cal-color='lavender'] { background: var(--cal-lavender-bg); border-color: var(--cal-lavender-border); }

  /* Tentative/muted/struck styles dim like elsewhere; selected/current pick up
     the accent so bulk-selection and search read in the grid too. */
  .wg-event[data-style='dashed'] { border-style: dashed; }
  .wg-event[data-style='muted'] { opacity: 0.5; }
  .wg-event[data-style='striked'] .title { text-decoration: line-through; }
  .wg-event[data-past='true'] { opacity: var(--past-opacity); }
  .wg-event[data-selected='true'],
  .wg-event[aria-current='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  .wg-event[data-match='true'] {
    outline: var(--border-w) solid var(--accent);
  }
</style>
