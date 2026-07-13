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

  const prevIcon = $derived(atStart ? 'fast-forward' : 'chevron-left');
  const nextIcon = $derived(atEnd ? 'rewind' : 'chevron-right');
  const prevLabel = $derived(atStart ? 'Wrap to last match' : 'Previous match');
  const nextLabel = $derived(atEnd ? 'Wrap to first match' : 'Next match');

  const countLabel = $derived(matchCount === 0 ? '0' : `${search.currentIndex + 1} / ${matchCount}`);

  $effect(() => {
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
    };
  });

  // Publish the input field's left edge (viewport x) so its CSS width can stretch
  // its right edge out to the 6M button's right edge (--toolbar-6m-right, set by
  // Toolbar). The left is fixed by the preceding clock-rewind button, so setting
  // the width doesn't move it — no feedback loop. Republish on layout changes.
  let inputWrapEl: HTMLElement | undefined = $state();
  $effect(() => {
    if (typeof document === 'undefined' || !inputWrapEl) return;
    const el = inputWrapEl;
    const update = (): void => {
      document.documentElement.style.setProperty(
        '--search-input-left',
        Math.round(el.getBoundingClientRect().left) + 'px',
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
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
  <div class="search-input-wrap" bind:this={inputWrapEl}>
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
    gap: var(--toolbar-gap);
    padding: var(--time-header-pad-x);
    height: var(--toolbar-h);
    border-bottom: var(--border-w) solid var(--ink);
    background: var(--paper);
    position: sticky;
    top: var(--toolbar-h);
    z-index: 9;
    /* Track the timeline's left inset while the desktop left tray is open. */
    margin-left: var(--tray-left-w, 0);
    transition: margin-left 150ms ease;
  }
  .search-toolbar :global(.icon-button[aria-pressed='true']) {
    background: var(--ink);
    color: var(--paper);
    border-color: var(--ink);
  }
  .search-input-wrap {
    /* Stretch the right edge out to the 6M button's right edge (both vars are
       viewport-x px published by Toolbar / this component); clamp so it never
       collapses on very narrow screens. */
    flex: 0 0 auto;
    width: max(120px, calc(var(--toolbar-6m-right, 240px) - var(--search-input-left, 40px)));
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
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: var(--accent);
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
    font-size: var(--fs-11);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
  .clear-btn:hover {
    color: var(--ink);
  }
  .search-right {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--toolbar-gap);
    flex-shrink: 0;
  }
  .count {
    flex: 1 1 auto;
    min-width: max-content;
    text-align: left;
    font-family: var(--mono);
    font-size: var(--fs-12);
    color: var(--ink);
    padding: 0 0.5em;
    white-space: nowrap;
  }
</style>
