<script lang="ts">
  import Toolbar from './components/Toolbar.svelte';
  import SearchToolbar from './components/SearchToolbar.svelte';
  import Timeline from './components/Timeline.svelte';
  import EventModal from './components/EventModal.svelte';
  import AddEventModal from './components/AddEventModal.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import ErrorModal from './components/ErrorModal.svelte';
  import ShareImportModal from './components/ShareImportModal.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import SelectionBar from './components/SelectionBar.svelte';
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
    displayEventsFor,
    pushLog,
  } from './lib/state.svelte';
  import { getMatches } from './lib/search-state.svelte';
  import { decodeShareState, readShareParam, stripShareParam } from './lib/share';
  import { today } from './lib/today.svelte';
  import { saveConfig, loadEventsCache, saveEventsCache, GREEK_HOLIDAYS_URL, USA_HOLIDAYS_URL } from './lib/storage';
  import { fetchAndParseFeed } from './lib/ics';
  import { guessTimezoneFromName } from './lib/tz-guess';
  import { rangeForToday } from './lib/layout';
  import { readUrlState, applyUrlState } from './lib/url';
  import { handleShortcut } from './lib/keyboard';
  import { nextMatch } from './lib/search';
  import type { DisplayEvent, Zoom } from './lib/types';

  // Cache-first: populate events synchronously before first network fetch
  const _cache = loadEventsCache();
  if (_cache) {
    Object.assign(events.byFeed, _cache.byFeed);
    Object.assign(events.tzByFeed, _cache.tzByFeed);
    Object.assign(events.lastSuccessAt, _cache.lastSuccessAt);
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

  async function loadAllFeeds(): Promise<void> {
    ui.loading = true;
    ui.error = null;
    try {
      await Promise.all(
        config.feeds.filter((f) => f.source.kind !== 'scratchpad').map(async (feed) => {
          try {
            const parsed = await fetchAndParseFeed(feed.source, range.start, range.end);
            events.byFeed[feed.id] = parsed.events;
            const fromFeed = parsed.timezone && parsed.timezone !== 'UTC' ? parsed.timezone : null;
            const detectedTz = fromFeed ?? guessTimezoneFromName(feed.name) ?? parsed.timezone;
            if (detectedTz) events.tzByFeed[feed.id] = detectedTz;
            else delete events.tzByFeed[feed.id];
            for (const [uid, raw] of Object.entries(parsed.rawByUid)) {
              events.rawByUid[uid] = raw;
            }
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
      saveEventsCache(events.byFeed, events.tzByFeed, events.lastSuccessAt);
    } finally {
      ui.loading = false;
      checkDefaultFeedHealth();
    }
  }

  const initial = readUrlState();
  if (initial.zoom) zoom.value = initial.zoom;
  if (initial.locale) config.locale = initial.locale;
  if (initial.dateFormat) config.dateFormat = initial.dateFormat;
  if (initial.theme) config.theme = initial.theme;

  if (typeof location !== 'undefined') {
    const shareParam = readShareParam(location.search);
    if (shareParam) {
      const decoded = decodeShareState(shareParam);
      if (decoded) {
        ui.shareImport = decoded;
      } else {
        stripShareParam();
      }
    }
  }

  $effect(() => {
    void loadAllFeeds();
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    const period = Math.max(60_000, config.refreshIntervalMs);
    const tick = (): void => {
      if (document.visibilityState === 'visible') void loadAllFeeds();
    };
    const id = setInterval(tick, period);
    const onVis = (): void => {
      if (document.visibilityState === 'visible') void loadAllFeeds();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
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
        config.theme === 'auto'
          ? matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : config.theme;
      root.setAttribute('data-theme', resolved);
      const paper = getComputedStyle(root).getPropertyValue('--paper').trim();
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta && paper) meta.setAttribute('content', paper);
      const apple = document.querySelector<HTMLMetaElement>(
        'meta[name="apple-mobile-web-app-status-bar-style"]',
      );
      if (apple) apple.setAttribute('content', resolved === 'dark' ? 'black-translucent' : 'default');
    };
    apply();
    if (config.theme === 'auto' && typeof matchMedia !== 'undefined') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = config.locale === 'el' ? 'el' : 'en';
  });

  $effect(() => {
    applyUrlState({
      zoom: zoom.value,
      locale: config.locale,
      dateFormat: config.dateFormat,
      theme: config.theme,
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
      if (next.theme) config.theme = next.theme;
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

  function setZoom(z: Zoom): void {
    window.dispatchEvent(new CustomEvent('cal:set-zoom', { detail: { zoom: z } }));
  }

  const orderedFeeds = $derived(
    [...config.feeds].filter((f) => !f.hidden).sort((a, b) => a.order - b.order),
  );
  const expandedFeeds = $derived(orderedFeeds.filter((f) => !f.collapsed));

  const focusedFeedEvents = $derived.by<DisplayEvent[]>(() => {
    const feed = expandedFeeds.find((f) => f.id === focus.feedId);
    if (!feed) return [];
    return displayEventsFor(feed.id)
      .filter((e) => !e.hidden)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  });

  function moveEvent(dir: -1 | 1): void {
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

  function moveRow(dir: -1 | 1): void {
    if (expandedFeeds.length === 0) return;
    const curIdx = expandedFeeds.findIndex((f) => f.id === focus.feedId);
    let next: number;
    if (curIdx < 0) {
      next = dir === 1 ? 0 : expandedFeeds.length - 1;
    } else {
      next = Math.max(0, Math.min(expandedFeeds.length - 1, curIdx + dir));
      if (next === curIdx) return;
    }
    focus.feedId = expandedFeeds[next]?.id ?? null;
    focus.eventIndex = 0;
  }

  function jumpToToday(): void {
    window.dispatchEvent(new CustomEvent('cal:jump-today'));
  }

  function toggleSearch(): void {
    search.open = !search.open;
    if (search.open) {
      queueMicrotask(() => {
        document.querySelector<HTMLInputElement>('input[data-search-input]')?.focus();
      });
    }
  }

  function closeSearch(): void {
    search.open = false;
    search.query = '';
  }

  function toggleSettings(): void {
    ui.settingsOpen = !ui.settingsOpen;
  }

  function escapeKey(): void {
    if (ui.shareImport) {
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

  function toggleSelectFocused(): void {
    const list = focusedFeedEvents;
    const ev = list[focus.eventIndex];
    if (!ev) return;
    if (!selection.mode) selection.mode = true;
    toggleSelected(ev.uid);
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (): void => {
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

  function searchPrev(): void {
    if (matches.length === 0) return;
    search.currentIndex = nextMatch(matches, search.currentIndex, -1);
  }
  function searchNext(): void {
    if (matches.length === 0) return;
    search.currentIndex = nextMatch(matches, search.currentIndex, 1);
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
{#if selection.mode}
  <SelectionBar />
{/if}
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
<AddEventModal />
<ErrorModal />
<ShareImportModal onRefresh={loadAllFeeds} />
{#if ui.settingsOpen}
  <SettingsPanel onClose={() => (ui.settingsOpen = false)} onRefresh={loadAllFeeds} />
{/if}
<StatusBar />
