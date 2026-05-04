<script lang="ts">
  import Toolbar from './components/Toolbar.svelte';
  import SearchToolbar from './components/SearchToolbar.svelte';
  import Timeline from './components/Timeline.svelte';
  import EventModal from './components/EventModal.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import ErrorModal from './components/ErrorModal.svelte';
  import { config, events, ui, zoom, search, focus, displayEventsFor } from './lib/state.svelte';
  import { today } from './lib/today.svelte';
  import { saveConfig } from './lib/storage';
  import { fetchAndParseFeed } from './lib/ics';
  import { rangeForToday } from './lib/layout';
  import { readUrlState, applyUrlState } from './lib/url';
  import { handleShortcut } from './lib/keyboard';
  import { buildIndex, search as runSearch, nextMatch } from './lib/search';
  import type { DisplayEvent, Zoom } from './lib/types';

  const range = $derived(
    rangeForToday(today.value, {
      pastMonths: config.pastMonths,
      futureMonths: config.futureMonths,
    }),
  );

  async function loadAllFeeds(): Promise<void> {
    ui.loading = true;
    ui.error = null;
    try {
      await Promise.all(
        config.feeds.map(async (feed) => {
          try {
            const parsed = await fetchAndParseFeed(feed.source, range.start, range.end);
            events.byFeed[feed.id] = parsed;
            delete ui.feedErrors[feed.id];
          } catch (err) {
            console.error('Failed to load feed', feed.id, err);
            events.byFeed[feed.id] = [];
            ui.feedErrors[feed.id] = (err as Error).message ?? String(err);
          }
        }),
      );
    } finally {
      ui.loading = false;
    }
  }

  const initial = readUrlState();
  if (initial.zoom) zoom.value = initial.zoom;
  if (initial.locale) config.locale = initial.locale;
  if (initial.dateFormat) config.dateFormat = initial.dateFormat;
  if (initial.theme) config.theme = initial.theme;

  $effect(() => {
    void loadAllFeeds();
  });

  $effect(() => {
    saveConfig(config);
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', config.theme);
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
    const handler = (): void => {
      const next = readUrlState();
      if (next.zoom) zoom.value = next.zoom;
      if (next.locale) config.locale = next.locale;
      if (next.dateFormat) config.dateFormat = next.dateFormat;
      if (next.theme) config.theme = next.theme;
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  });

  function setZoom(z: Zoom): void {
    window.dispatchEvent(new CustomEvent('cal:set-zoom', { detail: { zoom: z } }));
  }

  const orderedFeeds = $derived([...config.feeds].sort((a, b) => a.order - b.order));
  const expandedFeeds = $derived(orderedFeeds.filter((f) => !f.collapsed));

  const focusedFeedEvents = $derived.by<DisplayEvent[]>(() => {
    const feed = expandedFeeds[focus.rowIndex];
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
    const next = Math.max(0, Math.min(expandedFeeds.length - 1, focus.rowIndex + dir));
    if (next === focus.rowIndex) return;
    focus.rowIndex = next;
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
    if (ui.modalEvent) {
      ui.modalEvent = null;
    } else if (ui.errorModal) {
      ui.errorModal = null;
    } else if (ui.settingsOpen) {
      ui.settingsOpen = false;
    } else if (search.open) {
      closeSearch();
    }
  }

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
      });
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });

  const allVisibleEvents = $derived.by<DisplayEvent[]>(() => {
    const out: DisplayEvent[] = [];
    for (const feed of orderedFeeds) {
      if (feed.collapsed) continue;
      const arr = displayEventsFor(feed.id).filter((e) => !e.hidden);
      out.push(...arr);
    }
    return out;
  });

  const searchableEvents = $derived.by(() => {
    if (search.includesPast) return allVisibleEvents;
    const cutoff = today.value.getTime();
    return allVisibleEvents.filter((e) => e.end.getTime() >= cutoff);
  });

  const searchIndex = $derived(buildIndex(searchableEvents));
  const matches = $derived(
    search.query.trim().length > 0 ? runSearch(searchIndex, search.query) : [],
  );

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
      search.currentIndex = 0;
      const ev = matches[0]?.event;
      if (ev) {
        window.dispatchEvent(
          new CustomEvent('cal:scroll-to-date', { detail: { date: ev.start } }),
        );
      }
    }
  }
</script>

<Toolbar onRefresh={loadAllFeeds} onZoom={setZoom} />
{#if search.open}
  <SearchToolbar
    matchCount={matches.length}
    onPrev={searchPrev}
    onNext={searchNext}
    onClose={closeSearch}
    onIdle={searchIdle}
  />
{/if}
<Timeline rangeStart={range.start} rangeEnd={range.end} today={today.value} />
<EventModal />
<ErrorModal />
{#if ui.settingsOpen}
  <SettingsPanel onClose={() => (ui.settingsOpen = false)} onRefresh={loadAllFeeds} />
{/if}
{#if ui.toast}
  <output class="toast">{ui.toast}</output>
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: 1.5em;
    transform: translateX(-50%);
    padding: 0.4em 0.9em;
    border: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font-size: 12px;
    z-index: 40;
    pointer-events: none;
    box-shadow: var(--shadow-1);
  }
</style>
