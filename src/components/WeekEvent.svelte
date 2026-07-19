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
  import { travelIcon } from '../lib/icons';
  import { formatTime, formatRange } from '../lib/format';
  import { matchingRulesFor } from '../lib/rules';
  import { createLongPress } from '../lib/haptics';
  import type { CalendarColor, DisplayEvent, StyleVariant, Travel } from '../lib/types';

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
    // Feed-level travel tag; the event's own tag overrides it (like EventPill).
    feedTravel?: Travel;
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
    showLocation = false,
    feedTravel,
    placement,
  }: Props = $props();

  // Mirror EventPill: a matching rule's color/style overrides the calendar's.
  const colorAttr = $derived(event.ruleColor ?? feedColor ?? null);
  const styleAttr = $derived.by<StyleVariant | null>(() => {
    if (event.styleVariant !== 'none') return event.styleVariant;
    if (feedStyle) return feedStyle;
    return null;
  });
  // Mirror EventPill: mark pills a find-replace rule (filter) matched.
  const hasFilter = $derived(matchingRulesFor(event, config.rules).length > 0);

  // Location line under the title, when the block has room for it (WeekGrid
  // gates showLocation on block height). Travel charm mirrors EventPill's.
  const showLoc = $derived(showLocation && !!event.displayLocation);
  const travelIconName = $derived(travelIcon(event.travel ?? feedTravel));

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

  const press = createLongPress();
  function onPointerDown(): void {
    // Long-press to enter selection mode — on touch and mouse alike.
    if (isKiosk()) return;
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
  data-filter={hasFilter ? 'true' : null}
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
