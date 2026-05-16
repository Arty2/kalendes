<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { zoom, search, ui, config } from '../lib/state.svelte';
  import { online } from '../lib/online.svelte';
  import { today } from '../lib/today.svelte';
  import { formatDate } from '../lib/format';
  import { longPress, tap } from '../lib/haptics';
  import { clock } from '../lib/clock.svelte';
  import type { Zoom } from '../lib/types';

  type Props = { onRefresh: () => Promise<void>; onZoom: (z: Zoom) => void };
  const { onRefresh, onZoom }: Props = $props();

  const COOLDOWN_MS = 60_000;
  let lastRefresh = $state(0);

  const refreshDisabled = $derived(
    ui.loading || clock.now - lastRefresh < COOLDOWN_MS || !online.value,
  );

  const refreshTitle = $derived(
    !online.value
      ? 'Offline — refresh disabled'
      : ui.loading
        ? 'Loading'
        : refreshDisabled
          ? 'Cooling down'
          : 'Refresh feeds',
  );

  async function handleRefresh(): Promise<void> {
    if (refreshDisabled) return;
    lastRefresh = Date.now();
    await onRefresh();
  }

  const zooms: { id: Zoom; label: string }[] = [
    { id: 'month', label: '1M' },
    { id: 'quarter', label: '3M' },
    { id: 'half-year', label: '6M' },
    { id: 'year', label: '1Y' },
  ];

  const yearActive = $derived(zoom.value === 'year' || zoom.value === '2-year');
  const yearLabel = $derived(zoom.value === '2-year' ? '2Y' : '1Y');

  let yearPressTimer: ReturnType<typeof setTimeout> | null = null;
  let yearLongFired = false;

  function startYearPress(): void {
    yearLongFired = false;
    if (yearPressTimer) clearTimeout(yearPressTimer);
    yearPressTimer = setTimeout(() => {
      yearPressTimer = null;
      yearLongFired = true;
      longPress();
      onZoom(zoom.value === '2-year' ? 'year' : '2-year');
    }, LONGPRESS_MS);
  }

  function cancelYearPress(): void {
    if (yearPressTimer) {
      clearTimeout(yearPressTimer);
      yearPressTimer = null;
    }
  }

  function handleYearClick(): void {
    if (yearLongFired) {
      yearLongFired = false;
      return;
    }
    tap();
    onZoom('year');
  }

  function handleYearDblClick(): void {
    yearLongFired = false;
    cancelYearPress();
    tap();
    onZoom('year');
    jumpToToday();
    clearTempMarker();
  }

  function jumpToToday(): void {
    window.dispatchEvent(new CustomEvent('cal:jump-today'));
  }

  function clearTempMarker(): void {
    window.dispatchEvent(new CustomEvent('cal:clear-temp-marker'));
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

  const LONGPRESS_MS = 500;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressFired = false;

  function startSettingsPress(e: PointerEvent): void {
    longPressFired = false;
    if (pressTimer) clearTimeout(pressTimer);
    const target = e.currentTarget as HTMLElement;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      longPressFired = true;
      config.theme = config.theme === 'dark' ? 'light' : 'dark';
      longPress();
      target.blur();
    }, LONGPRESS_MS);
  }

  function cancelSettingsPress(): void {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function handleSettingsClick(): void {
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    ui.settingsOpen = !ui.settingsOpen;
  }

  let rightGroupEl: HTMLElement | undefined = $state();
  let zoomNavEl: HTMLElement | undefined = $state();
  $effect(() => {
    if (typeof document === 'undefined') return;
    const update = (): void => {
      document.documentElement.style.setProperty(
        '--toolbar-right-w',
        (rightGroupEl?.offsetWidth ?? 0) + 'px',
      );
      document.documentElement.style.setProperty(
        '--toolbar-zoom-w',
        (zoomNavEl?.offsetWidth ?? 0) + 'px',
      );
    };
    update();
    const ro = new ResizeObserver(update);
    if (rightGroupEl) ro.observe(rightGroupEl);
    if (zoomNavEl) ro.observe(zoomNavEl);
    return () => ro.disconnect();
  });
</script>

<header class="toolbar">
  <button
    class="title"
    type="button"
    onclick={jumpToToday}
    ondblclick={clearTempMarker}
    aria-label="Jump to today (double-click to clear marker)"
    title="Jump to today"
  >
    <Icon name="today" size={18} />
    <time datetime={today.value.toISOString().slice(0, 10)}>{dateLabel}</time>
  </button>
  <nav aria-label="Zoom" bind:this={zoomNavEl}>
    {#each zooms as z (z.id)}
      {#if z.id === 'year'}
        <button
          class="zoom-btn"
          type="button"
          aria-pressed={yearActive}
          title="1Y · long-press for 2Y · double-tap to clear marker"
          onclick={handleYearClick}
          ondblclick={handleYearDblClick}
          onpointerdown={startYearPress}
          onpointerup={cancelYearPress}
          onpointercancel={cancelYearPress}
          onpointerleave={cancelYearPress}
        >{yearLabel}</button>
      {:else}
        <button
          class="zoom-btn"
          type="button"
          aria-pressed={zoom.value === z.id}
          title="{z.label} · double-tap to clear marker"
          onclick={() => { tap(); onZoom(z.id); }}
          ondblclick={() => { tap(); onZoom(z.id); jumpToToday(); clearTempMarker(); }}
        >{z.label}</button>
      {/if}
    {/each}
  </nav>
  <span class="spacer"></span>
  <span class="toolbar-right" bind:this={rightGroupEl}>
    <span
      class="settings-wrap"
      role="presentation"
      onpointerdown={startSettingsPress}
      onpointerup={cancelSettingsPress}
      onpointercancel={cancelSettingsPress}
      onpointerleave={cancelSettingsPress}
    >
      <IconButton
        icon="settings"
        label="Settings (long-press to flip theme)"
        title="Settings (long-press to flip theme)"
        pressed={ui.settingsOpen}
        onclick={handleSettingsClick}
      />
    </span>
    <span class="refresh-wrap" data-spinning={ui.loading ? 'true' : null}>
      <IconButton
        icon="refresh"
        label={refreshTitle}
        title={refreshTitle}
        disabled={refreshDisabled}
        onclick={() => void handleRefresh()}
      />
    </span>
    <IconButton
      icon="search"
      label="Search events"
      pressed={search.open}
      onclick={toggleSearch}
    />
  </span>
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
  .toolbar-right {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    flex-shrink: 0;
  }
  .refresh-wrap,
  .settings-wrap {
    display: inline-flex;
  }
  .refresh-wrap[data-spinning='true'] :global(.icon-button) :global(svg),
  .refresh-wrap[data-spinning='true'] :global(.icon-button) :global(.icon) {
    animation: cal-spin 800ms linear infinite;
    transform-origin: 50% 50%;
  }
  @keyframes cal-spin {
    from { transform: rotate(0); }
    to { transform: rotate(360deg); }
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
