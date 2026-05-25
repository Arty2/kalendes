<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { config, ui, focus, effectiveFeedTz, zoom } from '../lib/state.svelte';
  import { today } from '../lib/today.svelte';
  import { dateToPx } from '../lib/layout';
  import { clock } from '../lib/clock.svelte';
  import { formatTime, formatTzDiff, isDaylight, tzOffsetMinutesVsDisplay } from '../lib/format';
  import { longPress, createLongPress } from '../lib/haptics';
  import type { CalendarFeed, DisplayEvent, Timezone } from '../lib/types';

  type Props = {
    feed: CalendarFeed;
    visibleEvents: DisplayEvent[];
    rangeStart: Date;
    pxPerDay: number;
    scrollEl: HTMLElement | undefined;
    rowIndex: number;
  };
  const { feed, visibleEvents, rangeStart, pxPerDay, scrollEl, rowIndex }: Props = $props();

  const nameLongPress = createLongPress(500);

  function toggleCollapsed(): void {
    if (nameLongPress.didFire()) return;
    const target = config.feeds.find((f) => f.id === feed.id);
    if (target) target.collapsed = !target.collapsed;
  }

  function openInSettings(): void {
    ui.settingsScrollToFeedId = feed.id;
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
    if (visibleEvents.length === 0) return;
    const sorted = [...visibleEvents].sort((a, b) => a.start.getTime() - b.start.getTime());
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
    if (visibleEvents.length === 0) return;
    const sorted = [...visibleEvents].sort((a, b) => a.start.getTime() - b.start.getTime());
    const nextIdx = direction === 1 ? sorted.length - 1 : 0;
    focusAndScrollTo(sorted, nextIdx);
  }

  const NAV_LONGPRESS_MS = 500;
  const NAV_FLASH_MS = 400;
  let navFlash: 'prev' | 'next' | null = $state(null);
  let navPressTimer: ReturnType<typeof setTimeout> | null = null;
  let navLongFired = false;

  function startNavPress(direction: -1 | 1): void {
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

  const categoryIconName = $derived.by<string | null>(() => {
    switch (feed.category) {
      case 'holidays': return 'category-holiday';
      case 'observances': return 'category-observances';
      case 'guests': return 'category-guests';
      case 'announcements': return 'category-announcements';
      default: return null;
    }
  });
  const categoryLabel = $derived.by<string>(() => {
    switch (feed.category) {
      case 'holidays': return 'Holidays';
      case 'observances': return 'Observances';
      case 'guests': return 'Guests';
      case 'announcements': return 'Announcements';
      default: return '';
    }
  });
  const travelIconName = $derived.by<string | null>(() => {
    switch (feed.travel) {
      case 'international': return 'category-airplane';
      case 'local': return 'category-bus';
      default: return null;
    }
  });
  const travelLabel = $derived.by<string>(() => {
    switch (feed.travel) {
      case 'international': return 'Travel (International)';
      case 'local': return 'Travel (Local)';
      default: return '';
    }
  });
  const isScratchpad = $derived(feed.source.kind === 'scratchpad');
  const prevIcon = $derived(navFlash === 'prev' ? 'skip-to-start' : 'chevron-left');
  const nextIcon = $derived(navFlash === 'next' ? 'skip-to-end' : 'chevron-right');
  const prevLabel = 'Previous event (long-press for earliest)';
  const nextLabel = 'Next event (long-press for latest)';
  const errorMessage = $derived(ui.feedErrors[feed.id] ?? null);
  const feedTz = $derived(effectiveFeedTz(feed.id));
  const tzLabel = $derived(
    feedTz ? formatTzDiff(feedTz, config.timezone, new Date(clock.now)) : '',
  );
  const feedClockTime = $derived(
    feedTz ? formatTime(new Date(clock.now), config.timeFormat, feedTz as Timezone) : '',
  );
  const morningH = $derived(config.morningLimit ? (parseInt(config.morningLimit.split(':')[0]!, 10) || 8) : 8);
  const eveningH = $derived(config.eveningLimit ? (parseInt(config.eveningLimit.split(':')[0]!, 10) || 20) : 20);
  const feedIsDay = $derived(feedTz ? isDaylight(feedTz as Timezone, new Date(clock.now), morningH, eveningH) : true);
  // x of the current-time marker as it passes through this row (content
  // coords), so the row clock can hug it: icon left of the line, time right.
  const markerLeft = $derived.by(() => {
    const nowDate = zoom.value === 'month' ? new Date(clock.now) : today.value;
    const base = dateToPx(nowDate, rangeStart, pxPerDay);
    if (!feedTz) return base;
    const mins = tzOffsetMinutesVsDisplay(feedTz, config.timezone, new Date(clock.now));
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
      <span class="category-mark" aria-hidden="true" title={categoryLabel}>
        <Icon name={categoryIconName} size={14} />
      </span>
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
    top: 80px;
    display: flex;
    align-items: center;
    padding: 1px 0;
    height: 30px;
    background: var(--paper);
    border-bottom: 1px solid var(--ink);
    z-index: 4;
    width: max-content;
    min-width: 100%;
    box-sizing: border-box;
  }
  .row-header[data-collapsed='true'] {
    border-bottom: 1px dashed var(--ink);
  }
  .row-header[data-category='holidays'] .name-text,
  .row-header[data-category='observances'] .name-text,
  .row-header[data-category='announcements'] .name-text {
    color: var(--ink-muted);
  }
  .lead {
    position: sticky;
    left: 0;
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0 8px;
    background: var(--paper);
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
    background: var(--paper);
    z-index: 1;
    flex-shrink: 0;
  }
  .nav-wrap {
    display: inline-flex;
  }
  .actions :global(.icon-button) {
    width: 26px;
    height: 26px;
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
    height: 28px;
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
    font-size: 13px;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  }
  .tz-time {
    position: absolute;
    top: 0;
    height: 100%;
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: 11px;
    color: var(--ink-muted);
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
  }
  .tz-offset {
    color: var(--ink-muted);
  }
  .badge {
    font-size: 11px;
    color: var(--ink-muted);
    background: var(--paper-2);
    padding: 2px 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .category-mark {
    display: inline-flex;
    align-items: center;
    color: var(--ink-muted);
    flex-shrink: 0;
  }
  .warning-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3em;
    height: 24px;
    min-width: 24px;
    padding: 0 4px;
    border: 1px solid var(--accent);
    background: var(--paper);
    color: var(--accent);
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
  .scratch-add:hover {
    color: var(--ink);
  }
  .spacer {
    flex: 1;
  }
</style>
