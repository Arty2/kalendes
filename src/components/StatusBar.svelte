<script lang="ts">
  import { config, getDisplayByFeed, pushLog, selection, clearSelection, moveEventsToLane, copyEventsToLane, deleteLocalEvents, focus, ui, effectiveFeedTz, isKiosk } from '../lib/state.svelte';
  import { online } from '../lib/online.svelte';
  import { swStatus } from '../lib/sw-status.svelte';
  import { today } from '../lib/today.svelte';
  import { startOfDay, addDays, addMonths, isoWeekNumber } from '../lib/time';
  import { formatDate, formatDateLong, formatMonth, formatTime, durationDays } from '../lib/format';
  import Icon from './Icon.svelte';
  import CalendarDownloadMenu from './CalendarDownloadMenu.svelte';
  import { trayExpand, trayCollapse } from '../lib/haptics';
  import type { DisplayEvent, FeedCategory, ParsedEvent, Travel } from '../lib/types';

  // The collapsed tray height tracks the header's rendered height — it now carries
  // vertical padding (to match the bottom toolbar) and scales with the font-size
  // setting, so a fixed 28 would let the header spill below the screen. Measured
  // from the live `.handle` via bind:clientHeight; 28 is the pre-measure fallback.
  let collapsedHeight = $state(28);
  const MAX_HEIGHT_VH = 60;
  let showVersion = $state(true);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const t = setTimeout(() => { showVersion = false; }, 3000);
    return () => clearTimeout(t);
  });

  // Auto-dismiss the "offline ready" flash a few seconds after the service
  // worker reports the shell is precached.
  $effect(() => {
    if (!swStatus.offlineReady) return;
    const t = setTimeout(() => { swStatus.offlineReady = false; }, 3000);
    return () => clearTimeout(t);
  });

  let dragging = $state(false);
  let dragStartY = 0;
  let dragStartHeight = 0;
  let pointerMoved = false;
  let height = $state(28);
  let lastExpandedHeight = 28;
  // Swipe-down-to-dismiss on the tray body (not the header). Armed on pointerdown
  // only when the inner scroll region is at the top; promoted to a real header-style
  // drag once the finger clearly moves down, so content scroll and row taps survive.
  let trayArmed = false;
  let trayArmStartY = 0;
  let trayArmTarget: HTMLElement | null = null;
  let trayArmPointerId = 0;

  const expanded = $derived(height > collapsedHeight + 2);
  // Resting collapsed height: a touch taller than the header so the bar sits
  // comfortably at the screen bottom without clipping its content.
  const closedHeight = $derived(collapsedHeight + 2);
  // Keep the collapsed bar at the resting height whenever it isn't expanded
  // (covers the initial measure, font-size changes, and the header shrinking
  // back when selection mode exits). Keyed off the explicit expand flag so a
  // stale tall `height` isn't misread as "expanded" once the header re-measures.
  $effect(() => {
    if (!ui.statusExpanded) height = closedHeight;
  });
  const inSelectionMode = $derived(selection.mode && selection.uids.size > 0);

  // Local lanes (Draft + imported .ics) — destinations for move/copy.
  const localLanes = $derived(config.feeds.filter((f) => f.source.kind === 'scratchpad'));
  // Selected uids that live in a local lane (only those can be deleted/moved).
  const selectedLocalUids = $derived.by(() => {
    const out: string[] = [];
    if (selection.uids.size === 0) return out;
    const byFeed = getDisplayByFeed();
    for (const f of localLanes) {
      for (const ev of byFeed[f.id] ?? []) {
        if (selection.uids.has(ev.uid)) out.push(ev.uid);
      }
    }
    return out;
  });
  const hasLocalSelection = $derived(selectedLocalUids.length > 0);
  // URL-only selection: nothing to delete/move, so the action becomes a copy.
  const copyMode = $derived(selection.uids.size > 0 && !hasLocalSelection);
  // Count shows just the total when the selection is all one kind (all local or
  // all URL); a mixed selection shows "local / total" so it's clear how many can
  // be moved/deleted.
  const selTotal = $derived(selection.uids.size);
  const mixedSelection = $derived(selectedLocalUids.length > 0 && selectedLocalUids.length < selTotal);

  // --- Two-stage DELETE / CANCEL (tap → confirm → done+cooldown-to-undo) ---
  const CONFIRM_WINDOW_MS = 3000;
  type Stage = 'idle' | 'confirm' | 'done';
  let deleteStage = $state<Stage>('idle');
  let cancelStage = $state<Stage>('idle');
  let deleteTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelTimer: ReturnType<typeof setTimeout> | null = null;

  function commitDelete(): void {
    const removed = [...selectedLocalUids];
    deleteLocalEvents(removed);
    const next = new Set(selection.uids);
    for (const uid of removed) next.delete(uid);
    if (next.size === 0) clearSelection();
    else selection.uids = next;
  }
  function commitCancel(): void {
    focus.feedId = null;
    focus.eventIndex = -1;
    clearSelection();
  }

  function onDeleteTap(): void {
    if (!hasLocalSelection) return;
    if (deleteStage === 'done') { // undo during cooldown
      if (deleteTimer) clearTimeout(deleteTimer);
      deleteTimer = null;
      deleteStage = 'idle';
      return;
    }
    if (deleteStage === 'confirm') {
      if (deleteTimer) clearTimeout(deleteTimer);
      deleteStage = 'done';
      deleteTimer = setTimeout(() => {
        deleteTimer = null;
        deleteStage = 'idle';
        commitDelete();
      }, CONFIRM_WINDOW_MS);
      return;
    }
    deleteStage = 'confirm';
    if (deleteTimer) clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => { deleteTimer = null; deleteStage = 'idle'; }, CONFIRM_WINDOW_MS);
  }

  function onCancelTap(): void {
    if (cancelStage === 'done') {
      if (cancelTimer) clearTimeout(cancelTimer);
      cancelTimer = null;
      cancelStage = 'idle';
      return;
    }
    if (cancelStage === 'confirm') {
      if (cancelTimer) clearTimeout(cancelTimer);
      cancelStage = 'done';
      cancelTimer = setTimeout(() => {
        cancelTimer = null;
        cancelStage = 'idle';
        commitCancel();
      }, CONFIRM_WINDOW_MS);
      return;
    }
    cancelStage = 'confirm';
    if (cancelTimer) clearTimeout(cancelTimer);
    cancelTimer = setTimeout(() => { cancelTimer = null; cancelStage = 'idle'; }, CONFIRM_WINDOW_MS);
  }

  // Reset stages/timers whenever we leave selection mode.
  $effect(() => {
    if (!inSelectionMode) {
      if (deleteTimer) clearTimeout(deleteTimer);
      if (cancelTimer) clearTimeout(cancelTimer);
      if (moveTimer) clearTimeout(moveTimer);
      deleteTimer = cancelTimer = moveTimer = null;
      deleteStage = cancelStage = 'idle';
      moveStage = 'idle';
      moveUndo = null;
      moveMenuOpen = false;
    }
  });

  // --- MOVE / COPY submenu (action → ✓ with a cooldown-to-undo, like DELETE) ---
  let moveMenuOpen = $state(false);
  let moveRoot: HTMLDivElement | undefined = $state();
  let moveStage = $state<'idle' | 'done'>('idle');
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  type MoveUndo = { kind: 'move'; map: Map<string, string> } | { kind: 'copy'; uids: string[] };
  let moveUndo: MoveUndo | null = null;

  function pickLane(laneId: string): void {
    moveUndo = copyMode
      ? { kind: 'copy', uids: copyEventsToLane(selection.uids, laneId) }
      : { kind: 'move', map: moveEventsToLane(selection.uids, laneId) };
    moveMenuOpen = false;
    moveStage = 'done';
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { moveTimer = null; moveStage = 'idle'; moveUndo = null; }, CONFIRM_WINDOW_MS);
  }

  function onMoveTap(): void {
    if (moveStage === 'done') { // undo the move/copy during the cooldown
      if (moveTimer) clearTimeout(moveTimer);
      moveTimer = null;
      if (moveUndo?.kind === 'copy') {
        deleteLocalEvents(moveUndo.uids);
      } else if (moveUndo?.kind === 'move') {
        const byLane = new Map<string, string[]>();
        for (const [uid, srcFeedId] of moveUndo.map) {
          if (!byLane.has(srcFeedId)) byLane.set(srcFeedId, []);
          byLane.get(srcFeedId)!.push(uid);
        }
        for (const [srcFeedId, uids] of byLane) moveEventsToLane(uids, srcFeedId);
      }
      moveUndo = null;
      moveStage = 'idle';
      return;
    }
    moveMenuOpen = !moveMenuOpen;
  }
  $effect(() => {
    if (!moveMenuOpen) return;
    const onPointer = (e: PointerEvent): void => {
      if (moveRoot && !moveRoot.contains(e.target as Node)) moveMenuOpen = false;
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') moveMenuOpen = false; };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  });
  let fullyExpanded = $state(false);
  $effect(() => {
    if (!ui.statusExpanded || dragging) {
      fullyExpanded = false;
      return;
    }
    const t = setTimeout(() => { fullyExpanded = true; }, 150);
    return () => clearTimeout(t);
  });

  // Kiosk mode keeps the tray collapsed and inert.
  $effect(() => {
    if (isKiosk()) {
      height = closedHeight;
      ui.statusExpanded = false;
      clearSelection();
    }
  });

  function maxHeight(): number {
    if (typeof window === 'undefined') return 400;
    return Math.round(window.innerHeight * (MAX_HEIGHT_VH / 100));
  }

  function startDrag(e: PointerEvent): void {
    if (isKiosk()) return;
    dragging = true;
    pointerMoved = false;
    dragStartY = e.clientY;
    dragStartHeight = height;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDrag(e: PointerEvent): void {
    if (!dragging) return;
    const delta = dragStartY - e.clientY;
    if (Math.abs(delta) > 3) pointerMoved = true;
    const next = Math.min(maxHeight(), Math.max(closedHeight, dragStartHeight + delta));
    height = next;
  }

  function endDrag(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (!pointerMoved) {
      toggleExpand();
      return;
    }
    const startedExpanded = dragStartHeight > collapsedHeight + 2;
    const startedCollapsed = !startedExpanded;
    const draggedDown = e.clientY > dragStartY;
    const draggedUp = e.clientY < dragStartY - 10;
    if (startedCollapsed && draggedUp) {
      height = maxHeight();
      lastExpandedHeight = height;
      ui.statusExpanded = true;
      trayExpand();
      return;
    }
    if (startedCollapsed) {
      height = closedHeight;
      ui.statusExpanded = false;
      return;
    }
    if (startedExpanded && draggedDown) {
      height = closedHeight;
      ui.statusExpanded = false;
      trayCollapse();
    } else if (height < collapsedHeight * 1.5) {
      height = closedHeight;
      ui.statusExpanded = false;
      trayCollapse();
    } else {
      lastExpandedHeight = height;
      ui.statusExpanded = true;
    }
  }

  // Swipe-down anywhere on the tray body drags it shut exactly like the header:
  // once a downward gesture from scroll-top crosses a small threshold we promote
  // it to the same live drag (onDrag/endDrag) the handle uses. We only arm at the
  // top and only on downward motion, so scrolling the content and tapping event
  // rows still work (a tap never reaches dragging, so the row's click fires).
  function onTrayPointerDown(e: PointerEvent): void {
    trayArmed = false;
    if (isKiosk()) return;
    const scroller = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(
      '.tray-scroll, .raw-block',
    );
    if (scroller && scroller.scrollTop > 0) return;
    trayArmed = true;
    trayArmStartY = e.clientY;
    trayArmTarget = e.currentTarget as HTMLElement;
    trayArmPointerId = e.pointerId;
  }

  function onTrayPointerMove(e: PointerEvent): void {
    if (dragging) {
      onDrag(e);
      return;
    }
    if (!trayArmed) return;
    const dy = e.clientY - trayArmStartY;
    if (dy <= 4) {
      // Upward / negligible motion is a content scroll, not a dismiss — disarm.
      if (dy < -4) trayArmed = false;
      return;
    }
    // Clear downward swipe from the top: hand off to the same drag the header runs.
    trayArmed = false;
    dragging = true;
    pointerMoved = true;
    dragStartY = trayArmStartY;
    dragStartHeight = height;
    trayArmTarget?.setPointerCapture(trayArmPointerId);
    onDrag(e);
  }

  function onTrayPointerUp(e: PointerEvent): void {
    trayArmed = false;
    if (!dragging) return;
    endDrag(e);
  }

  function toggleExpand(): void {
    if (isKiosk()) return;
    if (expanded) {
      height = closedHeight;
      ui.statusExpanded = false;
      trayCollapse();
    } else {
      height = lastExpandedHeight > collapsedHeight + 2 ? lastExpandedHeight : maxHeight();
      ui.statusExpanded = true;
      trayExpand();
    }
  }

  // Base date: temp marker or today
  const baseDate = $derived(
    ui.tempMarkerMs != null ? startOfDay(new Date(ui.tempMarkerMs)) : today.value
  );
  const windowEnd = $derived(addMonths(baseDate, 1));

  // Next upcoming event for collapsed status (category 'none' feeds only)
  const nextEvent = $derived.by<DisplayEvent | null>(() => {
    const now = Date.now();
    let closest: DisplayEvent | null = null;
    const byFeed = getDisplayByFeed();
    for (const feed of config.feeds) {
      if (feed.hidden) continue;
      if (feed.category !== 'none') continue;
      if (feed.source.kind === 'scratchpad') continue; // never surface Draft events here
      for (const ev of (byFeed[feed.id] ?? [])) {
        if (ev.hidden) continue;
        if (ev.start.getTime() >= now) {
          if (!closest || ev.start < closest.start) closest = ev;
        }
      }
    }
    return closest;
  });

  const nextEventLabel = $derived.by<string | null>(() => {
    if (!nextEvent) return null;
    if (nextEvent.allDay) return nextEvent.displayTitle;
    const time = formatTime(nextEvent.start, config.timeFormat, config.timezone);
    return time + ' · ' + nextEvent.displayTitle;
  });

  // Helpers for event groups
  function getWeekStart(d: Date): Date {
    if (config.weekStart === 'sunday') {
      return addDays(startOfDay(d), -d.getUTCDay());
    }
    const dow = d.getUTCDay() || 7;
    return addDays(startOfDay(d), 1 - dow);
  }

  function formatWeekLabel(weekStart: Date): string {
    const weekEnd = addDays(weekStart, 6);
    const wn = isoWeekNumber(addDays(weekStart, config.weekStart === 'sunday' ? 4 : 3));
    const sd = weekStart.getUTCDate();
    const ed = weekEnd.getUTCDate();
    const sy = weekStart.getUTCFullYear();
    const ey = weekEnd.getUTCFullYear();
    const sm = formatMonth(weekStart, config.locale, 'short');
    const em = formatMonth(weekEnd, config.locale, 'short');
    let range: string;
    if (weekStart.getUTCMonth() === weekEnd.getUTCMonth()) {
      range = `${sm} ${sd}–${ed}, ${sy}`;
    } else if (sy === ey) {
      range = `${sm} ${sd}–${em} ${ed}, ${sy}`;
    } else {
      range = `${sm} ${sd} ${sy}–${em} ${ed} ${ey}`;
    }
    return `${range} (W${wn})`;
  }

  type EventWithFeed = { event: DisplayEvent; feedId: string; feedName: string; inferredCity: string | null };

  function cityFromTz(feedId: string): string | null {
    const tz = effectiveFeedTz(feedId);
    if (!tz || tz === 'local' || tz === 'UTC') return null;
    return tz.split('/').pop()?.replace(/_/g, ' ') ?? null;
  }

  const CATEGORY_ORDER: FeedCategory[] = ['none', 'events', 'holidays', 'observances', 'announcements', 'guests'];
  const CATEGORY_LABELS: Record<FeedCategory, string> = {
    none: 'Auto',
    events: 'Events',
    holidays: 'Holidays',
    observances: 'Observances',
    announcements: 'Announcements',
    guests: 'Guests',
  };

  type CategoryGroup = { category: FeedCategory; label: string; items: EventWithFeed[] };
  type WeekGroup = { label: string; categories: CategoryGroup[] };

  function groupByCategory(items: EventWithFeed[]): CategoryGroup[] {
    const map = new Map<FeedCategory, EventWithFeed[]>();
    for (const ef of items) {
      const feedCat = config.feeds.find(f => f.id === ef.feedId)?.category ?? 'none';
      // One bucket per event: explicit event.category trumps rule-derived
      // ruleCategory, which trumps the feed's category.
      const cat: FeedCategory = ef.event.category ?? ef.event.ruleCategory ?? feedCat;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(ef);
    }
    return CATEGORY_ORDER
      .filter(c => map.has(c) && config.trayFilter.categories.includes(c))
      .map(c => ({ category: c, label: CATEGORY_LABELS[c], items: map.get(c)! }));
  }

  // Event groups — only computed when tray is open
  const eventGroups = $derived.by<{
    todayLabel: string;
    todayCategories: CategoryGroup[];
    weeks: WeekGroup[];
  } | null>(() => {
    if (!expanded) return null;

    const base = baseDate;
    const todayEnd = addDays(base, 1);
    const windowEnd = addMonths(base, 1);
    const byFeed = getDisplayByFeed();
    const inSelection = selection.mode && selection.uids.size > 0;

    const todayItems: EventWithFeed[] = [];
    const futureItems: EventWithFeed[] = [];

    for (const feed of config.feeds) {
      if (feed.hidden) continue;
      const feedTravel: Travel = feed.travel ?? 'none';
      if (!config.trayFilter.travel.includes(feedTravel)) continue;
      for (const ev of (byFeed[feed.id] ?? [])) {
        if (ev.hidden) continue;
        if (hiddenLocations.size > 0 && ev.displayLocation && hiddenLocations.has(ev.displayLocation)) continue;
        const ef: EventWithFeed = { event: ev, feedId: feed.id, feedName: feed.name, inferredCity: cityFromTz(feed.id) };
        if (inSelection) {
          // Group all selected events by week + type, like the normal tray.
          if (selection.uids.has(ev.uid)) futureItems.push(ef);
          continue;
        }
        if (ev.start < todayEnd && ev.end > base) {
          todayItems.push(ef);
        } else if (ev.start >= todayEnd && ev.start < windowEnd) {
          futureItems.push(ef);
        }
      }
    }

    todayItems.sort((a, b) => {
      if (a.event.allDay && !b.event.allDay) return -1;
      if (!a.event.allDay && b.event.allDay) return 1;
      return a.event.start.getTime() - b.event.start.getTime();
    });
    futureItems.sort((a, b) => a.event.start.getTime() - b.event.start.getTime());

    const weekMap = new Map<string, EventWithFeed[]>();
    const weekStartList: Date[] = [];
    for (const ef of futureItems) {
      const ws = getWeekStart(ef.event.start);
      const key = ws.toISOString();
      if (!weekMap.has(key)) {
        weekMap.set(key, []);
        weekStartList.push(ws);
      }
      weekMap.get(key)!.push(ef);
    }

    const weeks: WeekGroup[] = weekStartList
      .map(ws => ({
        label: formatWeekLabel(ws),
        categories: groupByCategory(weekMap.get(ws.toISOString())!),
      }))
      // Hide weeks with no visible events (all filtered out).
      .filter(w => w.categories.length > 0);

    const todayLabel = ui.tempMarkerMs != null
      ? `${formatDateLong(base, config.locale)} (W${isoWeekNumber(base)})`
      : `Today (W${isoWeekNumber(base)})`;

    return { todayLabel, todayCategories: groupByCategory(todayItems), weeks };
  });

  function eventTimeLabel(ev: DisplayEvent): string {
    if (!ev.allDay) {
      return formatTime(ev.start, config.timeFormat, config.timezone)
        + '—'
        + formatTime(ev.end, config.timeFormat, config.timezone);
    }
    const days = durationDays(ev.start, ev.end);
    const last = new Date(ev.end.getTime() - 1);
    const sd = ev.start.getUTCDate();
    const ed = last.getUTCDate();
    const sm = formatMonth(ev.start, config.locale, 'short');
    const em = formatMonth(last, config.locale, 'short');
    if (days === 1) return `${sd} ${sm}`;
    if (ev.start.getUTCMonth() === last.getUTCMonth()) return `${sd}—${ed} ${sm}`;
    return `${sd} ${sm}—${ed} ${em}`;
  }

  function openEvent(ef: EventWithFeed): void {
    ui.modalEvent = ef.event;
    window.dispatchEvent(new CustomEvent('cal:scroll-to-date', { detail: { date: ef.event.start } }));
  }

  // Window counts — computed from all events in the window, no filters applied
  const windowCounts = $derived.by<{
    categories: Map<FeedCategory, number>;
    locations: Array<{ loc: string; count: number }>;
    travel: { none: number; local: number; international: number };
  } | null>(() => {
    if (!expanded) return null;
    const base = baseDate;
    const todayEnd = addDays(base, 1);
    const windowEnd = addMonths(base, 1);
    const byFeed = getDisplayByFeed();
    const catCounts = new Map<FeedCategory, number>();
    const locCounts = new Map<string, number>();
    let noneCount = 0;
    let localCount = 0;
    let intlCount = 0;
    for (const feed of config.feeds) {
      if (feed.hidden) continue;
      const feedTravel: Travel = feed.travel ?? 'none';
      const feedCat = feed.category ?? 'none';
      for (const ev of (byFeed[feed.id] ?? [])) {
        if (ev.hidden) continue;
        const inWindow =
          (ev.start < todayEnd && ev.end > base) ||
          (ev.start >= todayEnd && ev.start < windowEnd);
        if (!inWindow) continue;
        const cat: FeedCategory = ev.category ?? ev.ruleCategory ?? feedCat;
        catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
        if (ev.displayLocation) {
          locCounts.set(ev.displayLocation, (locCounts.get(ev.displayLocation) ?? 0) + 1);
        }
        if (feedTravel === 'none') noneCount++;
        else if (feedTravel === 'local') localCount++;
        else if (feedTravel === 'international') intlCount++;
      }
    }
    const locations = [...locCounts.entries()]
      .map(([loc, count]) => ({ loc, count }))
      .sort((a, b) => b.count - a.count);
    return { categories: catCounts, locations, travel: { none: noneCount, local: localCount, international: intlCount } };
  });

  // Total in-window events (each event has one category and one travel, so the
  // category sum equals the travel sum) — shown on the "All" (Types/Travel) tags.
  const windowTotal = $derived.by(() => {
    if (!windowCounts) return 0;
    let n = 0;
    for (const v of windowCounts.categories.values()) n += v;
    return n;
  });

  // Filter panel
  let filterOpen = $state(false);
  let hiddenLocations = $state(new Set<string>());

  const isFilterActive = $derived(
    config.trayFilter.categories.length < 6 ||
    config.trayFilter.travel.length < 3 ||
    hiddenLocations.size > 0,
  );

  $effect(() => { if (!expanded) filterOpen = false; });

  const visibleEventCount = $derived.by<number>(() => {
    if (!eventGroups) return 0;
    let n = 0;
    for (const c of eventGroups.todayCategories) n += c.items.length;
    for (const w of eventGroups.weeks) for (const c of w.categories) n += c.items.length;
    return n;
  });

  const totalEventCount = $derived.by<number>(() => {
    if (!windowCounts) return 0;
    let total = 0;
    for (const count of windowCounts.categories.values()) total += count;
    return total;
  });

  function toggleCategory(cat: FeedCategory): void {
    const cats = config.trayFilter.categories;
    config.trayFilter = {
      ...config.trayFilter,
      categories: cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat],
    };
  }

  function toggleTravel(t: Travel): void {
    const travel = config.trayFilter.travel;
    config.trayFilter = {
      ...config.trayFilter,
      travel: travel.includes(t) ? travel.filter(x => x !== t) : [...travel, t],
    };
  }

  function clearCategoryFilter(): void {
    config.trayFilter = {
      ...config.trayFilter,
      categories: ['none', 'events', 'holidays', 'observances', 'announcements', 'guests'],
    };
  }

  function clearTravelFilter(): void {
    config.trayFilter = { ...config.trayFilter, travel: ['none', 'local', 'international'] };
  }

  function toggleLocation(loc: string): void {
    const next = new Set(hiddenLocations);
    if (next.has(loc)) next.delete(loc); else next.add(loc);
    hiddenLocations = next;
  }

  function clearLocationFilter(): void {
    hiddenLocations = new Set();
  }

  // Raw mode toggle
  let rawMode = $state(false);
  let copyDone = $state(false);

  function gatherTrayEvents(): ParsedEvent[] {
    if (!eventGroups) return [];
    const out: ParsedEvent[] = [];
    for (const cat of eventGroups.todayCategories) for (const ef of cat.items) out.push(ef.event);
    for (const week of eventGroups.weeks) for (const cat of week.categories) for (const ef of cat.items) out.push(ef.event);
    return out;
  }

  const trayEvents = $derived(gatherTrayEvents());

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (): void => toggleExpand();
    window.addEventListener('cal:toggle-status', handler);
    return () => window.removeEventListener('cal:toggle-status', handler);
  });

  // Raw export columns shared by the table display and the TSV copy.
  const RAW_COLUMNS = ['Start Date', 'End Date', 'Start Time', 'End Time', 'Title', 'Location', 'Category'];
  // Structured rows — drives both the raw-mode table and the TSV text below.
  const rawRows = $derived.by<string[][]>(() => {
    if (!eventGroups) return [];
    const out: string[][] = [];
    function addItems(items: EventWithFeed[], categoryLabel: string): void {
      for (const ef of items) {
        const ev = ef.event;
        const startDate = formatDate(ev.start, config.dateFormat, config.locale);
        const endRaw = ev.allDay ? new Date(ev.end.getTime() - 1) : ev.end;
        const endDate = formatDate(endRaw, config.dateFormat, config.locale);
        const startTime = ev.allDay ? '' : formatTime(ev.start, config.timeFormat, config.timezone);
        const endTime = ev.allDay ? '' : formatTime(ev.end, config.timeFormat, config.timezone);
        const location = ev.displayLocation || ef.inferredCity || '';
        out.push([startDate, endDate, startTime, endTime, ev.displayTitle, location, categoryLabel]);
      }
    }
    for (const cat of eventGroups.todayCategories) addItems(cat.items, cat.label);
    for (const week of eventGroups.weeks)
      for (const cat of week.categories) addItems(cat.items, cat.label);
    return out;
  });

  // TSV text — derived so it updates reactively and can be copied.
  const tsvText = $derived(
    [RAW_COLUMNS.join('\t'), ...rawRows.map((r) => r.join('\t'))].join('\n'),
  );

  async function copyContent(): Promise<void> {
    try {
      if (rawMode) {
        await navigator.clipboard.writeText(tsvText);
        pushLog('Copied events list');
      } else {
        if (!eventGroups) return;
        const groups = eventGroups;
        const lines: string[] = [];
        function esc(s: string): string {
          return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        function addSection(label: string, cats: typeof groups.todayCategories): void {
          lines.push(`<b>${esc(label)}</b>`);
          for (const cat of cats) {
            lines.push(`<i>${esc(cat.label)}</i>`);
            lines.push('<ul>');
            for (const ef of cat.items) {
              const time = esc(eventTimeLabel(ef.event));
              const title = esc(ef.event.displayTitle);
              const loc = ef.event.displayLocation || ef.inferredCity || '';
              const locPart = loc ? ` · ${esc(loc)}` : '';
              lines.push(`<li>${time} · ${title}${locPart}</li>`);
            }
            lines.push('</ul>');
          }
        }
        if (groups.todayCategories.length > 0) addSection(groups.todayLabel, groups.todayCategories);
        for (const week of groups.weeks) addSection(week.label, week.categories);
        const html = lines.join('\n');
        if (typeof ClipboardItem !== 'undefined') {
          const blob = new Blob([html], { type: 'text/html' });
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]);
        } else {
          await navigator.clipboard.writeText(html);
        }
        pushLog('Copied events as HTML');
      }
      copyDone = true;
      setTimeout(() => { copyDone = false; }, 2000);
    } catch {
      pushLog('Copy failed', 'error');
    }
  }
