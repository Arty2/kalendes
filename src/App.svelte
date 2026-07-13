<script lang="ts">
  import { untrack } from 'svelte';
  import Toolbar from './components/Toolbar.svelte';
  import SearchToolbar from './components/SearchToolbar.svelte';
  import Timeline from './components/Timeline.svelte';
  import EventModal from './components/EventModal.svelte';
  import EventHoverCard from './components/EventHoverCard.svelte';
  import AddEventModal from './components/AddEventModal.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import ErrorModal from './components/ErrorModal.svelte';
  import ShareImportModal from './components/ShareImportModal.svelte';
  import KioskPinModal from './components/KioskPinModal.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import {
    config,
    events,
    ui,
    zoom,
    search,
    focus,
    selection,
    clearSelection,
    toggleSelected,
    timelineEventsFor,
    pushLog,
    isKiosk,
  } from './lib/state.svelte';
  import { getMatches } from './lib/search-state.svelte';
  import { online } from './lib/online.svelte';
  import { decodeShareState, readShareParam, stripShareParam } from './lib/share';
  import { today } from './lib/today.svelte';
  import { saveConfig, loadEventsCache, saveEventsCache, GREEK_HOLIDAYS_URL, USA_HOLIDAYS_URL } from './lib/storage';
  import { fetchAndParseFeed } from './lib/ics';
  import { guessTimezoneFromName } from './lib/tz-guess';
  import { rangeForToday } from './lib/layout';
  import { readUrlState, applyUrlState, readMarkerHash, writeMarkerHash } from './lib/url';
  import { handleShortcut } from './lib/keyboard';
  import { tap } from './lib/haptics';
  import { nextMatch } from './lib/search';
  import type { DisplayEvent, Zoom } from './lib/types';
  import kaiOutline from './lib/kai-outline.json';

  // Cache-first: populate events synchronously before first network fetch
  const _cache = loadEventsCache();
  if (_cache) {
    Object.assign(events.byFeed, _cache.byFeed);
    Object.assign(events.tzByFeed, _cache.tzByFeed);
    Object.assign(events.lastSuccessAt, _cache.lastSuccessAt);
    Object.assign(events.validators, _cache.validators);
    // Restore prior feed-retrieval errors so they stay visible across reloads,
    // including while offline where loadAllFeeds skips the network entirely.
    Object.assign(ui.feedErrors, _cache.feedErrors);
  }

  const range = $derived(
    rangeForToday(today.value, {
      pastMonths: config.pastMonths,
      futureMonths: config.futureMonths,
    }),
  );

  const DEFAULT_FEED_URLS = new Set<string>([GREEK_HOLIDAYS_URL, USA_HOLIDAYS_URL]);
  let healthCheckRan = false;

  function checkDefaultFeedHealth(): void {
    if (healthCheckRan) return;
    healthCheckRan = true;
    const failed = config.feeds.filter(
      (f) => f.source.kind === 'user' && DEFAULT_FEED_URLS.has(f.source.url) && ui.feedErrors[f.id],
    );
    if (failed.length === 0) return;
    const word = failed.length === 1 ? 'calendar' : 'calendars';
    pushLog(`${failed.length} default ${word} failed to load — see Settings`, 'warn');
  }

  let lastRefreshMs = 0;

  async function loadAllFeeds(): Promise<void> {
    // Skip network refresh while offline; cached events stay shown. A reconnect
    // effect re-runs this once back online if the refresh interval has elapsed.
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    lastRefreshMs = Date.now();
    ui.loading = true;
    ui.error = null;
    try {
      await Promise.all(
        config.feeds.filter((f) => f.source.kind !== 'scratchpad' && !f.hidden).map(async (feed) => {
          try {
            // Revalidate with the stored ETag/Last-Modified only while we still
            // hold the feed's parsed events — on 304 they are what stays shown.
            // Read `events` via untrack so the load effect doesn't re-run on
            // this function's own writes to it.
            const validators = untrack(() =>
              events.byFeed[feed.id] !== undefined ? events.validators[feed.id] : undefined,
            );
            const outcome = await fetchAndParseFeed(feed.source, range.start, range.end, { validators });
            if (outcome.kind === 'not-modified') {
              events.lastSuccessAt[feed.id] = Date.now();
              delete ui.feedErrors[feed.id];
              return;
            }
            const parsed = outcome.result;
            events.byFeed[feed.id] = parsed.events;
            events.rawTextByFeed[feed.id] = outcome.text;
            if (outcome.validators) events.validators[feed.id] = outcome.validators;
            else delete events.validators[feed.id];
            const fromFeed = parsed.timezone && parsed.timezone !== 'UTC' ? parsed.timezone : null;
            const detectedTz = fromFeed ?? guessTimezoneFromName(feed.name) ?? parsed.timezone;
            if (detectedTz) events.tzByFeed[feed.id] = detectedTz;
            else delete events.tzByFeed[feed.id];
            events.lastSuccessAt[feed.id] = Date.now();
            delete ui.feedErrors[feed.id];
          } catch (err) {
            console.error('Failed to load feed', feed.id, err);
            const hadPrior = (events.byFeed[feed.id]?.length ?? 0) > 0;
            if (!hadPrior) events.byFeed[feed.id] = [];
            ui.feedErrors[feed.id] = (err as Error).message ?? String(err);
          }
        }),
      );
      saveEventsCache(events.byFeed, events.tzByFeed, events.lastSuccessAt, ui.feedErrors, events.validators);
    } finally {
      ui.loading = false;
      checkDefaultFeedHealth();
    }
  }

  const initial = readUrlState();
  if (initial.zoom) zoom.value = initial.zoom;
  if (initial.locale) config.locale = initial.locale;
  if (initial.dateFormat) config.dateFormat = initial.dateFormat;
  if (initial.scheme) config.scheme = initial.scheme;

  if (typeof location !== 'undefined') {
    const shareParam = readShareParam(location.search);
    if (shareParam) {
      // Decoding is async (DecompressionStream); the import prompt appears
      // once the payload resolves.
      void decodeShareState(shareParam).then((decoded) => {
        if (decoded) ui.shareImport = decoded;
        else stripShareParam();
      });
    }
    // A #d=YYYY-MM-DD fragment restores the viewed position on load; otherwise
    // the timeline opens on today.
    const marker = readMarkerHash(location.hash);
    if (marker != null) ui.tempMarkerMs = marker;
  }

  // Keep the URL fragment in sync with the temporary marker.
  $effect(() => {
    writeMarkerHash(ui.tempMarkerMs);
  });

  $effect(() => {
    void loadAllFeeds();
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    const period = Math.max(60_000, config.refreshIntervalMs);
    const tick = (): void => {
      if (document.visibilityState === 'visible' && navigator.onLine) void loadAllFeeds();
    };
    const id = setInterval(tick, period);
    const onVis = (): void => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      // Refresh on focus only once the interval has elapsed — plain tab
      // switching shouldn't hammer every feed (mirrors the reconnect guard).
      if (Date.now() - lastRefreshMs >= period) void loadAllFeeds();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  });

  // When connectivity returns, refresh if the refresh interval has elapsed
  // since the last successful attempt.
  $effect(() => {
    if (!online.value) return;
    const period = Math.max(60_000, config.refreshIntervalMs);
    if (lastRefreshMs > 0 && Date.now() - lastRefreshMs >= period) void loadAllFeeds();
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const snapshot = $state.snapshot(config) as typeof config;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveConfig(snapshot), 300);
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const apply = (): void => {
      const resolved =
        config.scheme === 'auto'
          ? matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : config.scheme;
      root.setAttribute('data-scheme', resolved);
      // Reading config.palette keeps this effect reactive to it; the computed
      // --paper/--ink read below then reflects the active palette (meta + favicon).
      root.setAttribute('data-palette', config.palette);
      const styles = getComputedStyle(root);
      const paper = styles.getPropertyValue('--paper').trim();
      const ink = styles.getPropertyValue('--ink').trim();
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta && paper) meta.setAttribute('content', paper);
      const apple = document.querySelector<HTMLMetaElement>(
        'meta[name="apple-mobile-web-app-status-bar-style"]',
      );
      if (apple) apple.setAttribute('content', resolved === 'dark' ? 'black-translucent' : 'default');
      // Recolor the favicon / app icon to match the active theme. The icon is
      // inverted (artwork on an ink plate), so ink paints the background and
      // paper the calendar + traced kai glyph (src/lib/kai-outline.json).
      if (paper && ink) {
        const kaiPath = 'M' + kaiOutline.map((p) => p.join(' ')).join('L') + 'Z';
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
          `<rect width="32" height="32" fill="${ink}"/>` +
          `<g fill="none" stroke="${paper}" stroke-width="2">` +
          `<rect x="5" y="5" width="22" height="22" rx="2.5"/>` +
          `<line x1="11" y1="2.5" x2="11" y2="6.5"/>` +
          `<line x1="21" y1="2.5" x2="21" y2="6.5"/>` +
          `</g>` +
          `<path fill="${paper}" d="${kaiPath}"/></svg>`;
        const href = 'data:image/svg+xml,' + encodeURIComponent(svg);
        for (const sel of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]']) {
          document.querySelector<HTMLLinkElement>(sel)?.setAttribute('href', href);
        }
      }
    };
    apply();
    if (config.scheme === 'auto' && typeof matchMedia !== 'undefined') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = config.locale === 'el' ? 'el' : 'en';
  });

  // Motion override: 'auto' follows the OS, 'reduced'/'full' force it. Drives
  // the data-motion attribute consumed by the reduced-motion CSS in global.css.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const apply = (): void => {
      const resolved =
        config.motion === 'auto'
          ? matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'reduced'
            : 'full'
          : config.motion;
      root.setAttribute('data-motion', resolved);
    };
    apply();
    if (config.motion === 'auto' && typeof matchMedia !== 'undefined') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  });

  // Font size: set the root px so all rem-based sizing scales together.
  $effect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.fontSize = config.fontSize + 'px';
  });

  // Border weight: drives the data-border-weight attribute consumed by --border-w
  // in global.css (thin = 1px, bold = 2px).
  $effect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-border-weight', config.borderWeight);
  });

  // Spacing/density: 'auto' is condensed on mobile, relaxed on desktop; an
  // explicit choice forces it. Drives the data-spacing attribute consumed by the
  // density tokens in global.css. "Mobile" matches the app's other breakpoints.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const mqP = typeof matchMedia !== 'undefined' ? matchMedia('(orientation: portrait) and (max-width: 640px)') : null;
    const mqL = typeof matchMedia !== 'undefined' ? matchMedia('(orientation: landscape) and (max-width: 900px)') : null;
    const apply = (): void => {
      const resolved =
        config.spacing === 'auto'
          ? (mqP?.matches || mqL?.matches) ? 'condensed' : 'relaxed'
          : config.spacing;
      root.setAttribute('data-spacing', resolved);
    };
    apply();
    if (config.spacing === 'auto' && mqP && mqL) {
      mqP.addEventListener('change', apply);
      mqL.addEventListener('change', apply);
      return () => {
        mqP.removeEventListener('change', apply);
        mqL.removeEventListener('change', apply);
      };
    }
  });

  $effect(() => {
    applyUrlState({
      zoom: zoom.value,
      locale: config.locale,
      dateFormat: config.dateFormat,
      scheme: config.scheme,
    });
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: PopStateEvent): void => {
      const state = e.state as { settingsOpen?: boolean } | null;
      if (ui.settingsOpen && !(state && state.settingsOpen)) {
        ui.settingsOpen = false;
        return;
      }
      const next = readUrlState();
      if (next.zoom) zoom.value = next.zoom;
      if (next.locale) config.locale = next.locale;
      if (next.dateFormat) config.dateFormat = next.dateFormat;
      if (next.scheme) config.scheme = next.scheme;
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  });

  let pushedSettingsHistory = false;
  $effect(() => {
    if (typeof window === 'undefined') return;
    if (ui.settingsOpen && !pushedSettingsHistory) {
      const prev = window.history.state as { settingsOpen?: boolean } | null;
      if (!(prev && prev.settingsOpen)) {
        window.history.pushState({ settingsOpen: true }, '');
      }
      pushedSettingsHistory = true;
    } else if (!ui.settingsOpen && pushedSettingsHistory) {
      const cur = window.history.state as { settingsOpen?: boolean } | null;
      if (cur && cur.settingsOpen) {
        window.history.back();
      }
      pushedSettingsHistory = false;
    }
  });

  function setZoom(z: Zoom, opts?: { jumpToday?: boolean }): void {
    window.dispatchEvent(
      new CustomEvent('cal:set-zoom', { detail: { zoom: z, jumpToday: opts?.jumpToday } }),
    );
  }

  const orderedFeeds = $derived(
    [...config.feeds].filter((f) => !f.hidden).sort((a, b) => a.order - b.order),
  );
  const expandedFeeds = $derived(orderedFeeds.filter((f) => !f.collapsed));

  const focusedFeedEvents = $derived.by<DisplayEvent[]>(() => {
    const feed = expandedFeeds.find((f) => f.id === focus.feedId);
    if (!feed) return [];
    // Same merged, start-sorted list the row renders, so arrow-key focus lands
    // on the pill it points at (a merged run counts as one step).
    return timelineEventsFor(feed.id);
  });

  function moveEvent(dir: -1 | 1): boolean | void {
    // While the modal is open it owns the arrow keys (prev/next paging), so the
    // timeline focus declines and lets EventModal's handler take over.
    if (ui.modalEvent) return false;
    const list = focusedFeedEvents;
    if (list.length === 0) return;
    const next = Math.max(0, Math.min(list.length - 1, focus.eventIndex + dir));
    focus.eventIndex = next;
    const ev = list[next];
    if (ev) {
      window.dispatchEvent(
        new CustomEvent('cal:scroll-to-date', { detail: { date: ev.start } }),
      );
    }
  }

  // Index of the event whose start is nearest `refMs`; 0 for an empty list.
  function closestIndexByTime(list: DisplayEvent[], refMs: number): number {
    let best = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < list.length; i++) {
      const delta = Math.abs(list[i]!.start.getTime() - refMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    }
    return best;
  }

  function moveRow(dir: -1 | 1): boolean | void {
    if (ui.modalEvent) return false;
    if (expandedFeeds.length === 0) return;
    const curIdx = expandedFeeds.findIndex((f) => f.id === focus.feedId);
    // Reference point for the jump: the currently focused event's time, so the
    // adjacent lane lands on its nearest-in-time event rather than its first.
    // Fall back to today when nothing is focused yet.
    const cur = focusedFeedEvents[focus.eventIndex];
    const refMs = cur ? cur.start.getTime() : today.value.getTime();
    let next: number;
    if (curIdx < 0) {
      next = dir === 1 ? 0 : expandedFeeds.length - 1;
    } else {
      next = Math.max(0, Math.min(expandedFeeds.length - 1, curIdx + dir));
      if (next === curIdx) return;
    }
    const targetFeed = expandedFeeds[next];
    focus.feedId = targetFeed?.id ?? null;
    focus.eventIndex = targetFeed
      ? closestIndexByTime(timelineEventsFor(targetFeed.id), refMs)
      : 0;
  }

  function jumpToToday(): void {
    window.dispatchEvent(new CustomEvent('cal:jump-today'));
  }

  // Digit shortcuts jump straight to a zoom level (mirroring the toolbar labels);
  // '.' is the 1W week view and '0' recenters on today. Unlike the toolbar
  // buttons these don't jump to today — '0' owns that — so the center is kept.
  const ZOOM_PRESETS: Record<string, Zoom> = {
    '1': 'month',
    '2': 'quarter',
    '3': 'half-year',
    '4': 'year',
    '5': '2-year',
  };
  function zoomPreset(k: string): boolean {
    if (ui.modalEvent) return false;
    if (k === '0') {
      jumpToToday();
      return true;
    }
    if (k === '.') {
      setZoom('week');
      return true;
    }
    const z = ZOOM_PRESETS[k];
    if (!z) return false;
    setZoom(z);
    return true;
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

  function closeSearch(): void {
    search.open = false;
    search.query = '';
  }

  function toggleSettings(): void {
    if (isKiosk()) return;
    ui.settingsOpen = !ui.settingsOpen;
  }

  function escapeKey(): void {
    if (ui.kioskPinModal) {
      ui.kioskPinModal = null;
    } else if (ui.shareImport) {
      ui.shareImport = null;
      stripShareParam();
    } else if (ui.modalEvent) {
      ui.modalEvent = null;
    } else if (ui.addEventOpen) {
      ui.addEventOpen = false;
    } else if (ui.errorModal) {
      ui.errorModal = null;
    } else if (ui.settingsOpen) {
      ui.settingsOpen = false;
    } else if (search.open) {
      closeSearch();
    } else if (selection.mode) {
      clearSelection();
    }
  }

  // Returns false when there is nothing focused to select, letting Space fall
  // through to the week-view toggle below.
  function toggleSelectFocused(): boolean {
    if (isKiosk()) return false;
    const list = focusedFeedEvents;
    const ev = list[focus.eventIndex];
    if (!ev) return false;
    if (!selection.mode) selection.mode = true;
    toggleSelected(ev.uid);
    return true;
  }

  // Space toggles the 1W week view, mirroring the toolbar's 1W button.
  function toggleWeekZoom(): void {
    setZoom(zoom.value === 'week' ? zoom.lastNonWeek : 'week');
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    // Fire on the raw pointerdown gesture, not the synthesized click — Firefox
    // Android binds vibration's user-activation requirement to it more reliably.
    const onTap = (e: Event): void => {
      const btn = (e.target as Element | null)?.closest?.('button');
      if (!btn) return;
      if ((btn as HTMLButtonElement).disabled) return;
      if (btn.getAttribute('aria-disabled') === 'true') return;
      tap();
    };
    document.addEventListener('pointerdown', onTap, true);
    return () => document.removeEventListener('pointerdown', onTap, true);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (): void => {
      if (isKiosk()) return;
      ui.addEventOpen = true;
    };
    window.addEventListener('cal:open-add-event', handler);
    return () => window.removeEventListener('cal:open-add-event', handler);
  });

  // Entering multi-select drops the single-event focus, so the focus ring
  // doesn't compete with the selection ring on the same pill.
  $effect(() => {
    if (selection.mode) {
      focus.feedId = null;
      focus.eventIndex = -1;
    }
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const listener = (e: KeyboardEvent): void => {
      handleShortcut(e, {
        onEnter: jumpToToday,
        onSearch: toggleSearch,
        onSettings: toggleSettings,
        onPrevEvent: () => moveEvent(-1),
        onNextEvent: () => moveEvent(1),
        onPrevRow: () => moveRow(-1),
        onNextRow: () => moveRow(1),
        onEscape: escapeKey,
        onToggleSelect: toggleSelectFocused,
        onToggleWeek: toggleWeekZoom,
        onZoomPreset: (k) => zoomPreset(k),
      });
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });

  const matches = $derived(getMatches());

  $effect(() => {
    if (matches.length === 0) {
      if (search.currentIndex !== 0) search.currentIndex = 0;
    } else if (search.currentIndex >= matches.length) {
      search.currentIndex = 0;
    }
  });

  // Moving through matches replaces any prior keyboard focus so the current
  // match is the sole highlight, and scrolls it into view.
  function focusCurrentMatch(): void {
    const ev = matches[search.currentIndex]?.event;
    if (!ev) return;
    focus.feedId = null;
    focus.eventIndex = -1;
    window.dispatchEvent(new CustomEvent('cal:scroll-to-date', { detail: { date: ev.start } }));
  }
  function searchPrev(): void {
    if (matches.length === 0) return;
    search.currentIndex = nextMatch(matches, search.currentIndex, -1);
    focusCurrentMatch();
  }
  function searchNext(): void {
    if (matches.length === 0) return;
    search.currentIndex = nextMatch(matches, search.currentIndex, 1);
    focusCurrentMatch();
  }

  function searchIdle(): void {
    if (matches.length > 0) {
      const todayMs = today.value.getTime();
      const firstFuture = matches.findIndex((m) => m.event.start.getTime() >= todayMs);
      search.currentIndex = firstFuture >= 0 ? firstFuture : 0;
      const ev = matches[search.currentIndex]?.event;
      if (ev) {
        window.dispatchEvent(
          new CustomEvent('cal:scroll-to-date', { detail: { date: ev.start } }),
        );
      }
    }
  }

  const IDLE_RESET_MS = 60 * 60 * 1000;
  $effect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function fire(): void {
      zoom.value = 'month';
      ui.tempMarkerMs = null;
      search.open = false;
      search.query = '';
      ui.settingsOpen = false;
      ui.modalEvent = null;
      ui.errorModal = null;
      focus.feedId = expandedFeeds[0]?.id ?? null;
      focus.eventIndex = -1;
      clearSelection();
      window.dispatchEvent(new CustomEvent('cal:jump-today'));
    }
    function reset(): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, IDLE_RESET_MS);
    }
    const events = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'];
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    const onVis = (): void => {
      if (document.visibilityState === 'visible') reset();
    };
    document.addEventListener('visibilitychange', onVis);
    reset();
    return () => {
      if (timer) clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
      document.removeEventListener('visibilitychange', onVis);
    };
  });
</script>

<Toolbar onRefresh={loadAllFeeds} onZoom={setZoom} />
{#if search.open}
  <SearchToolbar
    matchCount={matches.length}
    onPrev={searchPrev}
    onNext={searchNext}
    onIdle={searchIdle}
  />
{/if}
<Timeline rangeStart={range.start} rangeEnd={range.end} today={today.value} />
<EventModal />
<EventHoverCard />
<AddEventModal />
<ErrorModal />
<ShareImportModal onRefresh={loadAllFeeds} />
<KioskPinModal />
{#if ui.settingsOpen}
  <SettingsPanel onClose={() => (ui.settingsOpen = false)} onRefresh={loadAllFeeds} />
{/if}
<StatusBar />
