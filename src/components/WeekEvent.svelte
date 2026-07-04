<script lang="ts">
  import {
    ui,
    config,
    selection,
    toggleSelected,
    addToSelection,
    focusEventByUid,
    isKiosk,
    pushLog,
    openHoverPreview,
    closeHoverPreviewSoon,
    cancelHoverPreview,
  } from '../lib/state.svelte';
  import { formatTime, formatRange } from '../lib/format';
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
    // True when an overnight event was clipped to midnight and carries into the
    // next day — shows a continuation caret at the block's bottom edge.
    continuesEnd?: boolean;
    // Keyboard focus (arrow-key navigation) — draws a focus ring.
    isFocused?: boolean;
    // True when the block is tall enough to fit more than one line of title, so
    // the title wraps instead of overflowing on a single line.
    wrapTitle?: boolean;
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
    continuesEnd = false,
    isFocused = false,
    wrapTitle = false,
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
  // Blocks are title-only — the grid position already reads the time; the
  // exact range lives in the tooltip, hover card, and modal.
  const tooltip = $derived(
    timeLabel ? event.displayTitle + ' · ' + timeLabel : event.displayTitle,
  );

  // Double-click copies the event's details to the clipboard, mirroring
  // EventPill.copyContent so the gesture reads the same across views.
  const dateLabel = $derived(
    formatRange(event.start, event.end, config.dateFormat, config.locale),
  );
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

  // Click opens the event, mirroring EventPill's selection-aware behaviour: in
  // bulk-selection mode a tap toggles membership instead of opening the modal.
  function open(): void {
    cancelHoverPreview();
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

  // Mouse-only hover preview (touch keeps tap/long-press).
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
  class="wg-event"
  data-mode={mode}
  data-match={isMatch ? 'true' : null}
  data-past={isPast ? 'true' : null}
  data-style={styleAttr}
  data-cal-color={colorAttr}
  data-selected={selection.uids.has(event.uid) ? 'true' : null}
  data-focused={isFocused ? 'true' : null}
  data-wrap={wrapTitle ? 'true' : null}
  aria-current={isCurrent ? 'true' : null}
  style={placement}
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
    title={tooltip}
  >
    <span class="title"
      >{event.displayTitle}{#if (event.dupCount ?? 1) > 1}<span class="dup" data-mono
        >&nbsp;×{event.dupCount}</span
      >{/if}</span
    >
  </button>
  {#if continuesEnd}
    <span class="continues" aria-hidden="true">▾</span>
  {/if}
</article>

<style>
  .wg-event {
    position: absolute;
    box-sizing: border-box;
    border: var(--border-w) solid var(--ink);
    border-radius: var(--btn-radius);
    background: var(--paper-2);
    color: var(--ink);
    /* Titles overflow (with a paper halo) like the other zooms' pills — both
       timed blocks and all-day bars. */
    overflow: visible;
    z-index: 1;
  }
  .wg-event:hover,
  .wg-event:focus-within {
    z-index: 3;
  }
  /* The hairline right gap comes from WeekGrid's placement (width: calc(% - 1px));
     margin-right has no effect on an absolutely-positioned box with left+width. */
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
    overflow: visible;
  }
  .wg-event[data-mode='bar'] button {
    flex-direction: row;
    align-items: center;
  }
  button:focus-visible {
    outline: calc(var(--border-w) * 2) solid var(--accent);
    outline-offset: 1px;
  }
  .title {
    font-size: var(--fs-11);
    line-height: 1.2;
    white-space: nowrap;
    /* Overflow visibly with a paper text-stroke halo so the title stays legible
       over neighbouring columns (matches EventPill's h3). */
    overflow: visible;
    paint-order: stroke fill;
    -webkit-text-stroke: var(--stroke-w) var(--paper);
    text-shadow: 0 0 1px var(--paper);
  }
  /* Tall enough block: wrap the title across the available height instead of
     overflowing on one line. Clip to the block so it never spills past its box. */
  .wg-event[data-wrap='true'] {
    overflow: hidden;
  }
  .wg-event[data-wrap='true'] .title {
    white-space: normal;
    overflow: hidden;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .dup {
    color: var(--ink-muted);
  }
  /* Caret at the bottom edge: this overnight event carries into the next day. */
  .continues {
    position: absolute;
    bottom: -1px;
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--fs-10);
    line-height: 1;
    color: var(--ink-muted);
    pointer-events: none;
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

  /* Solid blocks match the other zooms' pills: the global rules supply the
     fill (ink, or the calendar tint), these swap the text halo to match —
     ink on the plain solid, the tint itself (--solid-halo, set by the global
     per-color rules) on a colored calendar's fill. */
  .wg-event[data-style='inverted'] .title {
    -webkit-text-stroke-color: var(--ink);
    text-shadow: 0 0 1px var(--ink);
  }
  .wg-event[data-style='inverted'][data-cal-color] .title {
    -webkit-text-stroke-color: var(--solid-halo);
    text-shadow: 0 0 1px var(--solid-halo);
  }

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
  /* Keyboard-focused event: render as the solid (inverted) style rather than an
     outline ring (mirrors EventPill's focus). Placed after the cal-color rules
     so the fill wins on equal specificity. */
  .wg-event[data-focused='true'] {
    background: var(--ink);
    color: var(--paper);
    /* !important to beat the global cal-color border rule (also !important). */
    border-color: var(--ink) !important;
    z-index: 3;
  }
  .wg-event[data-focused='true'] .title {
    font-weight: 700;
    -webkit-text-stroke-color: var(--ink);
    text-shadow: 0 0 1px var(--ink);
  }
  /* The solid fill is the focus affordance, so drop the browser default ring. */
  .wg-event[data-focused='true'] button:focus-visible {
    outline: none;
  }
</style>