</script>

<aside class="status-bar" style="height: {height}px;" data-expanded={expanded ? 'true' : null}>
  {#if inSelectionMode}
    <div
      class="handle selection-head"
      role="presentation"
      bind:clientHeight={collapsedHeight}
      onpointerdown={startDrag}
      onpointermove={onDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
    >
      <button
        type="button"
        class="sel-btn sel-delete"
        class:confirming={deleteStage === 'confirm'}
        class:done={deleteStage === 'done'}
        disabled={!hasLocalSelection}
        title={deleteStage === 'done' ? 'Tap to undo' : 'Delete selected'}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={onDeleteTap}
      >DELETE<span class="sel-mark">{deleteStage === 'done' ? '✓' : deleteStage === 'confirm' ? '?' : ''}</span></button>
      <div class="move-menu" bind:this={moveRoot}>
        <button
          type="button"
          class="sel-btn sel-move"
          class:done={moveStage === 'done'}
          aria-haspopup="menu"
          aria-expanded={moveMenuOpen}
          title={moveStage === 'done' ? 'Tap to undo' : copyMode ? 'Copy selected to lane' : 'Move selected to lane'}
          onpointerdown={(e) => e.stopPropagation()}
          onclick={onMoveTap}
        >{copyMode ? 'COPY' : 'MOVE'}<span class="sel-mark">{moveStage === 'done' ? '✓' : ''}</span></button>
        {#if moveMenuOpen}
          <div class="move-menu-list" role="menu">
            {#each localLanes as lane (lane.id)}
              <button
                type="button"
                role="menuitem"
                class="move-menu-item"
                onpointerdown={(e) => e.stopPropagation()}
                onclick={() => pickLane(lane.id)}
              >{lane.name}</button>
            {/each}
          </div>
        {/if}
      </div>
      <span class="sel-count">{mixedSelection ? `${selectedLocalUids.length} / ${selTotal}` : selTotal}</span>
      <button
        type="button"
        class="sel-btn sel-cancel"
        class:confirming={cancelStage === 'confirm'}
        class:done={cancelStage === 'done'}
        title={cancelStage === 'done' ? 'Tap to undo' : 'Cancel selection'}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={onCancelTap}
      >CANCEL<span class="sel-mark">{cancelStage === 'done' ? '✓' : cancelStage === 'confirm' ? '?' : ''}</span></button>
    </div>
  {:else}
    <button
      type="button"
      class="handle"
      aria-label={expanded ? 'Collapse events' : 'Expand events'}
      aria-expanded={expanded}
      bind:clientHeight={collapsedHeight}
      onpointerdown={startDrag}
      onpointermove={onDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
    >
      <span
        class="status-chip"
        data-online={online.value ? 'true' : null}
        title={online.value ? 'Online' : 'Offline'}
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="status-text">{showVersion ? `v${__APP_VERSION__}` : (online.value ? 'ONLINE' : 'OFFLINE')}</span>
      </span>
      {#if !isKiosk()}
        <span class="toggle" aria-hidden="true">
          <Icon name={expanded ? 'arrow-down' : 'arrow-up'} size={14} />
        </span>
      {:else}
        <span aria-hidden="true"></span>
      {/if}
      <span class="status-line">
        {#if nextEventLabel && !expanded}
          <span class="next-event">{nextEventLabel}</span>
        {/if}
        {#if swStatus.offlineReady}
          <span class="offline-ready">Offline ready</span>
        {/if}
      </span>
    </button>
  {/if}

  {#if (expanded || inSelectionMode) && eventGroups}
    <div
      class="events-tray"
      role="region"
      aria-label="Upcoming events"
      inert={!fullyExpanded}
      onpointerdown={onTrayPointerDown}
      onpointermove={onTrayPointerMove}
      onpointerup={onTrayPointerUp}
      onpointercancel={onTrayPointerUp}
    >
      {#if rawMode}
        <div class="raw-block">
          <table class="raw-table">
            <thead>
              <tr>{#each RAW_COLUMNS as col (col)}<th>{col}</th>{/each}</tr>
            </thead>
            <tbody>
              {#each rawRows as row, i (i)}
                <tr>{#each row as cell, c (c)}<td>{cell}</td>{/each}</tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="tray-scroll">
          {#if eventGroups.todayCategories.length === 0 && eventGroups.weeks.length === 0}
            <p class="empty">No events from {formatDate(baseDate, config.dateFormat, config.locale)} to {formatDate(windowEnd, config.dateFormat, config.locale)}.</p>
          {:else}
            {#if eventGroups.todayCategories.length > 0}
              <div class="week-group">
                <h2 class="week-label">{eventGroups.todayLabel}</h2>
                {#each eventGroups.todayCategories as catGroup (catGroup.category)}
                  <div class="cat-group">
                    {#if catGroup.category !== 'none'}
                      <h3 class="cat-label">{catGroup.label}</h3>
                    {/if}
                    <div class="event-list">
                      {#each catGroup.items as ef (ef.event.uid)}
                        <button type="button" class="event-row" onclick={() => openEvent(ef)}>
                          <span class="event-time">{eventTimeLabel(ef.event)}</span>
                          <span class="event-title">{ef.event.displayTitle}</span>
                          {#if ef.event.displayLocation || ef.inferredCity}
                            <span class="event-loc">{ef.event.displayLocation || ef.inferredCity}</span>
                          {/if}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            {#each eventGroups.weeks as week}
              <div class="week-group">
                <h2 class="week-label">{week.label}</h2>
                {#each week.categories as catGroup (catGroup.category)}
                  <div class="cat-group">
                    {#if catGroup.category !== 'none'}
                      <h3 class="cat-label">{catGroup.label}</h3>
                    {/if}
                    <div class="event-list">
                      {#each catGroup.items as ef (ef.event.uid)}
                        <button type="button" class="event-row" onclick={() => openEvent(ef)}>
                          <span class="event-time">{eventTimeLabel(ef.event)}</span>
                          <span class="event-title">{ef.event.displayTitle}</span>
                          {#if ef.event.displayLocation || ef.inferredCity}
                            <span class="event-loc">{ef.event.displayLocation || ef.inferredCity}</span>
                          {/if}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
      {#if filterOpen}
        <div class="filter-panel">
          <div class="filter-row">
            <button
              type="button"
              class="filter-clear"
              data-active={config.trayFilter.categories.length < 6 ? 'true' : null}
              onclick={clearCategoryFilter}
              title="Show all types"
            >Types ({windowTotal})</button>
            {#each CATEGORY_ORDER as cat}
              {@const catCount = windowCounts?.categories.get(cat) ?? 0}
              <button
                type="button"
                class="filter-chip"
                aria-pressed={config.trayFilter.categories.includes(cat)}
                onclick={() => toggleCategory(cat)}
              >{CATEGORY_LABELS[cat]}{catCount > 0 ? ` (${catCount})` : ''}</button>
            {/each}
          </div>
          <div class="filter-row">
            <button
              type="button"
              class="filter-clear"
              data-active={config.trayFilter.travel.length < 3 ? 'true' : null}
              onclick={clearTravelFilter}
              title="Show all travel types"
            >Travel ({windowTotal})</button>
            {#each (['none', 'local', 'international'] as const) as t}
              {@const travelCount = windowCounts?.travel[t] ?? 0}
              <button
                type="button"
                class="filter-chip"
                aria-pressed={config.trayFilter.travel.includes(t)}
                onclick={() => toggleTravel(t)}
              >{t === 'none' ? 'N/A' : t === 'local' ? 'Local' : 'International'}{travelCount > 0 ? ` (${travelCount})` : ''}</button>
            {/each}
          </div>
          {#if windowCounts && windowCounts.locations.length > 0}
            <div class="filter-row">
              <button
                type="button"
                class="filter-clear"
                data-active={hiddenLocations.size > 0 ? 'true' : null}
                onclick={clearLocationFilter}
                title="Show all locations"
              >Location</button>
              {#each windowCounts.locations as { loc, count } (loc)}
                <button
                  type="button"
                  class="filter-chip"
                  aria-pressed={!hiddenLocations.has(loc)}
                  onclick={() => toggleLocation(loc)}
                >{loc} ({count})</button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      <div class="copy-bar">
        <button
          type="button"
          class="copy-btn"
          aria-pressed={filterOpen}
          data-filter-active={isFilterActive && !filterOpen ? 'true' : null}
          onclick={() => (filterOpen = !filterOpen)}
          title="Filter visible categories and travel"
        >Filter</button>
        <span class="event-counter" data-mono>{visibleEventCount} / {totalEventCount}</span>
        <span class="copy-spacer"></span>
        <CalendarDownloadMenu events={trayEvents} disabled={isKiosk()} />
        <button
          type="button"
          class="copy-btn"
          data-toggle="true"
          aria-pressed={rawMode}
          onclick={() => (rawMode = !rawMode)}
          title="Toggle raw TSV view"
        >{'{ }'}</button>
        <button
          type="button"
          class="copy-btn"
          onclick={() => void copyContent()}
          title={rawMode ? 'Copy as tab-separated list' : 'Copy as rich text'}
        >{copyDone ? 'Copy ✓' : 'Copy'}</button>
      </div>
    </div>
  {/if}
</aside>

<style>
  .status-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    border-top: 2px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    user-select: none;
    -webkit-user-select: none;
    transition: height 120ms ease-out;
  }
  .status-bar[data-expanded='true'] .handle {
    border-bottom: 1px dashed var(--ink);
  }
  .status-bar[data-expanded='true'] {
    transition: none;
  }
  .handle {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.6em;
    /* Fixed height keeps the header one size in normal and multi-select mode
       (the 28px buttons fit exactly). collapsedHeight is measured from this. */
    height: 28px;
    flex-shrink: 0;
    padding: 0 0.6em;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    touch-action: none;
  }
  .status-line {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.6em;
    overflow: hidden;
    font-size: var(--fs-12);
    min-width: 0;
  }
  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    font-size: var(--fs-11);
    flex-shrink: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
  }
  .status-chip[data-online='true'] .dot {
    background: #22c55e;
  }
  .status-text {
    letter-spacing: 0.04em;
  }
  .next-event {
    font-size: var(--fs-11);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }
  /* Transient confirmation that the app shell is now cached for offline use.
     Fades in and out over its ~3s lifetime; the script unmounts it after. */
  .offline-ready {
    flex-shrink: 0;
    font-size: var(--fs-11);
    letter-spacing: 0.04em;
    white-space: nowrap;
    padding: 0 0.4em;
    border: 1px solid var(--ink);
    border-radius: 2px;
    animation: offline-ready-flash 3s ease-in-out both;
  }
  /* Honour the reduced-motion override (data-motion='reduced'): show it steady
     rather than fading, matching the rest of the app's motion handling. */
  :global([data-motion='reduced']) .offline-ready {
    animation: none;
  }
  @keyframes offline-ready-flash {
    0% { opacity: 0; }
    12% { opacity: 1; }
    82% { opacity: 1; }
    100% { opacity: 0; }
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    justify-self: center;
    color: var(--ink);
  }
  .selection-head {
    display: flex;
    align-items: center;
    gap: 0.4em;
    /* Taller than the normal 28px header so the 28px buttons get breathing room,
       matching the footer toolbar (.copy-bar) height. */
    height: auto;
    padding: 0.35em 0.6em;
    cursor: pointer;
    touch-action: none;
  }
  /* DELETE and MOVE sit at the start; CANCEL is pushed to the far right. */
  .sel-cancel {
    margin-left: auto;
  }
  .sel-count {
    font-size: var(--fs-12);
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .sel-btn {
    position: relative;
    height: 28px;
    /* Right padding leaves room for the floated ?/✓ so the button width stays
       constant across states; the label stays centered in the full width. */
    padding: 0 0.95em;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-12);
    letter-spacing: 0.04em;
    white-space: nowrap;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .sel-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    border-style: dashed;
  }
  /* The ?/✓ floats at the right edge rather than sitting in the centered label,
     so the word stays centered and the button width never changes. */
  .sel-mark {
    position: absolute;
    right: 0.2em;
    top: 0;
    bottom: 0;
    display: inline-flex;
    align-items: center;
  }
  /* Idle DELETE matches the settings delete button (accent border + text). */
  .sel-delete:not(.confirming):not(.done) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .sel-delete:not(.confirming):not(.done):not(:disabled):hover {
    background: color-mix(in srgb, var(--accent) 8%, var(--paper));
  }
  /* Two-stage confirm/done look (matches the modal/settings delete buttons). */
  .sel-btn.confirming,
  .sel-btn.done {
    background: var(--accent);
    color: var(--paper);
    border-color: var(--accent);
  }
  .sel-btn.done {
    background: var(--paper);
    color: var(--ink);
    border-color: var(--ink);
  }
  .move-menu {
    position: relative;
    display: inline-flex;
  }
  .move-menu-list {
    position: absolute;
    bottom: calc(100% + 4px);
    right: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 9em;
    max-height: 50vh;
    overflow: auto;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
  }
  .move-menu-item {
    text-align: left;
    padding: 0.4em 0.6em;
    border: none;
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-12);
    white-space: nowrap;
  }
  .move-menu-item + .move-menu-item {
    border-top: 1px dashed var(--ink);
  }
  .move-menu-item:hover {
    background: var(--ink);
    color: var(--paper);
  }

  /* Tray */
  .events-tray {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .filter-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3em;
    padding: 0.4em 0;
    border-top: 1px dashed var(--ink);
    background: var(--paper-2);
    user-select: none;
    -webkit-user-select: none;
  }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.25em;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: visible;
    scrollbar-width: none;
    max-width: 100%;
  }
  .filter-row::-webkit-scrollbar { display: none; }
  .filter-clear {
    font-size: var(--fs-12);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0 calc(0.5em - 2px);
    margin-left: 0.6em;
    border: 1px solid var(--ink-faint);
    border-radius: 0;
    background: var(--paper);
    color: var(--ink-muted);
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .filter-clear[data-active='true'] {
    border-color: var(--ink);
    color: var(--ink);
  }
  .filter-chip {
    font-size: var(--fs-12);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0 calc(0.5em - 2px);
    border: 1px dashed var(--ink);
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .filter-chip[aria-pressed='true'] {
    border-style: solid;
    border-color: var(--ink);
    background: var(--ink);
    color: var(--paper);
  }
  .copy-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.3em;
    padding: 0.35em 0.6em;
    border-top: 1px dashed var(--ink);
  }
  .copy-spacer {
    flex: 1 1 auto;
  }
  .copy-btn {
    height: 28px;
    padding: 0 12px;
    border: var(--btn-border-w) solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    cursor: pointer;
    font-size: var(--fs-12);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .copy-btn:hover:not([data-toggle]),
  .copy-btn[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
  .copy-btn[data-filter-active='true'] {
    border-style: dashed;
  }
  .copy-btn[data-toggle='true'] {
    padding: 0;
    width: 28px;
    min-width: 28px;
  }
  .event-counter {
    font-size: var(--fs-12);
    color: var(--ink);
    padding: 0 0.5em;
    white-space: nowrap;
  }
  .raw-block {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 0.6em 0.8em;
    user-select: text;
    -webkit-user-select: text;
  }
  .raw-table {
    border-collapse: collapse;
    font-family: var(--mono);
    font-size: var(--fs-11);
    line-height: 1.4;
    white-space: nowrap;
  }
  .raw-table th,
  .raw-table td {
    padding: 0.15em 0.6em 0.15em 0;
    text-align: left;
    vertical-align: top;
  }
  .raw-table th {
    font-weight: 600;
    border-bottom: 1px solid var(--ink-faint);
  }
  .tray-scroll {
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.4em 0.6em 0.5em;
    user-select: text;
    -webkit-user-select: text;
  }
  .week-group {
    margin-bottom: 0.8em;
  }
  h2.week-label {
    margin: 0 0 0.3em;
    padding-bottom: 0.2em;
    border-bottom: 1px solid var(--ink);
    font-size: var(--fs-12);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .cat-group {
    margin-bottom: 0.4em;
  }
  h3.cat-label {
    display: block;
    font-size: var(--fs-12);
    font-weight: normal;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin: 0.6em 0 0.15em;
  }
  .event-list {
    display: flex;
    flex-direction: column;
  }
  .event-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5em;
    align-items: baseline;
    width: 100%;
    font-size: var(--fs-12);
    padding: 1px 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .event-row:focus,
  .event-row:focus-visible {
    outline: none;
    text-decoration: underline;
  }
  .event-time {
    font-family: var(--mono);
    color: var(--ink-muted);
    font-size: var(--fs-12);
    white-space: nowrap;
  }
  .event-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .event-loc {
    font-size: var(--fs-12);
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    text-align: right;
  }
  .empty {
    margin: 0;
    color: var(--ink-muted);
    font-size: var(--fs-12);
  }
</style>
