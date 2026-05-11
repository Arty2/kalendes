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

  function toggleClock(): void {
    search.includesPast = !search.includesPast;
  }

  const atStart = $derived(matchCount > 0 && search.currentIndex === 0);
  const atEnd = $derived(matchCount > 0 && search.currentIndex === matchCount - 1);

  const prevIcon = $derived(atStart ? 'skip-to-start' : 'chevron-left');
  const nextIcon = $derived(atEnd ? 'skip-to-end' : 'chevron-right');
  const prevLabel = $derived(atStart ? 'Wrap to last match' : 'Previous match');
  const nextLabel = $derived(atEnd ? 'Wrap to first match' : 'Next match');

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
  <input
    type="search"
    placeholder="Search events…"
    aria-label="Search events"
    data-search-input
    value={search.query}
    oninput={onInput}
    onkeydown={onKey}
  />
  <span class="count" data-mono>
    {matchCount === 0 ? '0' : `${search.currentIndex + 1} / ${matchCount}`}
  </span>
  <span class="nav-spacer"></span>
  <div class="row-actions">
    <IconButton
      icon={prevIcon}
      label={prevLabel}
      variant="ghost"
      size={18}
      onclick={onPrev}
      disabled={matchCount === 0}
    />
    <IconButton
      icon={nextIcon}
      label={nextLabel}
      variant="ghost"
      size={18}
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
  input[type='search'] {
    flex: 0 1 280px;
    min-width: 0;
    height: 32px;
    box-sizing: border-box;
  }
  input[type='search']::-webkit-search-decoration {
    appearance: none;
    -webkit-appearance: none;
  }
  .count {
    font-size: 12px;
    color: var(--ink);
    padding: 0 0.4em;
    flex-shrink: 0;
  }
  .nav-spacer {
    flex: 1;
  }
  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    padding-right: var(--row-actions-right, 8px);
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
