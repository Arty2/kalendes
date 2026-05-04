<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { zoom, search, ui, config } from '../lib/state.svelte';
  import { today } from '../lib/today.svelte';
  import { formatDate } from '../lib/format';
  import type { Zoom } from '../lib/types';

  type Props = { onRefresh: () => Promise<void>; onZoom: (z: Zoom) => void };
  const { onRefresh, onZoom }: Props = $props();

  const zooms: { id: Zoom; label: string }[] = [
    { id: 'month', label: '1M' },
    { id: 'quarter', label: '3M' },
    { id: 'half-year', label: '6M' },
    { id: 'year', label: '1Y' },
  ];

  function jumpToToday(): void {
    window.dispatchEvent(new CustomEvent('cal:jump-today'));
  }

  function toggleSearch(): void {
    search.open = !search.open;
    if (search.open) {
      queueMicrotask(() => {
        document.querySelector<HTMLInputElement>('input[data-search-input]')?.focus();
      });
    }
  }

  const dateLabel = $derived(formatDate(today.value, config.dateFormat, config.locale));
</script>

<header class="toolbar">
  <button class="title" type="button" onclick={jumpToToday} aria-label="Jump to today" title="Jump to today">
    <Icon name="today" size={18} />
    <time datetime={today.value.toISOString().slice(0, 10)}>{dateLabel}</time>
  </button>
  <nav aria-label="Zoom">
    {#each zooms as z (z.id)}
      <button
        class="zoom-btn"
        type="button"
        aria-pressed={zoom.value === z.id}
        onclick={() => onZoom(z.id)}
      >{z.label}</button>
    {/each}
  </nav>
  <span class="spacer"></span>
  <IconButton
    icon="search"
    label="Search events"
    pressed={search.open}
    onclick={toggleSearch}
  />
  <IconButton
    icon="refresh"
    label={ui.loading ? 'Loading' : 'Refresh feeds'}
    disabled={ui.loading}
    onclick={() => void onRefresh()}
  />
  <IconButton
    icon="settings"
    label="Settings"
    pressed={ui.settingsOpen}
    onclick={() => (ui.settingsOpen = !ui.settingsOpen)}
  />
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.4em 0.75em;
    height: 50px;
    border-bottom: 1px solid var(--ink);
    background: var(--paper);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    height: 32px;
    padding: 0 0.6em;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    flex-shrink: 0;
  }
  .title time {
    font-family: var(--mono);
    font-size: 13px;
    white-space: nowrap;
  }
  nav {
    display: inline-flex;
    gap: 0;
    flex-shrink: 0;
  }
  .zoom-btn {
    height: 32px;
    padding: 0 0.6em;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-family: var(--mono);
    font-size: 12px;
    min-width: 40px;
  }
  .zoom-btn + .zoom-btn {
    border-left-width: 0;
  }
  .zoom-btn[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .spacer {
    flex: 1;
  }
  @media (max-width: 640px) {
    .toolbar {
      gap: 0.35em;
      padding: 0.35em 0.5em;
    }
    .title {
      padding: 0 0.45em;
    }
    .title time {
      display: none;
    }
    .zoom-btn {
      min-width: 36px;
      padding: 0 0.4em;
      font-size: 11px;
    }
  }
</style>
