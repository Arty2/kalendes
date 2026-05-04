<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { config, ui } from '../lib/state.svelte';
  import { dateToPx } from '../lib/layout';
  import type { CalendarFeed, DisplayEvent } from '../lib/types';

  type Props = {
    feed: CalendarFeed;
    visibleEvents: DisplayEvent[];
    rangeStart: Date;
    pxPerDay: number;
    scrollEl: HTMLElement | undefined;
  };
  const { feed, visibleEvents, rangeStart, pxPerDay, scrollEl }: Props = $props();

  function toggle(): void {
    const target = config.feeds.find((f) => f.id === feed.id);
    if (target) target.collapsed = !target.collapsed;
  }

  function rename(e: Event): void {
    const target = config.feeds.find((f) => f.id === feed.id);
    if (target) target.name = (e.currentTarget as HTMLInputElement).value;
  }

  function jumpRelative(direction: -1 | 1): void {
    if (!scrollEl) return;
    const center = scrollEl.scrollLeft + scrollEl.clientWidth / 2;
    const candidates = visibleEvents.map((ev) => dateToPx(ev.start, rangeStart, pxPerDay));
    let target: number | null = null;
    if (direction === 1) {
      for (const px of candidates) if (px > center && (target === null || px < target)) target = px;
    } else {
      for (const px of candidates) if (px < center && (target === null || px > target)) target = px;
    }
    if (target !== null) {
      scrollEl.scrollTo({ left: target - scrollEl.clientWidth / 2, behavior: 'smooth' });
    }
  }

  function showError(): void {
    const message = ui.feedErrors[feed.id];
    if (message) ui.errorModal = { feedName: feed.name, message };
  }

  const expandIcon = $derived(feed.collapsed ? 'chevron-right' : 'chevron-down');
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
  <IconButton icon={expandIcon} label={expandLabel} variant="ghost" onclick={toggle} size={18} />
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
  <span class="spacer"></span>
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
</header>

<style>
  .row-header {
    position: sticky;
    left: 0;
    top: 50px;
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 4px 8px;
    height: 36px;
    background: var(--paper);
    border-bottom: 1px solid var(--ink);
    box-shadow: var(--shadow-1);
    z-index: 4;
    width: max-content;
    min-width: 100%;
    box-sizing: border-box;
  }
  .row-header[data-collapsed='true'] {
    border-bottom: none;
    box-shadow: none;
  }
  .row-header[data-kind='holidays'] .name {
    color: var(--ink-muted);
  }
  .name {
    flex: 0 1 240px;
    min-width: 0;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    padding: 4px 6px;
    font-size: 13px;
    font-weight: 600;
    height: 28px;
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
