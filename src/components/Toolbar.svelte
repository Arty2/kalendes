<script lang="ts">
  import { untrack } from 'svelte';
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { zoom, search, ui, config, focus, isKiosk } from '../lib/state.svelte';
  import { online } from '../lib/online.svelte';
  import { today } from '../lib/today.svelte';
  import { formatDate } from '../lib/format';
  import { createLongPress, loading, countdownBeat } from '../lib/haptics';
  import {
    primeTimelineAudio,
    suspendTimelineAudio,
    playCountdownTone,
    countdownToneIndex,
  } from '../lib/timeline-music';
  import { clock } from '../lib/clock.svelte';
  import type { Zoom } from '../lib/types';

  type Props = {
    onRefresh: () => Promise<void>;
    onZoom: (z: Zoom, opts?: { jumpToday?: boolean }) => void;
  };
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
    loading();
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

  const yearPress = createLongPress();

  function handleYearClick(): void {
    if (yearPress.didFire()) return;
    onZoom('year');
    if (ui.musicSweeping) jumpToToday();
  }

  function handleYearDblClick(): void {
    yearPress.cancel();
    zoomToToday('year');
  }

  // Double-tap: change zoom and let the zoom handler center on today in one
  // coordinated scroll (avoids the center-preserving re-scroll clobbering it),
  // then clear focus + temp marker.
  function zoomToToday(z: Zoom): void {
    onZoom(z, { jumpToday: true });
    focus.feedId = null;
    focus.eventIndex = -1;
    clearTempMarker();
  }

  function jumpToToday(): void {
    focus.feedId = null;
    focus.eventIndex = -1;
    window.dispatchEvent(new CustomEvent('cal:jump-today'));
  }

  function clearTempMarker(): void {
    // Set the global marker directly so it clears even when the timeline (which
    // handles the cal:clear-temp-marker event) is unmounted in week view.
    ui.tempMarkerMs = null;
    window.dispatchEvent(new CustomEvent('cal:clear-temp-marker'));
  }

  // The 1W button toggles week ↔ last zoom on a single tap; a double tap clears
  // the day marker and returns to today (in week view). Debounce the toggle so a
  // double tap doesn't flip the zoom out and back before the dbl handler runs.
  let weekTapTimer: ReturnType<typeof setTimeout> | null = null;
  function handleWeekClick(): void {
    if (weekTapTimer != null) return; // second tap of a double — let dblclick win
    weekTapTimer = setTimeout(() => {
      weekTapTimer = null;
      onZoom(zoom.value === 'week' ? zoom.lastNonWeek : 'week');
    }, 230);
  }
  function handleWeekDblClick(): void {
    if (weekTapTimer != null) {
      clearTimeout(weekTapTimer);
      weekTapTimer = null;
    }
    if (zoom.value !== 'week') onZoom('week');
    clearTempMarker();
    jumpToToday();
  }

  // Easter egg: hold the date button through a three-beat countdown — "ding,
  // dung, dong" at 1s/2s/3s — and on the third beat the timeline starts playing
  // as music automatically (hold again to stop). Enabling ascends the chime;
  // disabling plays it in reverse. Once on, the date icon becomes a bell. Audio
  // is primed on pointerdown so the countdown beeps are audible within the user
  // gesture (Firefox and iOS Safari require this); an unused quick tap releases
  // the context again so jump-to-today leaves no audio on.
  const HOLD_STEP_MS = 1000;
  const HOLD_STEPS = 3;
  let holdTimers: ReturnType<typeof setTimeout>[] = [];
  let holdActivated = false;
  let suppressTitleClick = false;
  const titleIcon = $derived(ui.timelineMusic ? 'bell' : 'today');

  function clearHoldTimers(): void {
    for (const t of holdTimers) clearTimeout(t);
    holdTimers = [];
  }

  function startTitlePress(): void {
    suppressTitleClick = false;
    holdActivated = false;
    // Direction is fixed at press start: ascending to enable, reversed to
    // disable. Only this hold flips the flag, so the captured value stays valid.
    const enabling = !ui.timelineMusic;
    primeTimelineAudio();
    for (let beat = 1; beat <= HOLD_STEPS; beat++) {
      holdTimers.push(
        setTimeout(() => {
          playCountdownTone(countdownToneIndex(beat, enabling, HOLD_STEPS));
          countdownBeat();
          if (beat === HOLD_STEPS) {
            holdActivated = true;
            suppressTitleClick = true;
            ui.timelineMusic = enabling;
          }
        }, beat * HOLD_STEP_MS),
      );
    }
  }

  function endTitlePress(): void {
    clearHoldTimers();
    if (!holdActivated && !ui.timelineMusic) suspendTimelineAudio();
  }

  function handleTitleClick(): void {
    if (suppressTitleClick) {
      suppressTitleClick = false;
      return;
    }
    jumpToToday();
  }

  function toggleSearch(): void {
    search.open = !search.open;
    if (search.open) {
      queueMicrotask(() => {
        document.querySelector<HTMLInputElement>('input[data-search-input]')?.focus();
      });
    } else {
      // Leaving search mode drops the query too, so the match-highlight /
      // hide-non-matching treatment doesn't linger on the timeline.
      search.query = '';
    }
  }

  const dateLabel = $derived(formatDate(today.value, config.dateFormat, config.locale));

  // One hold, two outcomes: released between 500ms and 3s flips the theme (on
  // release, not mid-hold); holding to 3s locks/unlocks kiosk instead.
  const THEME_PRESS_MS = 500;
  const kioskPress = createLongPress(3000);
  let pressStart = 0;
  let suppressClick = false;
  let tempIcon = $state<string | null>(null);
  let iconTimer: ReturnType<typeof setTimeout> | null = null;
  const settingsIcon = $derived(tempIcon ?? (isKiosk() ? 'lock' : 'settings'));
  const settingsLabel = $derived(
    isKiosk()
      ? 'Kiosk locked (long-press 3s to unlock)'
      : 'Settings (long-press: flip theme; hold 3s to lock)',
  );

  function flipTheme(target: HTMLElement | null): void {
    const effective =
      config.theme === 'auto'
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : config.theme;
    config.theme = effective === 'dark' ? 'light' : 'dark';
    target?.blur();
    tempIcon = config.theme === 'dark' ? 'moon' : 'sun';
    if (iconTimer) clearTimeout(iconTimer);
    iconTimer = setTimeout(() => { tempIcon = null; }, 2000);
  }

  function startSettingsPress(): void {
    pressStart = Date.now();
    suppressClick = false;
    kioskPress.start(() => {
      suppressClick = true;
      ui.kioskPinModal = isKiosk() ? 'unlock' : 'set';
    });
  }

  function endSettingsPress(e: PointerEvent): void {
    const elapsed = Date.now() - pressStart;
    const kioskFired = kioskPress.didFire();
    kioskPress.cancel();
    // Held to the lock threshold: kiosk modal already handled it — never flip.
    if (kioskFired) return;
    // Released after a deliberate hold but before the lock: flip the theme now.
    if (elapsed >= THEME_PRESS_MS) {
      flipTheme(e.currentTarget as HTMLElement);
      suppressClick = true;
    }
  }

  function abortSettingsPress(): void {
    kioskPress.cancel();
  }

  function handleSettingsClick(): void {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (isKiosk()) return;
    ui.settingsOpen = !ui.settingsOpen;
  }

  let rightGroupEl: HTMLElement | undefined = $state();
  let zoomNavEl: HTMLElement | undefined = $state();
  let toolbarEl: HTMLElement | undefined = $state();
  let spacerEl: HTMLElement | undefined = $state();
  // Hide the 1Y button when the toolbar can't fit it; kept in a cache so the
  // re-show test still knows its width once it's out of the DOM.
  let hideYear = $state(false);
  let lastYearW = 0;
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
      // Right edge of the 6M button (viewport x; the header starts at x=0) — the
      // search field stretches its right edge to match (SearchToolbar).
      const sixM = zoomNavEl?.querySelector<HTMLElement>('[data-zoom="half-year"]');
      if (sixM) {
        document.documentElement.style.setProperty(
          '--toolbar-6m-right',
          Math.round(sixM.getBoundingClientRect().right) + 'px',
        );
      }
      // Overflow-driven 1Y hide, with a small hysteresis so it can't oscillate:
      // hide when the row overflows; re-show only once the spacer reclaims more
      // than the button's own width.
      if (!toolbarEl || !spacerEl) return;
      const yearBtn = zoomNavEl?.querySelector<HTMLElement>('[data-zoom="year"]');
      if (yearBtn) lastYearW = yearBtn.offsetWidth;
      if (!hideYear && toolbarEl.scrollWidth - toolbarEl.clientWidth > 1) {
        hideYear = true;
      } else if (hideYear && spacerEl.offsetWidth > lastYearW + 4) {
        hideYear = false;
      }
    };
    // untrack: the sync call reads hideYear / element sizes — the effect should
    // only re-run when the bound element refs change, not on those reads.
    untrack(update);
    const ro = new ResizeObserver(update);
    if (rightGroupEl) ro.observe(rightGroupEl);
    if (zoomNavEl) ro.observe(zoomNavEl);
    if (toolbarEl) ro.observe(toolbarEl);
    return () => ro.disconnect();
  });
