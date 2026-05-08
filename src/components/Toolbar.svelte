<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { zoom, search, ui, config } from '../lib/state.svelte';
  import { online } from '../lib/online.svelte';
  import { today } from '../lib/today.svelte';
  import { clock } from '../lib/clock.svelte';
  import { formatCurrentTzLabel, formatDate, formatTime, isDaylight } from '../lib/format';
  import { longPress, tap } from '../lib/haptics';
  import type { Zoom } from '../lib/types';

  type Props = { onRefresh: () => Promise<void>; onZoom: (z: Zoom) => void };
  const { onRefresh, onZoom }: Props = $props();

  const COOLDOWN_MS = 30_000;
  let lastRefresh = $state(0);
  let now = $state(Date.now());

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const refreshDisabled = $derived(
    ui.loading || now - lastRefresh < COOLDOWN_MS || !online.value,
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
    now = lastRefresh;
    await onRefresh();
  }

  const zooms: { id: Zoom; label: string }[] = [
    { id: 'month', label: '1M' },
    { id: 'quarter', label: '3M' },
    { id: 'half-year', label: '6M' },
    { id: 'year', label: '1Y' },
    { id: '2-year', label: '2Y' },
  ];

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
  const nowDate = $derived(new Date(clock.now));
  const nowTimeLabel = $derived(formatTime(nowDate, config.timeFormat, config.timezone));
  const nowTzLabel = $derived(formatCurrentTzLabel(config.timezone));
  const nowIsDay = $derived(isDaylight(config.timezone, nowDate));

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
    <span class="title-now" data-mono aria-hidden="true">
      <Icon name={nowIsDay ? 'sun' : 'moon'} size={12} />
      <span class="title-now-time">{nowTimeLabel}</span>
      <span class="title-now-tz">{nowTzLabel}</span>
    </span>
  </button>
  <nav aria-label="Zoom">
    {#each zooms as z (z.id)}
      <button
        class="zoom-btn"
        type="button"
        aria-pressed={zoom.value === z.id}
        onclick={() => { tap(); onZoom(z.id); }}
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
  <span class="refresh-wrap" data-spinning={ui.loading ? 'true' : null}>
    <IconButton
      icon="refresh"
      label={refreshTitle}
      title={refreshTitle}
      disabled={refreshDisabled}
      onclick={() => void handleRefresh()}
    />
  </span>
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
  .title-now {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: 11px;
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .title-now-tz {
    color: var(--ink-muted);
  }
  @media (max-width: 900px) {
    .title-now-tz { display: none; }
  }
  @media (max-width: 720px) {
    .title-now { display: none; }
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
