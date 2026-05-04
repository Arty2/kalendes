<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { config, ui, focus } from '../lib/state.svelte';
  import { dateToPx } from '../lib/layout';
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

  function rename(e: Event): void {
    const target = config.feeds.find((f) => f.id === feed.id);
    if (target) target.name = (e.currentTarget as HTMLInputElement).value;
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
    focus.rowIndex = rowIndex;
    focus.eventIndex = nextIdx;
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
  const debugFlag =
    typeof localStorage !== 'undefined' && localStorage.getItem('calendari.debug') === '1';
</script>

<header
  class="row-header"
  data-collapsed={feed.collapsed ? 'true' : null}
  data-kind={feed.kind}
>
  <div class="lead">
    <span class="collapse-toggle" data-collapsed={feed.collapsed ? 'true' : null}>
      <IconButton icon="chevron-down" label={expandLabel} variant="ghost" onclick={toggle} size={18} />
    </span>
    {#if errorMessage}
      <button
        type="button"
        class="warning-btn"
        aria-label="Failed to load {feed.name}"
        title={errorMessage}
        onclick={showError}
      >
        <Icon name="warning" size={16} />
      </button>
    {/if}
    {#if isHolidayFeed && !errorMessage}
      <span class="holiday-mark" aria-hidden="true" title="Public holiday calendar">
        <Icon name="calendar" size={14} />
      </span>
    {/if}
    <input
      type="text"
      class="name"
      value={feed.name}
      onchange={rename}
      aria-label="Calendar name"
      spellcheck="false"
    />
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
  .row-header[data-kind='holidays'] .name {
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
    padding: 0 8px;
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
  .name {
    flex: 1 1 auto;
    min-width: 0;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    padding: 4px 6px;
    font-size: 13px;
    font-weight: 600;
    height: 28px;
    text-overflow: ellipsis;
  }
  .name:focus {
    outline: none;
    border-color: var(--ink);
  }
  .name:hover {
    border-color: var(--ink);
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
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--accent);
    background: var(--paper);
    color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }
  .spacer {
    flex: 1;
  }
</style>