</script>

<header class="toolbar" bind:this={toolbarEl}>
  <button
    class="title"
    type="button"
    onclick={handleTitleClick}
    ondblclick={clearTempMarker}
    onpointerdown={startTitlePress}
    onpointerup={endTitlePress}
    onpointercancel={endTitlePress}
    onpointerleave={endTitlePress}
    aria-label="Jump to today (double-click to clear marker)"
    title="Jump to today"
  >
    <Icon name={titleIcon} size={18} />
    <time datetime={today.value.toISOString().slice(0, 10)}>{dateLabel}</time>
  </button>
  <button
    class="zoom-btn week-btn"
    type="button"
    aria-pressed={zoom.value === 'week'}
    title="1W · week view · double-tap to clear marker and jump to today"
    onclick={handleWeekClick}
    ondblclick={handleWeekDblClick}
  >1W</button>
  <nav aria-label="Zoom" bind:this={zoomNavEl}>
    {#each zooms as z (z.id)}
      {#if z.id === 'year'}
        <!-- The 1Y button is dropped when the toolbar can't fit it (narrow /
             relaxed spacing); the year & 2-year zoom levels stay reachable via
             pinch / wheel. Kept while it's the active zoom so its state shows. -->
        {#if !hideYear || yearActive}
          <button
            class="zoom-btn"
            type="button"
            data-zoom="year"
            aria-pressed={yearActive}
            title="1Y · long-press for 2Y · double-tap to jump to today"
            onclick={handleYearClick}
            ondblclick={handleYearDblClick}
            onpointerdown={() => yearPress.start(() => onZoom(zoom.value === '2-year' ? 'year' : '2-year'))}
            onpointerup={yearPress.cancel}
            onpointercancel={yearPress.cancel}
            onpointerleave={yearPress.cancel}
          >{yearLabel}</button>
        {/if}
      {:else}
        <button
          class="zoom-btn"
          type="button"
          data-zoom={z.id}
          aria-pressed={zoom.value === z.id}
          title="{z.label} · double-tap to jump to today"
          onclick={() => { onZoom(z.id); if (ui.musicSweeping) jumpToToday(); }}
          ondblclick={() => zoomToToday(z.id)}
        >{z.label}</button>
      {/if}
    {/each}
  </nav>
  <span class="spacer" bind:this={spacerEl}></span>
  <span class="toolbar-right" bind:this={rightGroupEl}>
    {#if !isKiosk()}
      <span class="refresh-wrap" data-spinning={ui.loading ? 'true' : null}>
        <IconButton
          icon="refresh"
          label={refreshTitle}
          title={refreshTitle}
          disabled={refreshDisabled}
          onclick={() => void handleRefresh()}
        />
      </span>
    {/if}
    <span
      class="settings-wrap"
      role="presentation"
      onpointerdown={startSettingsPress}
      onpointerup={endSettingsPress}
      onpointercancel={abortSettingsPress}
      onpointerleave={abortSettingsPress}
    >
      <IconButton
        icon={settingsIcon}
        label={settingsLabel}
        title={settingsLabel}
        pressed={ui.settingsOpen}
        onclick={handleSettingsClick}
      />
    </span>
    {#if !isKiosk()}
      <IconButton
        icon="search"
        label="Search events"
        pressed={search.open}
        onclick={toggleSearch}
      />
    {/if}
  </span>
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--toolbar-gap);
    padding: var(--time-header-pad-x);
    height: var(--toolbar-h);
    border-bottom: var(--border-w) solid var(--ink);
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
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    flex-shrink: 0;
  }
  .title time {
    font-size: var(--fs-13);
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
    border: var(--btn-border-w) solid var(--ink);
    border-radius: 0;
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-12);
    min-width: 40px;
  }
  .zoom-btn + .zoom-btn {
    border-left-width: 0;
  }
  .zoom-btn:first-of-type {
    border-top-left-radius: var(--btn-radius);
    border-bottom-left-radius: var(--btn-radius);
  }
  .zoom-btn:last-of-type {
    border-top-right-radius: var(--btn-radius);
    border-bottom-right-radius: var(--btn-radius);
  }
  .zoom-btn[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  /* The week toggle stands apart from the zoom progression: its own rounded
     button with a small gap before the 1M–1Y group. */
  .week-btn {
    margin-right: var(--toolbar-gap);
    border-radius: var(--btn-radius);
    flex-shrink: 0;
  }
  .spacer {
    flex: 1;
  }
  .toolbar-right {
    display: inline-flex;
    align-items: center;
    gap: var(--toolbar-gap);
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
    .title {
      padding: 0 0.45em;
    }
    .title time {
      display: none;
    }
    .zoom-btn {
      min-width: 36px;
      padding: 0 0.4em;
      font-size: var(--fs-11);
    }
  }
</style>
