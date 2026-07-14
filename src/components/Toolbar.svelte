<script lang="ts">
  import { untrack } from 'svelte';
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { zoom, search, ui, config, focus, isKiosk } from '../lib/state.svelte';
  import { fitCount, slideWindow } from '../lib/zoom-accordion';
  import { dragStepCount, clampZoomIndex } from '../lib/zoom-drag';
  import { ZOOM_ORDER } from '../lib/types';
  import { online } from '../lib/online.svelte';
  import { today } from '../lib/today.svelte';
  import { formatDate } from '../lib/format';
  import { createLongPress, loading, countdownBeat, tap } from '../lib/haptics';
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

  // Order must match ZOOM_ORDER — the accordion window indexes into both.
  const zooms: { id: Zoom; label: string }[] = [
    { id: 'month', label: '1M' },
    { id: 'quarter', label: '3M' },
    { id: 'half-year', label: '6M' },
    { id: 'year', label: '1Y' },
    { id: '2-year', label: '2Y' },
  ];

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

  // Long-press the search button to reveal the keyboard-shortcuts modal;
  // suppressSearchClick swallows the click that trails the hold so it doesn't
  // also toggle search (mirrors the settings button's suppressClick).
  const shortcutsPress = createLongPress();
  let suppressSearchClick = false;

  function startSearchPress(): void {
    suppressSearchClick = false;
    shortcutsPress.start(() => {
      suppressSearchClick = true;
      ui.shortcutsOpen = true;
    });
  }

  function endSearchPress(): void {
    shortcutsPress.cancel();
  }

  function handleSearchClick(): void {
    if (suppressSearchClick) {
      suppressSearchClick = false;
      return;
    }
    toggleSearch();
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
      : 'Settings (long-press: flip scheme; hold 3s to lock)',
  );

  function flipTheme(target: HTMLElement | null): void {
    const effective =
      config.scheme === 'auto'
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : config.scheme;
    config.scheme = effective === 'dark' ? 'light' : 'dark';
    target?.blur();
    tempIcon = config.scheme === 'dark' ? 'moon' : 'sun';
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

  // Accordion zoom nav: when the toolbar can't fit all zoom buttons, the ones
  // at the edges collapse into thin clickable slivers; the expanded buttons
  // form a contiguous window that always contains the active zoom (window math
  // in zoom-accordion.ts). Collapsed buttons stay in the DOM so widths animate
  // and measurement stays simple.
  const SLIVER_W = 8; // px; keep in sync with --zoom-sliver-w in the styles below
  let visibleCount = $state(ZOOM_ORDER.length);
  let windowStart = $state(0);
  // Cached widest expanded button, so the fit test still knows the full width
  // while buttons are collapsed (or mid-transition).
  let buttonW = 0;

  const activeIndex = $derived(
    ZOOM_ORDER.indexOf(zoom.value === 'week' ? zoom.lastNonWeek : zoom.value),
  );
  $effect(() => {
    windowStart = slideWindow(
      untrack(() => windowStart),
      activeIndex,
      visibleCount,
      ZOOM_ORDER.length,
    );
  });
  const isCollapsed = (i: number): boolean => i < windowStart || i >= windowStart + visibleCount;

  // Touch-drag across the zoom nav to scrub through the zoom levels (drag right
  // → longer ranges, left → shorter), one step per DRAG_STEP_PX of travel.
  // Touch/pen only — mouse has the wheel + click; a drag also suppresses the
  // release-tap so it doesn't double-fire on the button under the finger.
  const DRAG_STEP_PX = 40; // ~ one zoom button's width
  const DRAG_THRESHOLD_PX = 8; // travel before a press becomes a drag (vs a tap)
  let dragPointerId: number | null = null;
  let dragStartX = 0;
  let dragAnchorX = 0;
  let dragMoved = false;
  let suppressZoomClick = false;

  function stepZoom(steps: number): void {
    const current = zoom.value === 'week' ? zoom.lastNonWeek : zoom.value;
    const i = ZOOM_ORDER.indexOf(current);
    if (i < 0) return;
    const target = clampZoomIndex(i, steps, ZOOM_ORDER.length);
    if (target === i) return;
    onZoom(ZOOM_ORDER[target]!);
    tap();
    if (ui.musicSweeping) jumpToToday();
  }

  function onNavPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    dragPointerId = e.pointerId;
    dragStartX = e.clientX;
    dragAnchorX = e.clientX;
    dragMoved = false;
    // A fresh press clears any suppression left over from a drag that ended off
    // a button (no click came to consume it), so this tap still registers.
    suppressZoomClick = false;
  }

  function onNavPointerMove(e: PointerEvent): void {
    if (e.pointerId !== dragPointerId) return;
    if (!dragMoved && Math.abs(e.clientX - dragStartX) < DRAG_THRESHOLD_PX) return;
    if (!dragMoved) {
      dragMoved = true;
      zoomNavEl?.setPointerCapture(dragPointerId);
    }
    // Always advance the anchor by the whole steps traversed — even when the
    // zoom is already clamped at an end — so reversing the drag responds at once.
    const steps = dragStepCount(e.clientX - dragAnchorX, DRAG_STEP_PX);
    if (steps !== 0) {
      dragAnchorX += steps * DRAG_STEP_PX;
      stepZoom(steps);
    }
  }

  function onNavPointerUp(e: PointerEvent): void {
    if (e.pointerId !== dragPointerId) return;
    // Swallow the click the browser fires after a drag-release on a button.
    if (dragMoved) suppressZoomClick = true;
    dragPointerId = null;
    dragMoved = false;
  }

  function onZoomButtonClick(id: Zoom): void {
    if (suppressZoomClick) {
      suppressZoomClick = false;
      return;
    }
    onZoom(id);
    if (ui.musicSweeping) jumpToToday();
  }

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
      // search field stretches its right edge to match (SearchToolbar). When 6M
      // is collapsed, fall back to the rightmost expanded zoom button.
      const expanded = zoomNavEl
        ? Array.from(zoomNavEl.querySelectorAll<HTMLElement>('[data-zoom]:not([data-collapsed])'))
        : [];
      const sixM = zoomNavEl?.querySelector<HTMLElement>('[data-zoom="half-year"]:not([data-collapsed])');
      const searchAnchor = sixM ?? expanded[expanded.length - 1];
      if (searchAnchor) {
        document.documentElement.style.setProperty(
          '--toolbar-6m-right',
          Math.round(searchAnchor.getBoundingClientRect().right) + 'px',
        );
      }
      // How many zoom buttons fit. The budget — nav + spacer minus any overflow
      // of the row — is what the nav may occupy, and it is invariant to how many
      // buttons are collapsed (collapsing moves width from nav to spacer 1:1),
      // so the count can't oscillate on its own resizes. 2px slack absorbs
      // offsetWidth rounding.
      if (!toolbarEl || !spacerEl || !zoomNavEl) return;
      for (const btn of expanded) buttonW = Math.max(buttonW, btn.offsetWidth);
      if (buttonW === 0) return;
      const overhang = Math.max(0, toolbarEl.scrollWidth - toolbarEl.clientWidth);
      const budget = zoomNavEl.offsetWidth + spacerEl.offsetWidth - overhang - 2;
      visibleCount = fitCount(budget, buttonW, SLIVER_W, ZOOM_ORDER.length);
    };
    // untrack: the sync call reads visibleCount-dependent DOM / element sizes —
    // the effect should only re-run when the bound element refs change, not on
    // those reads.
    untrack(update);
    // Re-learn the cached button width once the row comes to rest: the cache
    // only grows during a resize storm (mid-transition measurements would
    // poison it low), but the 640px media query genuinely shrinks the buttons,
    // so a trailing full re-measure keeps it from sticking high after that.
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = (): void => {
      update();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        buttonW = 0;
        update();
      }, 220);
    };
    const ro = new ResizeObserver(onResize);
    if (rightGroupEl) ro.observe(rightGroupEl);
    if (zoomNavEl) ro.observe(zoomNavEl);
    if (toolbarEl) ro.observe(toolbarEl);
    return () => {
      ro.disconnect();
      if (settleTimer) clearTimeout(settleTimer);
    };
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
  <nav
    aria-label="Zoom"
    bind:this={zoomNavEl}
    onpointerdown={onNavPointerDown}
    onpointermove={onNavPointerMove}
    onpointerup={onNavPointerUp}
    onpointercancel={onNavPointerUp}
  >
    <!-- Buttons outside the accordion window collapse into thin slivers (still
         clickable — tapping one switches to that zoom, which expands it).
         Dragging across the nav scrubs through the zoom levels (see stepZoom). -->
    {#each zooms as z, i (z.id)}
      <button
        class="zoom-btn"
        type="button"
        data-zoom={z.id}
        data-collapsed={isCollapsed(i) ? 'true' : null}
        aria-pressed={zoom.value === z.id}
        title="{z.label} · drag to change zoom · double-tap to jump to today"
        onclick={() => onZoomButtonClick(z.id)}
        ondblclick={() => zoomToToday(z.id)}
      ><span class="zoom-label">{z.label}</span></button>
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
      <span
        class="search-wrap"
        role="presentation"
        onpointerdown={startSearchPress}
        onpointerup={endSearchPress}
        onpointercancel={endSearchPress}
        onpointerleave={endSearchPress}
      >
        <IconButton
          icon="search"
          label="Search events (long-press for keyboard shortcuts)"
          title="Search events · long-press for keyboard shortcuts"
          pressed={search.open}
          onclick={handleSearchClick}
        />
      </span>
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
    /* Shift right with the timeline when the desktop left tray is open (0 when
       closed), so the controls sit to the right of the tray. The .spacer keeps
       the right-side icons pinned to the viewport edge. */
    margin-left: var(--tray-left-w, 0);
    transition: margin-left 150ms ease;
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
    /* Width of a collapsed (sliver) zoom button; keep in sync with SLIVER_W. */
    --zoom-sliver-w: 8px;
    /* Claim horizontal drags for zoom scrubbing; leave vertical page scroll. */
    touch-action: pan-y;
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
    /* max-width bounds (not sets) the expanded width so the accordion collapse
       can animate — width:auto → fixed wouldn't. */
    max-width: 48px;
    overflow: hidden;
    white-space: nowrap;
    transition: min-width 0.18s ease, max-width 0.18s ease, padding 0.18s ease;
  }
  .zoom-btn[data-collapsed] {
    min-width: var(--zoom-sliver-w);
    max-width: var(--zoom-sliver-w);
    padding: 0;
  }
  .zoom-label {
    transition: opacity 0.18s ease;
  }
  .zoom-btn[data-collapsed] .zoom-label {
    opacity: 0;
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
  .settings-wrap,
  .search-wrap {
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
