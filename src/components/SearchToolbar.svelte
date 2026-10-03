<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { config, layout, search, isKiosk } from '../lib/state.svelte';
  import { getJumpDateMs, searchSpan } from '../lib/search-state.svelte';
  import { formatDate, formatDayCount } from '../lib/format';

  type Props = {
    matchCount: number;
    onPrev: () => void;
    onNext: () => void;
    // commit: Enter (act on it) rather than a pause in typing (just look).
    onIdle: (commit: boolean) => void;
    onSelectAll: () => void;
  };
  const { matchCount, onPrev, onNext, onIdle, onSelectAll }: Props = $props();

  const QUERY_HELP =
    'Search titles, notes and places. Narrow with in:calendar, loc:place, ' +
    'after:date, before:date and "exact words"; a marked span limits the search to its days. ' +
    'A date on its own (2027-03, next fri, +2w) goes there on Enter.';

  const IDLE_MS = 5_000;

  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      onIdle(false);
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
      onIdle(true);
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

  const jumpMs = $derived(getJumpDateMs());
  const span = $derived(searchSpan());
  const countLabel = $derived.by(() => {
    if (jumpMs != null) return formatDate(new Date(jumpMs), config.dateFormat, config.locale);
    const n = matchCount === 0 ? '0' : `${search.currentIndex + 1} / ${matchCount}`;
    return span ? n + ' · ' + formatDayCount(span.days, config.locale) : n;
  });
  const countTitle = $derived(
    jumpMs != null ? 'Enter goes to this date' : span ? 'Searching the marked days only' : undefined,
  );

  $effect(() => {
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
    };
  });

  // Track the input field's left edge (viewport x) so its CSS width can stretch
  // its right edge out to the 6M button's right edge (layout.zoomNavRight,
  // measured by Toolbar). The left is fixed by the preceding clock-rewind
  // button, so setting the width doesn't move it — no feedback loop. Both land
  // as custom properties on the field itself, not :root, so an update restyles
  // just this field rather than the whole timeline.
  let inputWrapEl: HTMLElement | undefined = $state();
  let inputLeft = $state(0);
  $effect(() => {
    if (typeof document === 'undefined' || !inputWrapEl) return;
    const el = inputWrapEl;
    const update = (): void => {
      inputLeft = Math.round(el.getBoundingClientRect().left);
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
  <div
    class="search-input-wrap"
    bind:this={inputWrapEl}
    style:--toolbar-6m-right={layout.zoomNavRight > 0 ? `${layout.zoomNavRight}px` : null}
    style:--search-input-left={inputLeft > 0 ? `${inputLeft}px` : null}
  >
    <input
      type="search"
      placeholder="Search or go to a date"
      title={QUERY_HELP}
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
  <span class="count" data-mono title={countTitle}
    >{#if jumpMs != null}<Icon name="jump-link" size={14} />{/if}{countLabel}</span
  >
  <div class="search-right">
    {#if !isKiosk()}
      <IconButton
        icon="check"
        label="Select all matches"
        variant="ghost"
        onclick={onSelectAll}
        disabled={matchCount === 0}
      />
    {/if}
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
    border-bottom: var(--border-w) solid var(--ink-color);
    background: var(--paper-color);
    position: sticky;
    top: var(--toolbar-h);
    z-index: 9;
    /* Track the timeline's left inset while the desktop left tray is open. */
    margin-left: var(--tray-left-w, 0);
    transition: margin-left 150ms ease;
  }
  .search-toolbar :global(.icon-button[aria-pressed='true']) {
    background: var(--ink-color);
    color: var(--paper-color);
    border-color: var(--ink-color);
  }
  .search-input-wrap {
    /* Stretch the right edge out to the 6M button's right edge (both vars are
       viewport-x px, set inline from layout.zoomNavRight / inputLeft); clamp so it never
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
    outline: 2px solid var(--accent-color);
    outline-offset: -1px;
    border-color: var(--accent-color);
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
  /* Hover/focus text tint comes from the global button rules (accent / --link-color). */
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
    color: var(--ink-color);
    padding: 0 0.5em;
    white-space: nowrap;
  }
  /* The go-to-date mark before a typed date ("Enter goes to this date"). */
  .count :global(.icon) {
    margin-right: 0.35em;
    vertical-align: -2px;
  }
</style>
