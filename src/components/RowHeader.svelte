<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { config, ui, focus, events } from '../lib/state.svelte';
  import { dateToPx } from '../lib/layout';
  import { formatUtcOffset } from '../lib/format';
  import type { CalendarFeed, DisplayEvent } from '../lib/types';

  type Props = {
    feed: CalendarFeed;
    visibleEvents: DisplayEvent[];
    rangeStart: Date;
    pxPerDay: number;
    scrollEl: HTMLElement | undefined;
    rowIndex: number;
  };
  const { feed, visibleEvents, rangeStart, pxPerDay, scrollEl, rowIndex }: Props = $props();

  function toggle(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const target = config.feeds.find((f) => f.id === feed.id);
    if (target) target.collapsed = !target.collapsed;
  }

  function openInSettings(): void {
    ui.settingsScrollToFeedId = feed.id;
    ui.settingsAutoEditFeedId = feed.id;
    ui.settingsOpen = true;
  }

  let titleEl: HTMLButtonElement | undefined = $state();

  function scrollRowIntoView(): void {
    if (!scrollEl || !titleEl) return;
    const headerEl = titleEl.closest<HTMLElement>('.row-header');
    if (!headerEl) return;
    const top = headerEl.offsetTop - 80;
    scrollEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function jumpRelative(direction: -1 | 1): void {
    if (visibleEvents.length === 0) return;
    const sorted = [...visibleEvents].sort((a, b) => a.start.getTime() - b.start.getTime());
    const center = scrollEl
      ? scrollEl.scrollLeft + scrollEl.clientWidth / 2
      : 0;
    let nextIdx = -1;
    if (direction === 1) {
      for (let i = 0; i < sorted.length; i++) {
        const px = dateToPx(sorted[i]!.start, rangeStart, pxPerDay);
        if (px > center) { nextIdx = i; break; }
      }
      if (nextIdx === -1) nextIdx = sorted.length - 1;
    } else {
      for (let i = sorted.length - 1; i >= 0; i--) {
        const px = dateToPx(sorted[i]!.start, rangeStart, pxPerDay);
        if (px < center) { nextIdx = i; break; }
      }
      if (nextIdx === -1) nextIdx = 0;
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

  const expandLabel = $derived(feed.collapsed ? 'Expand row' : 'Collapse row');
  const isHolidayFeed = $derived(feed.kind === 'holidays');
  const errorMessage = $derived(ui.feedErrors[feed.id] ?? null);
  const feedTz = $derived(events.tzByFeed[feed.id] ?? null);
  const rawTzLabel = $derived(feedTz ? formatUtcOffset(feedTz) : '');
  const tzLabel = $derived(rawTzLabel || '');
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
  data-feed-id={feed.id}
>
  <div class="lead">
    <span class="collapse-toggle" data-collapsed={feed.collapsed ? 'true' : null}>
      <IconButton icon="chevron-down" label={expandLabel} variant="ghost" onclick={toggle} size={18} />
    </span>
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
    {#if isHolidayFeed && !errorMessage}
      <span class="holiday-mark" aria-hidden="true" title="Holidays Calendar">
        <Icon name="calendar-strike" size={14} />
      </span>
    {/if}
    <button
      bind:this={titleEl}
      type="button"
      class="name-btn"
      onclick={scrollRowIntoView}
      ondblclick={openInSettings}
      aria-label="Scroll to {feed.name} (double-click to edit)"
      title="Click to scroll · double-click to edit"
    >
      <span class="name-text">{feed.name}</span>
      {#if tzLabel}
        <span class="tz-label" data-mono>({tzLabel})</span>
      {/if}
    </button>
    {#if debugFlag}
      <span class="badge" data-mono data-debug>{visibleEvents.length}</span>
    {/if}
  </div>
  <span class="spacer"></span>
  <div class="actions">
    <IconButton
      icon="chevron-left"
      label="Previous event"
      variant="ghost"
      size={18}
      onclick={() => jumpRelative(-1)}
    />
    <IconButton
      icon="chevron-right"
      label="Next event"
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
    border-bottom: none;
  }
  .row-header[data-kind='holidays'] .name-text {
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
  .collapse-toggle {
    display: inline-flex;
    transition: transform 120ms ease;
  }
  .collapse-toggle[data-collapsed='true'] {
    transform: rotate(-90deg);
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
    padding: 4px 6px;
    height: 28px;
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
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tz-label {
    font-size: 11px;
    color: var(--ink-muted);
    flex-shrink: 0;
    white-space: nowrap;
  }
  .badge {
    font-size: 11px;
    color: var(--ink-muted);
    background: var(--paper-2);
    padding: 2px 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .holiday-mark {
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
