<script lang="ts">
  import { untrack } from 'svelte';
  import Toolbar from './components/Toolbar.svelte';
  import SearchToolbar from './components/SearchToolbar.svelte';
  import Timeline from './components/Timeline.svelte';
  import EventHoverCard from './components/EventHoverCard.svelte';
  import ErrorModal from './components/ErrorModal.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Lazy from './components/Lazy.svelte';
  import { CHANGELOG, markWhatsNewSeen, readWhatsNewSeen, releaseSignature, whatsNewOnStartup } from './lib/changelog';
  import {
    loadAddEventModal,
    loadEventModal,
    loadKioskPinModal,
    loadSettingsPanel,
    loadShareImportModal,
    loadShortcutsModal,
    loadWhatsNewModal,
    prefetchLazyComponents,
  } from './lib/lazy-components';
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
    deleteLocalEvents,
    rescheduleLocalEvents,
    undoLastChange,
    focusEventByUid,
    cancelHoverPreview,
    pushLog,
    isKiosk,
    displayRange,
    setTempMarkerDay,
    selectEvents,
    setTempMarkerRange,
    clearTempMarker,
    rollShake,
    shakeArmed,
    displayPalette,
    displayScheme,
    overlayOpen,
    closeOverlays,
    goToToday,
    lightRowInk,
  } from './lib/state.svelte';
  import { getMatches, getJumpDateMs } from './lib/search-state.svelte';
  import { online } from './lib/online.svelte';
  import { viewport } from './lib/viewport.svelte';
  import { decodeShareState, readShareParam, stripShareParam } from './lib/share';
  import { closeShareImport, openShareImport } from './lib/share-import.svelte';
  import { today, todayStartMs, setTodayZone } from './lib/today.svelte';
  import { swStatus, applyAppUpdate } from './lib/sw-status.svelte';
  import { saveConfig, loadEventsCache, GREEK_HOLIDAYS_URL, USA_HOLIDAYS_URL } from './lib/storage';
  import { warmParser } from './lib/ics';
  import { loadAllFeeds as loadFeeds, lastFeedRefreshMs } from './lib/feed-loader.svelte';
  import { followsFetchMode } from './lib/feed-transport';
  import {
    readUrlState,
    applyUrlState,
    readMarkerHash,
    writeMarkerHash,
    isLinkEntry,
    type UrlState,
    tagHistoryEntry,
  } from './lib/url';
  import { handleShortcut, isInField, type NudgeDir } from './lib/keyboard';
  import { KIOSK_IDLE_MS, clearKioskHome, readKioskHome, saveKioskHome, watchIdle } from './lib/kiosk-idle';
  import { dragMembers, nudgeChange } from './lib/event-drag';
  import { tap, loading, shakeRoll } from './lib/haptics';
  import {
    createShakeDetector,
    isShakeSupported,
    needsMotionPermission,
    requestMotionPermission,
  } from './lib/shake';
  import { nextMatch } from './lib/search';
  import type { DisplayEvent, KioskHome, Zoom } from './lib/types';
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

  // Shared with the display pipeline (state.displayRange) so the render window and
  // the parse window below can't drift.
  const range = $derived(displayRange());

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

  // The first completed pass reports any failing default calendars once.
  function loadAllFeeds(): Promise<void> {
    return loadFeeds(range).finally(() => {
      if (lastFeedRefreshMs() > 0) checkDefaultFeedHealth();
    });
  }

  // The view keys a URL carries (zoom, language, date format, scheme): on load
  // from the address, and from a link opened into the running tab, where a zoom
  // change goes through the timeline (`setZoom`) to keep its place.
  function applyViewState(view: UrlState, running: boolean): void {
    if (view.locale) config.locale = view.locale;
    if (view.dateFormat) config.dateFormat = view.dateFormat;
    if (view.scheme) config.scheme = view.scheme;
    if (!view.zoom || view.zoom === zoom.value) return;
    if (running) setZoom(view.zoom);
    else zoom.value = view.zoom;
  }
  applyViewState(readUrlState(), false);

  // Offer a shared link's config for import. Decoding is async
  // (DecompressionStream); the import prompt appears once the payload resolves.
  // Only the latest link counts: an earlier one still decoding (a longer link
  // takes longer) must not land after it — on a sign it would import itself.
  let shareLinkSeq = 0;
  function openSharedLink(shareParam: string): void {
    const seq = ++shareLinkSeq;
    // A new link replaces an earlier link's error (on a sign nobody can
    // dismiss it) — not a feed's error someone opened.
    if (ui.errorModal && !ui.errorModal.feedId) ui.errorModal = null;
    void decodeShareState(shareParam).then((decoded) => {
      // A newer link has been opened since: this one no longer stands.
      if (seq !== shareLinkSeq) return;
      if (decoded) {
        openShareImport(decoded);
        return;
      }
      stripShareParam();
      // Most often a long link cut short by the app it was sent through.
      ui.errorModal = {
        title: 'Could not import the shared link',
        feedName: '',
        message:
          'The link is incomplete or damaged — long links are sometimes cut short by the app they were sent through. Ask for the link again, or for an exported config file.',
      };
    });
  }

  // A #d=YYYY-MM-DD (optionally ..YYYY-MM-DD) fragment restores the viewed
  // position — and any duration span; otherwise the timeline opens on today.
  function applyMarkerFromHash(): number | null {
    const marker = readMarkerHash(location.hash);
    if (marker == null) return null;
    if (marker.endMs != null) setTempMarkerRange(marker.startMs, marker.endMs);
    else setTempMarkerDay(marker.startMs);
    return marker.startMs;
  }

  if (typeof location !== 'undefined') {
    const shareParam = readShareParam();
    if (shareParam) openSharedLink(shareParam);
    applyMarkerFromHash();
    // The entry the app opened on is its own from here: Back to it later is
    // a return, not a link.
    tagHistoryEntry();
  }

  // Put the present view and marker back into the address.
  function syncLocationToView(): void {
    applyUrlState({
      zoom: zoom.value,
      locale: config.locale,
      dateFormat: config.dateFormat,
      scheme: config.scheme,
    });
    writeMarkerHash(ui.tempMarkerMs, ui.tempMarkerEndMs);
  }

  // A link opened in a tab already showing the app changes only the fragment,
  // which doesn't reload the page: offer its share payload, move to its marker,
  // then put the present view back in the address. The browser fires popstate
  // and then hashchange for it (our own rewrites use replaceState, which fires
  // neither); whichever arrives first handles it and tags the entry, so the
  // other — and a later Back/Forward to it — leaves it alone.
  function openLinkEntry(): void {
    // Only the link's fragment counts: the query (a legacy `?s=` or view keys)
    // is this page's own, already applied on load. The view keys (a copied
    // address, a manifest shortcut landing in a running window) apply as they
    // would on load.
    const shareParam = readShareParam(location.hash, '');
    if (shareParam) openSharedLink(shareParam);
    // A locked kiosk refuses a link's payload, and its view keys and marker
    // too: a link must not change what it shows (its language and scheme
    // would persist). A sign takes the whole link, as it imports it.
    if (!isKiosk() || viewport.noPointer) {
      applyViewState(readUrlState(location.hash, ''), true);
      // On load the timeline opens on the marker by itself; a running one has
      // to be taken there.
      const markerMs = applyMarkerFromHash();
      if (markerMs != null) requestAnimationFrame(() => scrollToDay(markerMs));
    }
    // A link without a marker keeps the one on screen, in the URL too.
    syncLocationToView();
    tagHistoryEntry();
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (): void => {
      if (isLinkEntry()) openLinkEntry();
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  });

  // A new app version waits while Settings or the event editor (new or edit)
  // is open — the reload would drop unsaved changes — and takes over as soon
  // as both are closed. The marker rides the reload in the URL (#d=).
  $effect(() => {
    if (swStatus.updateReady && !ui.settingsOpen && !ui.addEventOpen) applyAppUpdate();
  });

  // A locked kiosk left alone returns home: open cards, search and selection
  // close, and the view goes back to the zoom, marker and rows it had when it
  // locked (or loaded locked) — on the marker's day if it came with one, today
  // otherwise. The home is read once per lock (kiosk-idle.ts keeps it across
  // reloads), so a visitor's changes never become the new home. The effect
  // re-runs when the PIN changes or a share link imports: either sets a new
  // home.
  $effect(() => {
    if (typeof window === 'undefined') return;
    const pin = config.kioskPin;
    void ui.kioskHomeRev;
    if (pin == null) return;
    const home = untrack(() => readKioskHome(pin) ?? captureKioskHome(pin));
    const stop = watchIdle(window, KIOSK_IDLE_MS, () => returnKioskHome(home));
    return () => {
      stop();
      if (config.kioskPin == null) clearKioskHome();
    };
  });

  function captureKioskHome(pin: string): KioskHome {
    const home: KioskHome = {
      pin,
      zoom: zoom.value,
      lastNonWeek: zoom.lastNonWeek,
      markerMs: ui.tempMarkerMs,
      markerEndMs: ui.tempMarkerEndMs,
      collapsed: Object.fromEntries(config.feeds.map((f) => [f.id, f.collapsed])),
    };
    saveKioskHome(home);
    return home;
  }

  function returnKioskHome(home: KioskHome): void {
    closeOverlays();
    if (ui.shareImport) closeShareImport();
    ui.statusExpanded = false;
    cancelHoverPreview();
    if (search.open) closeSearch();
    clearSelection();
    focus.feedId = null;
    focus.eventIndex = -1;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    for (const f of config.feeds) {
      const was = home.collapsed[f.id];
      if (was != null && f.collapsed !== was) f.collapsed = was;
    }
    // The marker goes back before the zoom: a timeline remounting out of 1W
    // opens on the marker when there is one, today otherwise.
    if (home.markerMs == null) clearTempMarker();
    else if (home.markerEndMs == null) setTempMarkerDay(home.markerMs);
    else setTempMarkerRange(home.markerMs, home.markerEndMs);
    document.querySelector('main')?.scrollTo({ top: 0 });
    const markerMs = home.markerMs;
    if (markerMs == null) {
      goToToday({ zoom: home.zoom });
    } else if (zoom.value === home.zoom) {
      scrollToDay(markerMs);
    } else {
      // A zoom change keeps the visitor's date in view, so go to the marker
      // once it has landed (its scroll runs in a microtask).
      setZoom(home.zoom);
      requestAnimationFrame(() => scrollToDay(markerMs));
    }
    // After the zoom change: entering 1W records the zoom it leaves as the one
    // to return to, which would be the visitor's.
    zoom.lastNonWeek = home.lastNonWeek;
  }

  function scrollToDay(dayMs: number): void {
    window.dispatchEvent(new CustomEvent('cal:scroll-to-date', { detail: { date: new Date(dayMs), utcDay: true } }));
  }

  // Light a row's ink whenever focus moves (keyboard row and event moves,
  // focusing an event from search or the tray); it fades on its own.
  $effect(() => {
    const feedId = focus.feedId;
    void focus.eventIndex;
    untrack(() => lightRowInk(feedId));
  });

  // "Today" is the display timezone's day; follow the setting before first paint.
  $effect.pre(() => {
    setTodayZone(config.timezone);
  });

  // Keep the URL fragment in sync with the temporary marker (and its duration).
  $effect(() => {
    writeMarkerHash(ui.tempMarkerMs, ui.tempMarkerEndMs);
  });

  // Placing/moving a marker focuses it (so the toolbar date shows the marker's
  // date); clearing it returns focus to today. Only fires when the marker VALUE
  // changes, so the cycle toggle (which writes markerFocus, not tempMarkerMs) is
  // never clobbered.
  $effect(() => {
    ui.markerFocus = ui.tempMarkerMs == null ? 'today' : 'marker';
  });

  // Spin the parse worker up while the initial feed fetches are still in flight,
  // so the first parse doesn't wait on Worker creation + ical.js compile.
  warmParser();
  prefetchLazyComponents();

  // What's new opens once by itself after an update brings new changelog lines;
  // a first run marks them read instead. Held back until startup settles (a share
  // link's import prompt arrives async) and skipped while anything else is up or
  // in kiosk mode — then it's simply offered again on the next launch.
  {
    const signature = releaseSignature(CHANGELOG[0]);
    const action = whatsNewOnStartup(readWhatsNewSeen(), signature);
    if (action === 'mark') markWhatsNewSeen(signature);
    else if (action === 'open' && typeof window !== 'undefined') {
      setTimeout(() => {
        if (isKiosk() || overlayOpen()) return;
        ui.whatsNewOpen = true;
      }, 1500);
    }
  }

  // Refetch when what a refresh would fetch changes: the range, or a visible
  // remote feed's id / source (added, removed, URL edited, unhidden). Keyed as a
  // string so a new feeds array with the same remote feeds (a local lane added,
  // an import of the same calendars, a rename) doesn't refetch everything.
  const remoteFeedsKey = $derived(
    JSON.stringify(
      config.feeds
        .filter((f) => f.source.kind !== 'scratchpad' && !f.hidden)
        .map((f) => [f.id, $state.snapshot(f.source)]),
    ),
  );
  $effect(() => {
    void remoteFeedsKey;
    void range;
    untrack(() => void loadAllFeeds());
  });

  // A new Fetch calendars mode reloads the feeds whose route it changes: one
  // it failed (or that a Direct-only error told the user to switch for)
  // shouldn't wait for the next refresh interval. Secret, public holiday and
  // refused feeds go the same way in every mode, so they're left alone.
  let fetchModeSeen = config.feedFetch;
  $effect(() => {
    const mode = config.feedFetch;
    if (mode === fetchModeSeen) return;
    fetchModeSeen = mode;
    untrack(() => {
      const ids = new Set(
        config.feeds
          .filter((f) => !f.hidden && f.source.kind === 'user' && followsFetchMode(f.source.url))
          .map((f) => f.id),
      );
      if (ids.size > 0) void loadFeeds(range, ids);
    });
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
      if (Date.now() - lastFeedRefreshMs() >= period) void loadAllFeeds();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  });

  // When connectivity returns, refresh if the refresh interval has elapsed
  // since the last attempt — or there was none yet (an offline start). On an
  // online start the load effect above has just stamped it, so this skips.
  $effect(() => {
    if (!online.value) return;
    const period = Math.max(60_000, config.refreshIntervalMs);
    if (Date.now() - lastFeedRefreshMs() >= period) void loadAllFeeds();
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
    // Attributes on <html> restyle the whole document, so they're only written
    // when they change, and the computed-colour read for the meta + favicon
    // waits a frame — at startup it would otherwise force a full style pass over
    // the freshly built timeline before its first paint.
    let frame = 0;
    const apply = (): void => {
      // 'auto' and 'shake' are modes; only their resolved value may reach the DOM,
      // since there is no :root[data-scheme="shake"] / [data-palette="shake"] rule.
      const resolved = displayScheme(viewport.prefersDark);
      if (root.getAttribute('data-scheme') !== resolved) root.setAttribute('data-scheme', resolved);
      // Reading the palette here keeps this effect reactive to it; the computed
      // --paper-color/--ink-color read below then reflects the active palette (meta + favicon).
      const palette = displayPalette();
      if (root.getAttribute('data-palette') !== palette) root.setAttribute('data-palette', palette);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paintChrome(resolved));
    };
    const paintChrome = (resolved: string): void => {
      const styles = getComputedStyle(root);
      const paper = styles.getPropertyValue('--paper-color').trim();
      const ink = styles.getPropertyValue('--ink-color').trim();
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta && paper) meta.setAttribute('content', paper);
      const apple = document.querySelector<HTMLMetaElement>(
        'meta[name="apple-mobile-web-app-status-bar-style"]',
      );
      if (apple) apple.setAttribute('content', resolved === 'dark' ? 'black-translucent' : 'default');
      // Recolor the favicon / app icon to match the active theme. The icon is
      // artwork on a paper plate: paper paints the background and ink the
      // calendar + traced kai glyph (src/lib/kai-outline.json).
      if (paper && ink) {
        const kaiPath = 'M' + kaiOutline.map((p) => p.join(' ')).join('L') + 'Z';
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
          `<rect width="32" height="32" fill="${paper}"/>` +
          `<g fill="none" stroke="${ink}" stroke-width="2">` +
          `<rect x="5" y="5" width="22" height="22" rx="2.5"/>` +
          `<line x1="11" y1="2.5" x2="11" y2="6.5"/>` +
          `<line x1="21" y1="2.5" x2="21" y2="6.5"/>` +
          `</g>` +
          `<path fill="${ink}" d="${kaiPath}"/></svg>`;
        const href = 'data:image/svg+xml,' + encodeURIComponent(svg);
        for (const sel of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]']) {
          document.querySelector<HTMLLinkElement>(sel)?.setAttribute('href', href);
        }
      }
    };
    apply();
    return () => cancelAnimationFrame(frame);
  });

  // Arm the 'shake' Flavor/Scheme modes: give them a concrete value on launch and
  // the moment they're selected (otherwise there'd be nothing to render), and drop
  // the roll when they're switched away so re-selecting Shake re-rolls. Reads the
  // modes, not the rolls, so it doesn't re-run on its own writes.
  $effect(() => {
    void config.palette;
    void config.scheme;
    untrack(() => rollShake());
  });

  // Shake to re-roll. Attaches only while a mode is armed. On desktop Firefox,
  // macOS Safari, and any device without an accelerometer this listener simply
  // never fires — the mode still works, it just only rolls once per launch.
  $effect(() => {
    if (!shakeArmed() || !isShakeSupported()) return;
    const detector = createShakeDetector(() => {
      if (isKiosk()) return;
      if (rollShake(true)) shakeRoll();
    });
    const onMotion = (e: DeviceMotionEvent): void => detector.handle(e);
    window.addEventListener('devicemotion', onMotion, { passive: true });
    return () => window.removeEventListener('devicemotion', onMotion);
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
          ? viewport.prefersReducedMotion
            ? 'reduced'
            : 'full'
          : config.motion;
      root.setAttribute('data-motion', resolved);
    };
    apply();
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
    root.setAttribute(
      'data-spacing',
      config.spacing === 'auto' ? (viewport.isDesktop ? 'relaxed' : 'condensed') : config.spacing,
    );
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
      if (ui.settingsOpen && !(state && state.settingsOpen)) ui.settingsOpen = false;
      // A pasted link, not Back/Forward: read its fragment before anything
      // rewrites it.
      if (isLinkEntry(state)) {
        openLinkEntry();
        return;
      }
      // Back never undoes a choice: the URL only mirrors the view (it is
      // written with replaceState), so the entry we land on carries whatever
      // zoom/locale/scheme/marker was current when it was left. Applying it
      // reverted a scheme picked in Settings; rewrite it to the present instead.
      syncLocationToView();
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
    const refMs = cur ? cur.start.getTime() : todayStartMs(false);
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
      goToToday();
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
    if (ui.shortcutsOpen) {
      ui.shortcutsOpen = false;
    } else if (ui.whatsNewOpen) {
      ui.whatsNewOpen = false;
    } else if (ui.kioskPinModal) {
      ui.kioskPinModal = null;
    } else if (ui.shareImport) {
      closeShareImport();
    } else if (ui.modalEvent && ui.modalShowSource) {
      ui.modalShowSource = false; // back from the raw view to the card
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
    } else {
      // Nothing left to close: drop the focused pill — its keyboard focus and
      // the button the browser still holds focused from the last tap or click.
      focus.feedId = null;
      focus.eventIndex = -1;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !isInField(active)) active.blur();
    }
  }

  // Enter opens the focused event's detail modal. Returns false when nothing is
  // focused so plain Enter falls through (and does nothing) rather than being
  // swallowed.
  function openFocusedEvent(): boolean {
    const ev = focusedFeedEvents[focus.eventIndex];
    if (!ev) return false;
    ui.modalEvent = ev;
    return true;
  }

  // Shift+Enter selects the focused event for the tray (multi-select). Returns
  // false when there is nothing focused.
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

  // Space: a single tap toggles 1W, a double tap jumps to today — debounced with
  // the same window as the toolbar's 1W button so the two gestures don't collide.
  const SPACE_DBL_MS = 230;
  let spaceTapTimer: ReturnType<typeof setTimeout> | null = null;
  function spaceTapped(): void {
    if (spaceTapTimer != null) {
      clearTimeout(spaceTapTimer);
      spaceTapTimer = null;
      goToToday();
      return;
    }
    spaceTapTimer = setTimeout(() => {
      spaceTapTimer = null;
      toggleWeekZoom();
    }, SPACE_DBL_MS);
  }

  // A blocking layer is open — the Google-Calendar single-key actions below
  // (create / today / page / help) stand down so they don't fire behind a dialog.
  function anyDialogOpen(): boolean {
    return !!(
      ui.modalEvent || ui.addEventOpen || ui.shareImport || ui.errorModal || ui.kioskPinModal || ui.whatsNewOpen
    );
  }
  // 'c' — create a new event (Google Calendar's create key), mirroring the
  // toolbar / cal:open-add-event path.
  function openAddEvent(): boolean {
    if (isKiosk() || anyDialogOpen()) return false;
    ui.addEventOpen = true;
    return true;
  }
  // 't' — cycle between today and the day marker (mirrors the toolbar date
  // button); no-op when no marker is set. Today itself stays on '0' / double-Space.
  function cycleMarker(): boolean {
    if (anyDialogOpen() || ui.tempMarkerMs == null) return false;
    window.dispatchEvent(new CustomEvent('cal:toggle-marker'));
    return true;
  }
  // 'n' / 'p' (and 'j' / 'k') — page the timeline (or the 1W grid) one screen,
  // reusing the cal:scroll-page motion each view already understands.
  function pageView(dir: 1 | -1): boolean {
    if (anyDialogOpen()) return false;
    window.dispatchEvent(new CustomEvent('cal:scroll-page', { detail: { dir } }));
    return true;
  }
  // '?' — the keyboard-shortcuts modal (also reachable by long-pressing search).
  function openHelp(): boolean {
    if (anyDialogOpen()) return false;
    ui.shortcutsOpen = true;
    return true;
  }
  // 'r' — refresh feeds, mirroring the toolbar refresh button.
  function refreshFeeds(): boolean {
    loading();
    void loadAllFeeds();
    return true;
  }
  // '#' / Delete / Backspace — delete the focused event, but only local/Draft
  // events (feed events can't be deleted); returns false otherwise so the key is
  // left unhandled.
  // Alt+←/→ moves the focused local event a day (Alt+↑/↓ is 1W-only, handled by
  // WeekGrid, which also owns Alt+arrows while it's mounted).
  function nudgeFocusedEvent(dir: NudgeDir): boolean {
    if (isKiosk() || ui.modalEvent || selection.mode || zoom.value === 'week') return false;
    const ev = focusedFeedEvents[focus.eventIndex];
    if (!ev) return false;
    if (dir === 'up' || dir === 'down') return false;
    const members = dragMembers(ev);
    const change = nudgeChange(dir, ev.allDay);
    if (!members || !change) return false;
    // A repeat nudged out of its series comes back as a new one-off: follow it.
    let uid = ev.uid;
    rescheduleLocalEvents(members.map((m) => m.uid), change, config.timezone, (from, to) => {
      if (from === uid) uid = to;
    });
    // Re-find it (the lane re-sorted) and keep it in view.
    focusEventByUid(uid);
    const moved = focusedFeedEvents[focus.eventIndex];
    if (moved) {
      window.dispatchEvent(new CustomEvent('cal:scroll-to-date', { detail: { date: moved.start } }));
    }
    return true;
  }

  function deleteFocusedEvent(): boolean {
    // Never behind a dialog or Settings: Backspace there would delete unseen.
    if (isKiosk() || overlayOpen()) return false;
    const ev = focusedFeedEvents[focus.eventIndex];
    if (!ev || !ev.feedId.startsWith('scratchpad:')) return false;
    deleteLocalEvents([ev.uid]);
    focus.eventIndex = -1;
    return true;
  }

  // iOS/iPadOS gates motion access behind a prompt that must be raised from a user
  // gesture. Picking "Shake" from a <select> fires a `change` event, which is not
  // user activation, so the request rides the next button press instead — in
  // practice whatever the user taps to leave Settings. Asked at most once per
  // session; a denial leaves Shake working as a once-per-launch roll.
  let motionAsked = false;

  $effect(() => {
    if (typeof document === 'undefined') return;
    // Fire on the raw pointerdown gesture, not the synthesized click — Firefox
    // Android binds vibration's user-activation requirement to it more reliably.
    const onTap = (e: Event): void => {
      const btn = (e.target as Element | null)?.closest?.('button');
      if (!btn) return;
      if ((btn as HTMLButtonElement).disabled) return;
      if (btn.getAttribute('aria-disabled') === 'true') return;
      if (!motionAsked && shakeArmed() && needsMotionPermission()) {
        motionAsked = true;
        void requestMotionPermission();
      }
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

  // A zoom / 1W switch unmounts the hovered pill without a pointerleave, so the
  // hover preview would otherwise linger with no way to dismiss it. Clear it
  // whenever the zoom changes.
  let lastHoverZoom = zoom.value;
  $effect(() => {
    const z = zoom.value;
    if (z !== lastHoverZoom) {
      lastHoverZoom = z;
      cancelHoverPreview();
    }
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
        // Overlays own Enter: the event card copies the event, and the other
        // dialogs (edit form, share import, PIN, error) handle it themselves —
        // opening a pill behind them would fight the dialog's own primary action.
        onEnter: () => {
          if (overlayOpen()) return false;
          return openFocusedEvent();
        },
        onSelect: toggleSelectFocused,
        onSearch: toggleSearch,
        onSettings: toggleSettings,
        onPrevEvent: () => moveEvent(-1),
        onNextEvent: () => moveEvent(1),
        onPrevRow: () => moveRow(-1),
        onNextRow: () => moveRow(1),
        onEscape: escapeKey,
        onSpace: spaceTapped,
        onZoomPreset: (k) => zoomPreset(k),
        onHelp: openHelp,
        onCreate: openAddEvent,
        onCycleMarker: cycleMarker,
        onNextPage: () => pageView(1),
        onPrevPage: () => pageView(-1),
        onRefresh: refreshFeeds,
        onDelete: deleteFocusedEvent,
        onNudge: nudgeFocusedEvent,
        onUndo: () => {
          // Not while selecting: the selection's actions hold the tray handle,
          // so the undo bar couldn't say what was undone.
          if (isKiosk() || anyDialogOpen() || selection.mode) return false;
          return undoLastChange();
        },
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

  // A match in a collapsed calendar can't be seen, so stepping onto one
  // expands its row.
  function revealFeedOf(ev: { feedId: string }): void {
    const feed = config.feeds.find((f) => f.id === ev.feedId);
    if (feed?.collapsed) feed.collapsed = false;
  }

  // Moving through matches replaces any prior keyboard focus so the current
  // match is the sole highlight, and scrolls it into view.
  function focusCurrentMatch(): void {
    const ev = matches[search.currentIndex]?.event;
    if (!ev) return;
    revealFeedOf(ev);
    focus.feedId = null;
    focus.eventIndex = -1;
    window.dispatchEvent(new CustomEvent('cal:scroll-to-date', { detail: { date: ev.start, utcDay: ev.allDay } }));
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

  // A pause in typing looks: a query that is a date ("2027-03", "next fri")
  // scrolls there, anything else to the first upcoming match. Enter commits:
  // it also marks that day, or opens a collapsed row holding the match —
  // changes a half-typed query shouldn't make.
  function searchIdle(commit: boolean): void {
    const jumpMs = getJumpDateMs();
    if (jumpMs != null) {
      if (commit) setTempMarkerDay(jumpMs);
      window.dispatchEvent(
        new CustomEvent('cal:scroll-to-date', { detail: { date: new Date(jumpMs), utcDay: true } }),
      );
      return;
    }
    if (matches.length > 0) {
      const firstFuture = matches.findIndex((m) => m.event.start.getTime() >= todayStartMs(m.event.allDay));
      search.currentIndex = firstFuture >= 0 ? firstFuture : 0;
      const ev = matches[search.currentIndex]?.event;
      if (ev) {
        if (commit) revealFeedOf(ev);
        window.dispatchEvent(
          new CustomEvent('cal:scroll-to-date', { detail: { date: ev.start, utcDay: ev.allDay } }),
        );
      }
    }
  }

  function selectAllMatches(): void {
    selectEvents(matches.map((m) => m.event.uid));
  }
  const allMatchesSelected = $derived(
    matches.length > 0 && matches.every((m) => selection.uids.has(m.event.uid)),
  );
  // Drop the matches from the selection, keeping anything selected besides
  // them; with nothing left, leave selection mode.
  function deselectAllMatches(): void {
    const next = new Set(selection.uids);
    for (const m of matches) next.delete(m.event.uid);
    if (next.size === 0) clearSelection();
    else selection.uids = next;
  }

  const IDLE_RESET_MS = 60 * 60 * 1000;
  $effect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function fire(): void {
      clearTempMarker();
      search.open = false;
      search.query = '';
      ui.settingsOpen = false;
      ui.modalEvent = null;
      ui.errorModal = null;
      focus.feedId = expandedFeeds[0]?.id ?? null;
      focus.eventIndex = -1;
      clearSelection();
      // Through the timeline's zoom path: coming from 1W the horizontal view
      // isn't mounted yet, and a bare zoom write + jump-today event would leave
      // it remounting at the start of the range rather than on today.
      ui.markerFocus = 'today';
      setZoom('month', { jumpToday: true });
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
    allSelected={allMatchesSelected}
    onSelectAll={selectAllMatches}
    onDeselectAll={deselectAllMatches}
  />
{/if}
<Timeline rangeStart={range.start} rangeEnd={range.end} today={today.value} />
<Lazy when={ui.modalEvent != null} load={loadEventModal} />
<EventHoverCard />
<Lazy when={ui.addEventOpen} load={loadAddEventModal} />
<ErrorModal />
<Lazy when={ui.shareImport != null} load={loadShareImportModal} props={{}} />
<Lazy when={ui.kioskPinModal != null} load={loadKioskPinModal} />
<Lazy when={ui.shortcutsOpen} load={loadShortcutsModal} />
<Lazy when={ui.whatsNewOpen} load={loadWhatsNewModal} />
{#if ui.settingsOpen}
  <Lazy
    when
    load={loadSettingsPanel}
    props={{ onClose: () => (ui.settingsOpen = false) }}
  />
{/if}
<StatusBar />
