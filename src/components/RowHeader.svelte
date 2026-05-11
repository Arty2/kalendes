<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { config, ui, focus, events, effectiveFeedTz } from '../lib/state.svelte';
  import { dateToPx } from '../lib/layout';
  import { clock } from '../lib/clock.svelte';
  import { formatTime, formatUtcOffset, isDaylight } from '../lib/format';
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

  function toggleCollapsed(): void {
    const target = config.feeds.find((f) => f.id === feed.id);
    if (target) target.collapsed = !target.collapsed;
  }

  function openInSettings(): void {
    ui.settingsScrollToFeedId = feed.id;
    ui.settingsAutoEditFeedId = feed.id;
    ui.settingsOpen = true;
  }

  function jumpRelative(direction: -1 | 1): void {
    if (visibleEvents.length === 0) return;
    const sorted = [...visibleEvents].sort((a, b) => a.start.getTime() - b.start.getTime());
    const focusedHere =
      focus.rowIndex === rowIndex && focus.eventIndex >= 0 && focus.eventIndex < sorted.length;
    let nextIdx: number;
    if (!focusedHere) {
      nextIdx = direction === 1 ? 0 : sorted.length - 1;
    } else {
      const cur = focus.eventIndex;
      if (direction === 1) {
        nextIdx = cur >= sorted.length - 1 ? 0 : cur + 1;
      } else {
        nextIdx = cur <= 0 ? sorted.length - 1 : cur - 1;
      }
    }
    const ev = sorted[nextIdx];
    if (!ev) return;
    if (rowIndex >= 0) {
      focus.rowIndex = rowIndex;
      focus.eventIndex = nextIdx;
    }
    if (scrollEl) {
      const px = dateToPx(ev.start, rangeStart, pxPerDay);
      scrollEl.scrollTo({ left: Math.max(0, px - scrollEl.clientWidth / 2), behavior: 'smooth' });
    }
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
  const sortedEvents = $derived(
    [...visibleEvents].sort((a, b) => a.start.getTime() - b.start.getTime()),
  );
  const focusedHere = $derived(
    focus.rowIndex === rowIndex && focus.eventIndex >= 0 && focus.eventIndex < sortedEvents.length,
  );
  const atFirstEvent = $derived(focusedHere && focus.eventIndex === 0);
  const atLastEvent = $derived(focusedHere && focus.eventIndex === sortedEvents.length - 1);
  const prevIcon = $derived(atFirstEvent ? 'skip-to-start' : 'chevron-left');
  const nextIcon = $derived(atLastEvent ? 'skip-to-end' : 'chevron-right');
  const prevLabel = $derived(atFirstEvent ? 'Wrap to last event' : 'Previous event');
  const nextLabel = $derived(atLastEvent ? 'Wrap to first event' : 'Next event');
  const errorMessage = $derived(ui.feedErrors[feed.id] ?? null);
  const feedTz = $derived(effectiveFeedTz(feed.id));
  const rawTzLabel = $derived(feedTz ? formatUtcOffset(feedTz) : '');
  const tzLabel = $derived(rawTzLabel || '');
  const feedClockTime = $derived(
    feedTz ? formatTime(new Date(clock.now), config.timeFormat, feedTz as Timezone) : '',
  );
  const feedIsDay = $derived(feedTz ? isDaylight(feedTz as Timezone, new Date(clock.now)) : true);
  const lastSuccess = $derived(events.lastSuccessAt[feed.id] ?? null);
  const isStale = $derived(!!errorMessage && (events.byFeed[feed.id]?.length ?? 0) > 0);
  const staleSinceLabel = $derived.by(() => {
    if (!isStale || !lastSuccess) return '';
    const d = new Date(lastSuccess);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
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
    {#if errorMessage}
      <button
        type="button"
        class="warning-btn"
        data-stale={isStale ? 'true' : null}
        aria-label="{isStale ? 'Stale data — last loaded ' + staleSinceLabel : 'Failed to load ' + feed.name}"
        title={isStale ? 'Stale since ' + staleSinceLabel + ' — ' + errorMessage : errorMessage}
        onclick={showError}
      >
        <Icon name="warning" size={16} />
        {#if isStale && staleSinceLabel}
          <span class="stale-text" data-mono>stale since {staleSinceLabel}</span>
        {/if}
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
      aria-label="Toggle {feed.name} (double-click to edit)"
      aria-expanded={!feed.collapsed}
      title="Tap to expand/collapse · double-tap to edit"
    >
      <span class="name-text">{feed.name}</span>
      {#if feedTz}
        <span class="tz-now" data-mono aria-hidden="true">
          <Icon name={feedIsDay ? 'sun' : 'moon'} size={11} />
          <span>{feedClockTime}</span>
          <span class="tz-offset">({tzLabel})</span>
        </span>
      {/if}
    </button>
    {#if debugFlag}
      <span class="badge" data-mono data-debug>{visibleEvents.length}</span>
    {/if}
  </div>
  <span class="spacer"></span>
  <div class="actions">
    <IconButton
      icon={prevIcon}
      label={prevLabel}
      variant="ghost"
      size={18}
      onclick={() => jumpRelative(-1)}
    />
    <IconButton
      icon={nextIcon}
      label={nextLabel}
      variant="ghost"
      size={18}
      onclick={() => jumpRelative(1)}
    />
  </div>
</header>

<style>
  .row-header {
    position: sticky;
    left: 0;
    top: 80px;
    display: flex;
    align-items: center;
    padding: 4px 0;
    height: 36px;
    background: var(--paper);
    border-bottom: 1px solid var(--ink);
    z-index: 4;
    width: max-content;
    min-width: 100%;
    box-sizing: border-box;
  }
  .row-header[data-collapsed='true'] {
    border-bottom: 1px dashed var(--ink-faint);
  }
  .row-header[data-category='holidays'] .name-text {
    color: var(--ink-muted);
  }
  .lead {
    position: sticky;
    left: 0;
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0 8px;
    background: var(--paper);
    z-index: 1;
    min-width: 0;
    max-width: calc(100vw - 110px);
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
  .name-btn {
    flex: 1 1 auto;
    min-width: 0;
    display: inline-flex;
    align-items: baseline;
    gap: 0.4em;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    padding: 6px 8px;
    height: 32px;
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }
  .name-btn:hover {
    border-color: var(--ink-faint);
  }
  .name-text {
    font-size: 13px;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tz-now {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: 11px;
    color: var(--ink-muted);
    flex-shrink: 0;
    white-space: nowrap;
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
  .warning-btn[data-stale='true'] {
    border-color: var(--ink-muted);
    color: var(--ink-muted);
    border-style: dashed;
  }
  .stale-text {
    font-size: 11px;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
</style>
