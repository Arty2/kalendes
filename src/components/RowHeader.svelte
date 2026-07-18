<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import LocalBadge from './LocalBadge.svelte';
  import { config, ui, focus, effectiveFeedTz, zoom, timelineEventsFor } from '../lib/state.svelte';
  import { today } from '../lib/today.svelte';
  import { dateToPx } from '../lib/layout';
  import { clock } from '../lib/clock.svelte';
  import { formatTime, formatTzDiff, isDaylight, tzOffsetMinutesVsDisplay, dayLimitMinutes } from '../lib/format';
  import { longPress, createLongPress } from '../lib/haptics';
  import { categoryIcon, travelIcon } from '../lib/icons';
  import type { CalendarFeed, DisplayEvent, Timezone } from '../lib/types';

  type Strip = { left: number; width: number };
  type Props = {
    feed: CalendarFeed;
    visibleEvents: DisplayEvent[];
    rangeStart: Date;
    pxPerDay: number;
    scrollEl: HTMLElement | undefined;
    rowIndex: number;
    // Weekend tint + day-blocking hatch strips (window-filtered, content px), so
    // the same pattern the row bodies show runs continuously through the header.
    weekendStrips: { left: number; width: number; past: boolean }[];
    thickStrips: Strip[];
    thinStrips: Strip[];
    // Month-separator x positions (window-filtered, content px), so the month
    // rules continue up through the header like the body's .month-line.
    monthLines: { px: number; past: boolean }[];
  };
  const {
    feed, visibleEvents, rangeStart, pxPerDay, scrollEl, rowIndex,
    weekendStrips, thickStrips, thinStrips, monthLines,
  }: Props = $props();

  // The events prev/next navigation steps through: the same merged, start-sorted
  // list the row's pills render, so focus.eventIndex lines up with the pills (a
  // consecutive-day run is one nav step). The header's count badge still counts
  // the raw visibleEvents so it reflects the true number of events.
  const navEvents = $derived(timelineEventsFor(feed.id));

  const nameLongPress = createLongPress(500);
  const charmLongPress = createLongPress(500);

  function toggleCollapsed(): void {
    if (nameLongPress.didFire()) return;
    const target = config.feeds.find((f) => f.id === feed.id);
    if (target) target.collapsed = !target.collapsed;
  }

  // Long-press the type charm to focus this row: collapse every other row and
  // expand this one.
  function collapseOthers(): void {
    for (const f of config.feeds) {
      f.collapsed = f.id !== feed.id;
    }
  }

  function openInSettings(): void {
    // Only auto-edit: startEdit() scrolls the feed card to the top of the list
    // (block:'start'), matching the menu edit. Setting settingsScrollToFeedId too
    // would add a competing block:'nearest' scroll that leaves it mid-list.
    ui.settingsAutoEditFeedId = feed.id;
    ui.settingsOpen = true;
  }

  function openAddEvent(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('cal:open-add-event'));
  }

  function focusAndScrollTo(sorted: DisplayEvent[], nextIdx: number): void {
    const ev = sorted[nextIdx];
    if (!ev) return;
    if (rowIndex >= 0) {
      focus.feedId = feed.id;
      focus.eventIndex = nextIdx;
    }
    if (scrollEl) {
      const px = dateToPx(ev.start, rangeStart, pxPerDay);
      scrollEl.scrollTo({ left: Math.max(0, px - scrollEl.clientWidth / 2), behavior: 'smooth' });
    }
  }

  function jumpRelative(direction: -1 | 1): void {
    if (navEvents.length === 0) return;
    const sorted = navEvents;
    const focusedHere =
      focus.feedId === feed.id && focus.eventIndex >= 0 && focus.eventIndex < sorted.length;
    let nextIdx: number;
    if (!focusedHere) {
      // First click on prev/next anchors at the boundary around today
      // — first future event (for next) or most recent past (for prev).
      const todayMs = today.value.getTime();
      if (direction === 1) {
        nextIdx = sorted.findIndex((e) => e.start.getTime() > todayMs);
        if (nextIdx === -1) nextIdx = sorted.length - 1;
      } else {
        nextIdx = -1;
        for (let i = sorted.length - 1; i >= 0; i--) {
          if (sorted[i]!.start.getTime() < todayMs) { nextIdx = i; break; }
        }
        if (nextIdx === -1) nextIdx = 0;
      }
    } else {
      const cur = focus.eventIndex;
      if (direction === 1) {
        nextIdx = cur >= sorted.length - 1 ? 0 : cur + 1;
      } else {
        nextIdx = cur <= 0 ? sorted.length - 1 : cur - 1;
      }
    }
    focusAndScrollTo(sorted, nextIdx);
  }

  function jumpToEnd(direction: -1 | 1): void {
    if (navEvents.length === 0) return;
    const nextIdx = direction === 1 ? navEvents.length - 1 : 0;
    focusAndScrollTo(navEvents, nextIdx);
  }

  const NAV_LONGPRESS_MS = 500;
  const NAV_FLASH_MS = 400;
  let navFlash: 'prev' | 'next' | null = $state(null);
  let navPressTimer: ReturnType<typeof setTimeout> | null = null;
  let navLongFired = false;

  function startNavPress(direction: -1 | 1): void {
    if (navCount <= 1) return;
    navLongFired = false;
    if (navPressTimer) clearTimeout(navPressTimer);
    navPressTimer = setTimeout(() => {
      navPressTimer = null;
      navLongFired = true;
      longPress();
      jumpToEnd(direction);
      navFlash = direction === 1 ? 'next' : 'prev';
      setTimeout(() => {
        if (navFlash === (direction === 1 ? 'next' : 'prev')) navFlash = null;
      }, NAV_FLASH_MS);
    }, NAV_LONGPRESS_MS);
  }

  function cancelNavPress(): void {
    if (navPressTimer) {
      clearTimeout(navPressTimer);
      navPressTimer = null;
    }
  }

  function handleNavClick(direction: -1 | 1): void {
    if (navCount <= 1) return;
    if (navLongFired) {
      navLongFired = false;
      return;
    }
    jumpRelative(direction);
  }

  function showError(): void {
    const message = ui.feedErrors[feed.id];
    if (message) ui.errorModal = { feedName: feed.name, message };
  }

  const categoryIconName = $derived(categoryIcon(feed.category));
  const categoryLabel = $derived.by<string>(() => {
    switch (feed.category) {
      case 'events': return 'Events';
      case 'holidays': return 'Holidays';
      case 'observances': return 'Observances';
      case 'guests': return 'Guests';
      case 'announcements': return 'Announcements';
      default: return '';
    }
  });
  const travelIconName = $derived(travelIcon(feed.travel));
  const travelLabel = $derived.by<string>(() => {
    switch (feed.travel) {
      case 'international': return 'Travel (International)';
      case 'local': return 'Travel (Local)';
      default: return '';
    }
  });
  const isScratchpad = $derived(feed.source.kind === 'scratchpad');
  // Nav direction hint: when the focused event is at a boundary, the next tap
  // wraps around the list. Signal the cycle with the skip icon pointing toward
  // where it lands — the same fast-forward / rewind glyphs as the jump-to-end
  // flash (prev wraps forward to the last event, next wraps back to the first).
  const navCount = $derived(navEvents.length);
  const focusedHere = $derived(
    focus.feedId === feed.id && focus.eventIndex >= 0 && focus.eventIndex < navCount,
  );
  const nextWraps = $derived(focusedHere && focus.eventIndex >= navCount - 1);
  const prevWraps = $derived(focusedHere && focus.eventIndex <= 0);
  const prevIcon = $derived(
    navFlash === 'prev' ? 'rewind' : prevWraps ? 'fast-forward' : 'chevron-left',
  );
  const nextIcon = $derived(
    navFlash === 'next' ? 'fast-forward' : nextWraps ? 'rewind' : 'chevron-right',
  );
  const prevLabel = 'Previous event (long-press for earliest)';
  const nextLabel = 'Next event (long-press for latest)';
  const errorMessage = $derived(ui.feedErrors[feed.id] ?? null);
  // Local lanes have no fetched/detected timezone, so fall back to the display
  // timezone — that still gives them the day/night icon and a row clock (the
  // offset label resolves to empty when it matches the display tz).
  const feedTz = $derived(effectiveFeedTz(feed.id) ?? (isScratchpad ? config.timezone : null));
  const tzLabel = $derived(
    feedTz ? formatTzDiff(feedTz, config.timezone, new Date(clock.now), config.dst) : '',
  );
  const feedClockTime = $derived(
    feedTz ? formatTime(new Date(clock.now), config.timeFormat, feedTz as Timezone) : '',
  );
  const morningMin = $derived(dayLimitMinutes(config.morningLimit, 8.5 * 60));
  const eveningMin = $derived(dayLimitMinutes(config.eveningLimit, 20.5 * 60));
  const feedIsDay = $derived(feedTz ? isDaylight(feedTz as Timezone, new Date(clock.now), morningMin, eveningMin) : true);
  // x of the current-time marker as it passes through this row (content
  // coords), so the row clock can hug it: icon left of the line, time right.
  const markerLeft = $derived.by(() => {
    const nowDate = zoom.value === 'month' ? new Date(clock.now) : today.value;
    const base = dateToPx(nowDate, rangeStart, pxPerDay);
    if (!feedTz) return base;
    const mins = tzOffsetMinutesVsDisplay(feedTz, config.timezone, new Date(clock.now), config.dst);
    return base + (mins / 1440) * pxPerDay;
  });
  const debugFlag =
    typeof localStorage !== 'undefined' && localStorage.getItem('calendari.debug') === '1';
