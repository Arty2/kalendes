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
  import Icon from './Icon.svelte';
  import { categoryIcon } from '../lib/icons';
  import { formatTime, formatRange } from '../lib/format';
  import { createLongPress } from '../lib/haptics';
  import {
    createPointerDrag,
    blockTouchScroll,
    type DragPart,
    type DragSource,
  } from '../lib/event-drag-gesture';
  import type { CalendarColor, DisplayEvent, FeedCategory, StyleVariant } from '../lib/types';

  type Props = {
    event: DisplayEvent;
    // Primary zone the grid is laid out in — the time label reads in
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
    // True when the block is tall enough to fit a location line under the title.
    showLocation?: boolean;
    // Feed-level event type; the event's own type overrides it (like EventPill).
    // Used only to surface the plane/bus charm for travel-typed events.
    feedCategory?: FeedCategory;
    // All-day bars only: clip the title to the bar when the next day in the
    // same lane is occupied, so it can't spill over the adjacent bar. When the
    // neighbouring space is free the title overflows like the other zooms.
    clip?: boolean;
    // Absolute placement (top/height/left/width) computed by WeekGrid.
    placement: string;
    // Local-lane events only (WeekGrid decides): drag to reschedule.
    dragSource?: DragSource | null;
    // Resize handles: a timed block's bottom edge, an all-day bar's two ends.
    resizable?: boolean;
    // This block is the one being dragged — it dims while the ghost moves.
    isDragging?: boolean;
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
    showLocation = false,
    feedCategory,
    clip = false,
    placement,
    dragSource = null,
    resizable = false,
    isDragging = false,
  }: Props = $props();

  // Mirror EventPill: a matching rule's color/style overrides the calendar's.
  const colorAttr = $derived(event.ruleColor ?? feedColor ?? null);
  const styleAttr = $derived.by<StyleVariant | null>(() => {
    if (event.styleVariant !== 'none') return event.styleVariant;
    if (feedStyle) return feedStyle;
    return null;
  });
  // Mirror EventPill: mark pills a find-replace rule (filter) matched. Read the
  // matchedFilter flag decorate() precomputed rather than re-scanning the rules.
  const hasFilter = $derived(event.matchedFilter === true);

  // Location line under the title, when the block has room for it (WeekGrid
  // gates showLocation on block height). Travel charm mirrors EventPill's.
  const showLoc = $derived(showLocation && !!event.displayLocation);
  const effectiveCategory = $derived(event.category ?? feedCategory);
  const isTravel = $derived(
    effectiveCategory === 'travel-local' || effectiveCategory === 'travel-international',
  );
  const travelIconName = $derived(isTravel ? categoryIcon(effectiveCategory) : null);

  const timeLabel = $derived(
    event.allDay
      ? null
      : formatTime(event.start, config.timeFormat, tz) +
          '–' +
          formatTime(event.end, config.timeFormat, tz),
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
    // The click trailing a drag isn't a tap.
    if (drag.consumeClick()) {
      press.didFire();
      return;
    }
    // Swallow the click synthesized right after a long-press (mouse and touch).
    if (press.didFire()) return;
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
    // Long-press won — drop the hover preview so it doesn't linger on desktop.
    cancelHoverPreview();
    selection.mode = true;
    addToSelection(event.uid);
  }

  // A draggable block's hold only arms it (see event-drag-gesture): the finger
  // may still drag, and selecting now would open the tray and reflow the view
  // under it. The selection lands on release instead, if no drag happened.
  let armed = $state(false);
  function onHold(): void {
    if (!dragSource) {
      enterSelection();
      return;
    }
    cancelHoverPreview();
    armed = true;
    drag.arm();
  }

  const press = createLongPress();
  const drag = createPointerDrag(() => dragSource, {
    onBegin: () => {
      press.cancel();
      cancelHoverPreview();
      armed = false;
    },
  });
  let articleEl: HTMLElement | undefined = $state();
  $effect(() => {
    if (articleEl) return blockTouchScroll(articleEl, drag);
  });

  function onPointerDown(e: PointerEvent): void {
    // Long-press to enter selection mode — on touch and mouse alike.
    if (isKiosk()) return;
    armed = false;
    press.start(onHold);
    drag.down(e, 'body');
  }
  function onEdgeDown(e: PointerEvent, part: DragPart): void {
    if (isKiosk()) return;
    drag.down(e, part);
  }
  // Moves / releases bubble up to the article from the button or an edge.
  function onPointerMove(e: PointerEvent): void {
    if (!dragSource) {
      press.cancel();
      return;
    }
    const r = drag.move(e);
    if (r === 'dragging' || r === 'dropped') press.cancel();
  }
  function onPointerUp(e: PointerEvent): void {
    const dropped = drag.up(e);
    press.cancel();
    if (armed && !dropped) enterSelection();
    armed = false;
  }
  function onPointerCancel(): void {
    drag.cancel();
    press.cancel();
    armed = false;
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
  data-filter={hasFilter ? 'true' : null}
  data-selected={selection.uids.has(event.uid) ? 'true' : null}
  data-focused={isFocused ? 'true' : null}
  data-wrap={wrapTitle ? 'true' : null}
  data-clip={clip ? 'true' : null}
  data-draggable={dragSource ? 'true' : null}
  data-dragging={isDragging ? 'true' : null}
  data-armed={armed ? 'true' : null}
  aria-current={isCurrent ? 'true' : null}
  style={placement}
  bind:this={articleEl}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
>
  <button
    type="button"
    onclick={open}
    ondblclick={copyContent}
    onpointerdown={onPointerDown}
    onpointerenter={onPointerEnter}
    onpointerleave={onPointerLeave}
    aria-label="Open event {event.displayTitle}"
  >
    <span class="title"
      >{event.displayTitle}{#if (event.spanDays ?? 1) > 1}<span class="dup" data-mono
        >&nbsp;×{event.spanDays}</span
      >{:else if (event.dupCount ?? 1) > 1}<span class="dup" data-mono
        >&nbsp;×{event.dupCount}</span
      >{/if}</span
    >
    {#if showLoc}
      <span class="meta-location">
        {#if travelIconName}<Icon name={travelIconName} size={10} />{/if}{event.displayLocation}
      </span>
    {/if}
  </button>
  {#if continuesEnd}
    <span class="continues" aria-hidden="true">▾</span>
  {/if}
  {#if resizable && dragSource}
    {#if mode === 'bar'}
      <span class="drag-edge" data-edge="start" aria-hidden="true" onpointerdown={(e) => onEdgeDown(e, 'start')}></span>
    {/if}
    <span class="drag-edge" data-edge="end" aria-hidden="true" onpointerdown={(e) => onEdgeDown(e, 'end')}></span>
  {/if}
</article>

<style>
  .wg-event {
    position: absolute;
    box-sizing: border-box;
    border: var(--border-w) solid var(--ink-color);
    border-radius: var(--pill-radius);
    /* Shared translucent fill (page colour, or the calendar tint via
       --pill-fill overrides in global.css) — same as the other zooms' pills. */
    background: var(--pill-fill);
    color: var(--ink-color);
    /* Titles overflow (with a paper halo) like the other zooms' pills — both
       timed blocks and all-day bars. */
    overflow: visible;
    z-index: 1;
  }
  .wg-event:hover,
  .wg-event:focus-within {
    z-index: 3;
  }
  /* The original stays put, faded, while its ghost (WeekGrid) tracks the drag. */
  .wg-event[data-dragging='true'] {
    opacity: 0.35;
  }
  /* Held and ready to drag (see onHold): an accent outline until it moves or lifts. */
  .wg-event[data-armed='true'] {
    outline: calc(var(--border-w) * 2) solid var(--accent-color);
    outline-offset: 1px;
  }
  /* Resize handles: a strip along a timed block's bottom edge, or over an
     all-day bar's two ends. */
  .drag-edge {
    position: absolute;
    touch-action: none;
    z-index: 1;
  }
  .wg-event[data-mode='block'] .drag-edge {
    left: 0;
    right: 0;
    bottom: -2px;
    height: 6px;
    cursor: ns-resize;
  }
  .wg-event[data-mode='bar'] .drag-edge {
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  .wg-event[data-mode='bar'] .drag-edge[data-edge='start'] {
    left: -2px;
  }
  .wg-event[data-mode='bar'] .drag-edge[data-edge='end'] {
    right: -2px;
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
  /* Keep an all-day bar's label pinned to the visible left edge as the bar
     scrolls under the frozen hour gutter — the same sticky treatment as
     EventPill's .pill-content in the horizontal zooms. The offset clears the
     gutter (--wg-gutter-w, set by WeekGrid) plus the button's 4px padding, and
     sticky's parent-bounds clamp keeps the label inside the bar. */
  .wg-event[data-mode='bar'] .title {
    position: sticky;
    left: calc(var(--wg-gutter-w, 0px) + 4px);
    max-width: 100%;
  }
  /* When the next day in this lane holds another bar (data-clip), clip the
     label to this bar's own width instead of letting it spill over the
     neighbour to the right — the full title stays reachable via the hover
     tooltip / event modal. Bars with free space to their right keep the
     overflow-with-halo treatment like the other zooms' pills. */
  .wg-event[data-mode='bar'][data-clip='true'] .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Event blocks colour themselves from container state (selected/current/focused), so opt out
     of the global chrome button hover/focus text tint and keep the accent focus outline. */
  button:hover,
  button:focus-visible {
    color: inherit;
  }
  button:focus-visible {
    outline: calc(var(--border-w) * 2) solid var(--accent-color);
    outline-offset: 1px;
  }
  .title {
    font-size: var(--fs-13);
    line-height: 1.2;
    white-space: nowrap;
    /* Overflow visibly with a paper text-stroke halo so the title stays legible
       over neighbouring columns (matches EventPill's h3). */
    overflow: visible;
    paint-order: stroke fill;
    /* Page-colour halo like EventPill's title; solid pills override to their bg
       colour below, so a bg-matched halo stays a solid-only treatment. */
    -webkit-text-stroke: var(--stroke-w) var(--paper-color);
    text-shadow: 0 0 1px var(--paper-color);
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
  /* Location line under the title (only rendered when the block is tall enough
     — showLocation). Clipped + faded to the block so it never smears. */
  .meta-location {
    font-size: var(--fs-10);
    line-height: 1.2;
    color: var(--ink-muted);
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 8px), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 8px), transparent);
  }
  .meta-location :global(.icon) {
    margin-right: 3px;
    vertical-align: -2px;
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

  /* Calendar colours need no rules here: global.css supplies the border
     (!important) and overrides --pill-fill to the tint, which the background
     and title halo above read. */

  /* Solid blocks match the other zooms' pills: the global rules supply the
     fill (ink, or the calendar tint), these swap the text halo to match —
     ink on the plain solid, the tint itself (--solid-halo, set by the global
     per-color rules) on a colored calendar's fill. */
  .wg-event[data-style='inverted'] .title {
    -webkit-text-stroke-color: var(--ink-color);
    text-shadow: 0 0 1px var(--ink-color);
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
    border-color: var(--accent-color);
    color: var(--accent-color);
  }
  .wg-event[data-match='true'] {
    outline: var(--border-w) solid var(--accent-color);
  }
  /* Keyboard-focused event: render as the solid (inverted) style rather than an
     outline ring (mirrors EventPill's focus). Placed after the cal-color rules
     so the fill wins on equal specificity. */
  .wg-event[data-focused='true'] {
    background: var(--ink-color);
    color: var(--paper-color);
    /* !important to beat the global cal-color border rule (also !important). */
    border-color: var(--ink-color) !important;
    z-index: 3;
  }
  .wg-event[data-focused='true'] .title {
    font-weight: 700;
    -webkit-text-stroke-color: var(--ink-color);
    text-shadow: 0 0 1px var(--ink-color);
  }
  /* The solid fill is the focus affordance, so drop the browser default ring. */
  .wg-event[data-focused='true'] button:focus-visible {
    outline: none;
  }
</style>
