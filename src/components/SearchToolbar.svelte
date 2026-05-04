<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { search } from '../lib/state.svelte';

  type Props = {
    matchCount: number;
    onPrev: () => void;
    onNext: () => void;
    onClose: () => void;
    onIdle: () => void;
  };
  const { matchCount, onPrev, onNext, onClose, onIdle }: Props = $props();

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
    scheduleIdle();
    queueMicrotask(() => {
      document.querySelector<HTMLInputElement>('input[data-search-input]')?.focus();
    });
  }

  function toggleClock(): void {
    search.includesPast = !search.includesPast;
  }

  $effect(() => {
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
    };
  });
</script>

<div class="search-toolbar" role="search">
  <IconButton
    icon="clock"
    label={search.includesPast ? 'Disable past-event search' : 'Include past events'}
    pressed={search.includesPast}
    variant="ghost"
    onclick={toggleClock}
  />
  <div class="search-input-wrap">
    <input
      type="search"
      placeholder="Search events…"
      aria-label="Search events"
      data-search-input
      value={search.query}
      oninput={onInput}
      onkeydown={onKey}
    />
    {#if search.query.length > 0}
      <button
        type="button"
        class="clear-btn"
        aria-label="Clear search text"
        onclick={clearQuery}
      >
        <span aria-hidden="true">×</span>
      </button>
    {/if}
  </div>
  <span class="count" data-mono>
    {matchCount === 0 ? '0' : `${search.currentIndex + 1} / ${matchCount}`}
  </span>
  <IconButton
    icon="chevron-left"
    label="Previous match"
    variant="ghost"
    onclick={onPrev}
    disabled={matchCount === 0}
  />
  <IconButton
    icon="chevron-right"
    label="Next match"
    variant="ghost"
    onclick={onNext}
    disabled={matchCount === 0}
  />
  <span class="spacer"></span>
  <IconButton icon="close" label="Close search" onclick={onClose} />
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
    position: relative;
    flex: 1 1 220px;
    min-width: 0;
    display: flex;
    align-items: center;
  }
  input[type='search'] {
    flex: 1 1 auto;
    min-width: 0;
    height: 32px;
    padding-right: 28px;
    box-sizing: border-box;
    width: 100%;
  }
  input[type='search']::-webkit-search-cancel-button,
  input[type='search']::-webkit-search-decoration {
    appearance: none;
    -webkit-appearance: none;
  }
  .clear-btn {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--ink-muted);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .clear-btn:hover {
    color: var(--ink);
  }
  .count {
    font-size: 12px;
    color: var(--ink);
    padding: 0 0.4em;
    flex-shrink: 0;
  }
  .spacer {
    flex: 1;
  }
  @media (max-width: 640px) {
    .search-toolbar {
      padding: 0.3em 0.5em;
      gap: 0.3em;
    }
    .count {
      padding: 0 0.2em;
    }
  }
</style>