</script>

<header
  class="row-header"
  data-collapsed={feed.collapsed ? 'true' : null}
  data-kind={feed.kind}
  data-category={feed.category}
  data-feed-id={feed.id}
>
  <!-- Weekend tint + blocking hatch + month rules behind the title, aligned with
       the row bodies (background-attachment:fixed keeps the 45° stripes
       continuous). The title reads over them via its paper stroke. -->
  {#each weekendStrips as w (w.left)}
    <i class="hdr-weekend" data-past={w.past ? 'true' : null} style="left: {w.left}px; width: {w.width}px" aria-hidden="true"></i>
  {/each}
  {#each thickStrips as o (o.left)}
    <i class="hdr-hatch hdr-hatch-thick" style="left: {o.left}px; width: {o.width}px" aria-hidden="true"></i>
  {/each}
  {#each thinStrips as o (o.left)}
    <i class="hdr-hatch hdr-hatch-thin" style="left: {o.left}px; width: {o.width}px" aria-hidden="true"></i>
  {/each}
  {#each monthLines as m (m.px)}
    <i class="hdr-month-line" data-past={m.past ? 'true' : null} style="left: {m.px}px" aria-hidden="true"></i>
  {/each}
  <div class="lead">
    {#if isScratchpad}
      <button
        type="button"
        class="scratch-add"
        aria-label="Add event"
        title="Add event"
        onclick={openAddEvent}
      >
        <Icon name="plus" size={14} />
      </button>
    {/if}
    {#if errorMessage}
      <button
        type="button"
        class="warning-btn"
        aria-label={'Failed to load ' + feed.name}
        title="Show error"
        onclick={showError}
      >
        <Icon name="help" size={16} />
      </button>
    {/if}
    {#if travelIconName}
      <span class="category-mark" aria-hidden="true" title={travelLabel}>
        <Icon name={travelIconName} size={14} />
      </span>
    {/if}
    {#if categoryIconName}
      <button
        type="button"
        class="category-mark charm-btn"
        title="{categoryLabel} · long-press to focus this row"
        aria-label="{categoryLabel}: long-press to collapse the other rows"
        onpointerdown={() => charmLongPress.start(collapseOthers)}
        onpointerup={() => charmLongPress.cancel()}
        onpointercancel={() => charmLongPress.cancel()}
        onpointerleave={() => charmLongPress.cancel()}
      >
        <Icon name={categoryIconName} size={14} />
      </button>
    {/if}
    <button
      type="button"
      class="name-btn"
      onclick={toggleCollapsed}
      ondblclick={openInSettings}
      onpointerdown={() => nameLongPress.start(openInSettings)}
      onpointerup={() => nameLongPress.cancel()}
      onpointercancel={() => nameLongPress.cancel()}
      onpointerleave={() => nameLongPress.cancel()}
      aria-label="Toggle {feed.name} (double-click or long-press to edit)"
      aria-expanded={!feed.collapsed}
      title="Tap to expand/collapse · double-tap or long-press to edit"
    >
      <span class="name-text">{feed.name}</span>
      {#if isScratchpad}<LocalBadge size={12} />{/if}
    </button>
    {#if debugFlag}
      <span class="badge" data-mono data-debug>{visibleEvents.length}</span>
    {/if}
  </div>
  {#if feedTz}
    <span class="tz-icon" style="left: {markerLeft - 4}px" aria-hidden="true">
      <Icon name={feedIsDay ? 'sun' : 'moon'} size={11} />
    </span>
    <span class="tz-time" data-mono style="left: {markerLeft + 4}px" aria-hidden="true">
      <span>{feedClockTime}</span>
      {#if tzLabel}<span class="tz-offset">({tzLabel})</span>{/if}
    </span>
  {/if}
  <span class="spacer"></span>
  {#if !feed.collapsed}
    <div class="actions">
      <span
        class="nav-wrap"
        role="presentation"
        onpointerdown={() => startNavPress(-1)}
        onpointerup={cancelNavPress}
        onpointercancel={cancelNavPress}
        onpointerleave={cancelNavPress}
      >
        <IconButton
          icon={prevIcon}
          label={prevLabel}
          variant="ghost"
          size={16}
          disabled={navCount <= 1}
          onclick={() => handleNavClick(-1)}
        />
      </span>
      <span
        class="nav-wrap"
        role="presentation"
        onpointerdown={() => startNavPress(1)}
        onpointerup={cancelNavPress}
        onpointercancel={cancelNavPress}
        onpointerleave={cancelNavPress}
      >
        <IconButton
          icon={nextIcon}
          label={nextLabel}
          variant="ghost"
          size={16}
          disabled={navCount <= 1}
          onclick={() => handleNavClick(1)}
        />
      </span>
    </div>
  {/if}
</header>

<style>
  .row-header {
    position: sticky;
    left: 0;
    top: var(--time-header-h);
    display: flex;
    align-items: center;
    padding: 1px 0;
    height: var(--row-header-h);
    background: var(--paper-color);
    border-bottom: var(--border-w) solid var(--ink-faint);
    z-index: 4;
    width: max-content;
    min-width: 100%;
    box-sizing: border-box;
  }
  .row-header[data-collapsed='true'] {
    border-bottom: var(--border-w) dashed var(--ink-faint);
  }
  /* Weekend tint + blocking hatch behind the header content, mirroring the row
     bodies (Timeline's .weekend-col / .holiday-band and Row's strips). z0 keeps
     them under the sticky .lead / .actions (z1). background-attachment:fixed
     aligns the 45° stripes with the bodies so the pattern reads continuous. */
  .hdr-weekend,
  .hdr-hatch {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 0;
    pointer-events: none;
  }
  .hdr-weekend {
    background: color-mix(in srgb, var(--ink-color) 6%, transparent);
  }
  .hdr-weekend[data-past='true'] {
    background: color-mix(in srgb, var(--ink-color) 3%, transparent);
  }
  .hdr-hatch {
    background-attachment: fixed;
    opacity: 0.6;
  }
  .hdr-hatch-thick {
    background-image: repeating-linear-gradient(
      45deg, transparent 0, transparent 4px, var(--holiday-stripe) 4.5px, transparent 5px);
  }
  .hdr-hatch-thin {
    background-image: repeating-linear-gradient(
      45deg, transparent 0, transparent 9px, var(--holiday-stripe) 9.5px, transparent 10px);
  }
  /* Month-separator rule through the header, mirroring the body's .month-line so
     the vertical rule reads continuous down the whole timeline. z0 keeps it
     behind the title (which halos over it via its paper stroke). */
  .hdr-month-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: var(--border-w) solid var(--ink-color);
    pointer-events: none;
    z-index: 0;
  }
  .hdr-month-line[data-past='true'] {
    opacity: 0.4;
  }
  .lead {
    position: sticky;
    left: 0;
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0 8px;
    /* Transparent so the weekend tint / blocking hatch / month lines run
       continuously through the header; the title stays legible via its paper
       stroke (below), the same halo the event-pill titles use. */
    z-index: 1;
    min-width: 0;
    max-width: calc(100vw - 88px);
  }
  .actions {
    position: sticky;
    right: 0;
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0 var(--row-actions-right, 8px) 0 8px;
    background: var(--paper-color);
    z-index: 1;
    flex-shrink: 0;
  }
  .nav-wrap {
    display: inline-flex;
  }
  .actions :global(.icon-button) {
    width: var(--row-control-h);
    height: var(--row-control-h);
  }
  .name-btn {
    flex: 1 1 auto;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
    padding: 2px 8px;
    height: var(--row-control-h);
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }
  .name-btn:hover .name-text,
  .name-btn:focus-visible .name-text {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .name-btn:focus {
    outline: none;
  }
  .name-text {
    font-size: var(--fs-13);
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* Paper halo so the title reads over the weekend/hatch/month-line pattern
       now that the header patch is gone — same treatment as EventPill's h3. */
    paint-order: stroke fill;
    -webkit-text-stroke: var(--stroke-w) var(--paper-color);
    text-shadow: 0 0 1px var(--paper-color);
  }
  .tz-icon {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    color: var(--ink-muted);
    transform: translateX(-100%);
    pointer-events: none;
    z-index: 2;
    filter: var(--clock-halo);
    transition: none;
  }
  .tz-time {
    position: absolute;
    top: 0;
    height: 100%;
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: var(--fs-11);
    color: var(--ink-muted);
    filter: var(--clock-halo);
    transition: none;
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
  }
  .tz-offset {
    color: var(--ink-muted);
  }
  .badge {
    font-size: var(--fs-11);
    color: var(--ink-muted);
    background: var(--paper-2);
    padding: 2px 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .category-mark {
    display: inline-flex;
    align-items: center;
    color: var(--ink-color);
    flex-shrink: 0;
  }
  .charm-btn {
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    touch-action: none;
  }
  .charm-btn:focus {
    outline: none;
  }
  .warning-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3em;
    height: var(--row-control-h);
    min-width: var(--row-control-h);
    padding: 0 4px;
    border: none;
    background: transparent;
    color: var(--accent-color);
    cursor: pointer;
    flex-shrink: 0;
  }
  .scratch-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  /* Hover/focus text tint comes from the global button rules (accent / --link-color). */
  .spacer {
    flex: 1;
  }
</style>
