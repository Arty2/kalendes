<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { search } from '../lib/state.svelte';

  type Props = {
    matchCount: number;
    onPrev: () => void;
    onNext: () => void;
    onIdle: () => void;
  };
  const { matchCount, onPrev, onNext, onIdle }: Props = $props();

  const IDLE_MS = 5_000;

  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      onIdle();
    }, IDLE_MS);
  }

  function onInput(e: Event): void {
    search.query = (e.currentTarget as HTMLInputElement).value;
    scheduleIdle();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      onIdle();
    }
  }

  function clearQuery(): void {
    search.query = '';
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function toggleClock(): void {
    search.includesPast = !search.includesPast;
  }

  const atStart = $derived(matchCount > 0 && search.currentIndex === 0);
  const atEnd = $derived(matchCount > 0 && search.currentIndex === matchCount - 1);

  const prevIcon = $derived(atStart ? 'rewind' : 'chevron-left');
  const nextIcon = $derived(atEnd ? 'fast-forward' : 'chevron-right');
  const prevLabel = $derived(atStart ? 'Wrap to last match' : 'Previous match');
  const nextLabel = $derived(atEnd ? 'Wrap to first match' : 'Next match');

  const countLabel = $derived(matchCount === 0 ? '0' : `${search.currentIndex + 1} / ${matchCount}`);

  $effect(() => {
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
    };
  });
</script>

<div class="search-toolbar" role="search">
  <IconButton
    icon="clock-rewind"
    label={search.includesPast ? 'Disable past-event search' : 'Include past events'}
    pressed={search.includesPast}
    variant="ghost"
    onclick={toggleClock}
  />
  <div class="search-input-wrap">
    <input
      type="search"
      placeholder="Search"
      aria-label="Search events"
      data-search-input
      value={search.query}
      oninput={onInput}
      onkeydown={onKey}
    />
    {#if search.query}
      <button
        type="button"
        class="clear-btn"
        aria-label="Clear search"
        onclick={clearQuery}
      >✕</button>
    {/if}
  </div>
  <span class="count" data-mono>{countLabel}</span>
  <div class="search-right">
    <IconButton
      icon={prevIcon}
      label={prevLabel}
      variant="ghost"
      onclick={onPrev}
      disabled={matchCount === 0}
    />
    <IconButton
      icon={nextIcon}
      label={nextLabel}
      variant="ghost"
      onclick={onNext}
      disabled={matchCount === 0}
    />
  </div>
</div>

<style>
  .search-toolbar {
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.35em 0.75em;
    height: 44px;
    border-bottom: 1px solid var(--ink);
    background: var(--paper);
    position: sticky;
    top: 50px;
    z-index: 9;
  }
  .search-toolbar :global(.icon-button[aria-pressed='true']) {
    background: var(--accent);
    color: var(--paper);
    border-color: var(--accent);
  }
  .search-input-wrap {
    flex: 0 0 var(--toolbar-zoom-w, 160px);
    min-width: 0;
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-input-wrap input[type='search'] {
    width: 100%;
    height: 32px;
    padding-right: 28px;
    box-sizing: border-box;
  }
  .search-input-wrap input[type='search']:focus,
  .search-input-wrap input[type='search']:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--ink);
  }
  .search-input-wrap input[type='search']::-webkit-search-decoration,
  .search-input-wrap input[type='search']::-webkit-search-cancel-button {
    appearance: none;
    -webkit-appearance: none;
  }
  .clear-btn {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
  .clear-btn:hover {
    color: var(--ink);
  }
  .search-right {
    flex: 0 0 var(--toolbar-right-w, 120px);
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5em;
    padding-right: 0;
  }
  .count {
    flex: 1;
    text-align: left;
    font-size: 12px;
    color: var(--ink);
    padding: 0 0.5em;
    white-space: nowrap;
  }
  @media (max-width: 640px) {
    .search-toolbar {
      padding: 0.3em 0.5em;
      gap: 0.3em;
    }
    .count {
      padding: 0 0.35em;
    }
  }
</style>
