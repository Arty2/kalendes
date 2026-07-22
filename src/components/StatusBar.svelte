<script lang="ts">
  import { config, getDisplayByFeed, pushLog, selection, clearSelection, moveEventsToLane, copyEventsToLane, deleteLocalEvents, focus, ui, effectiveFeedTz, isKiosk } from '../lib/state.svelte';
  import { online } from '../lib/online.svelte';
  import { today } from '../lib/today.svelte';
  import { clock } from '../lib/clock.svelte';
  import { startOfDay, addDays, addMonths, isoWeekNumber } from '../lib/time';
  import { formatDate, formatDateLong, formatMonth, formatTime, formatNextRelative, durationDays, zonedDateProxy } from '../lib/format';
  import { travelIcon } from '../lib/icons';
  import Icon from './Icon.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import CalendarDownloadMenu from './CalendarDownloadMenu.svelte';
  import { trayExpand, trayCollapse } from '../lib/haptics';
  import type { DisplayEvent, FeedCategory, ParsedEvent, Travel } from '../lib/types';
  import { untrack } from 'svelte';

  // The collapsed tray height tracks the header's rendered height — it now carries
  // vertical padding (to match the bottom toolbar) and scales with the font-size
  // setting, so a fixed value would let the header spill below the screen. Measured
  // from the live `.handle` via bind:clientHeight; 22 is the pre-measure fallback.
  let collapsedHeight = $state(22);
  const MAX_HEIGHT_VH = 60;
  let showVersion = $state(true);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const t = setTimeout(() => { showVersion = false; }, 3000);
    return () => clearTimeout(t);
  });

  let dragging = $state(false);
  let dragStartY = 0;
  let dragStartHeight = 0;
  // A pointer that ends within this many px of where it started is a tap, not a
  // drag — so a click (which can jitter a few px) reliably toggles the tray open
  // instead of being misread as a tiny drag and snapped shut.
  const TAP_SLOP_PX = 10;
  let height = $state(28);
  // 0 until a real expanded height is recorded (drag/expand), so the FIRST
  // header tap falls through to maxHeight() and fully opens (28 — the initial
  // seed — is just above the collapsed threshold, so it opened only a sliver).
  let lastExpandedHeight = 0;
  // Swipe-down-to-dismiss on the tray body (not the header). Armed on pointerdown
  // only when the inner scroll region is at the top; once the finger has moved a
  // small distance we lock its axis and either hand a downward pull to the same
  // live drag the header runs, or release a sideways/upward swipe to native
  // scrolling. Small enough that the drag feels immediate, like the header.
  const AXIS_LOCK_PX = 8;
  let trayArmed = false;
  let trayArmStartY = 0;
  let trayArmStartX = 0;
  let trayArmTarget: HTMLElement | null = null;
  let trayArmPointerId = 0;

  const expanded = $derived(height > collapsedHeight + 2);
  // Resting collapsed height: a touch taller than the header so the bar sits
  // comfortably at the screen bottom without clipping its content.
  const closedHeight = $derived(collapsedHeight + 2);

  // Desktop vs mobile (no central store — re-declare matchMedia with the shared
  // breakpoints, mirroring App.svelte's spacing effect). Desktop = neither the
  // portrait-phone nor the landscape-phone query matches.
  let isDesktop = $state(false);
  $effect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mqP = matchMedia('(orientation: portrait) and (max-width: 640px)');
    const mqL = matchMedia('(orientation: landscape) and (max-width: 900px)');
    const apply = (): void => { isDesktop = !mqP.matches && !mqL.matches; };
    apply();
    mqP.addEventListener('change', apply);
    mqL.addEventListener('change', apply);
    return () => {
      mqP.removeEventListener('change', apply);
      mqL.removeEventListener('change', apply);
    };
  });
  // 'auto' follows the device (left on desktop, bottom on mobile); 'left'/'bottom'
  // force a side. When left mode is on the tray becomes a side panel that slides
  // in beside the timeline instead of growing up over it.
  const leftMode = $derived(
    config.traySide === 'left' ? true : config.traySide === 'bottom' ? false : isDesktop,
  );
  // The one "is the tray open" flag. In bottom mode it tracks the dragged height;
  // in left mode the height never grows, so it tracks the explicit expand flag.
  const trayOpen = $derived(leftMode ? ui.statusExpanded : expanded);
  // One arrow glyph, rotated to point the way the tray edge travels on click:
  // bottom up/down (0/180), left right/left (90/270).
  const toggleDeg = $derived(leftMode ? (trayOpen ? 270 : 90) : (trayOpen ? 180 : 0));

  // Keep the collapsed bar at the resting height whenever it isn't expanded
  // (covers the initial measure, font-size changes, and the header shrinking
  // back when selection mode exits). In left mode the bar never grows, so it
  // stays pinned to the resting height regardless of the expand flag.
  $effect(() => {
    if (leftMode || !ui.statusExpanded) height = closedHeight;
  });
  const inSelectionMode = $derived(selection.mode && selection.uids.size > 0);
  // The side panel is present (mounted) whenever the tray would show content.
  const sidePanelShown = $derived(trayOpen || inSelectionMode);
  // Push the timeline right by the panel width only while the left panel is open.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (leftMode && sidePanelShown) root.style.setProperty('--tray-left-w', 'var(--tray-side-w)');
    else root.style.setProperty('--tray-left-w', '0px');
    return () => root.style.setProperty('--tray-left-w', '0px');
  });
  // Publish the resting bottom-bar height so fixed-height views (the 1W grid)
  // reserve exactly the space the fixed bar occupies. Tying the reservation to
  // the same measured number that sizes the bar keeps the two from drifting into
  // a paper sliver (or an overlap) at the grid's bottom edge — the bar is always
  // this tall at the bottom, in both bottom and left-panel modes.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--tray-bottom-h', `${closedHeight}px`);
    return () => root.style.removeProperty('--tray-bottom-h');
  });

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

  // --- DELETE / CANCEL use the shared ConfirmButton (tap → ? → ✓ → UNDO n). ---
  // MOVE/COPY mirror its post-confirm timing: ✓ holds for MOVE_DONE_HOLD_MS,
  // then a live "UNDO n" countdown ticks down before the action settles.
  const MOVE_DONE_HOLD_MS = 1000; // ✓ visible before the undo countdown opens
  const MOVE_UNDO_SECONDS = 3; // "UNDO 3 → 2 → 1" countdown before settling

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

  // Reset MOVE state whenever we leave selection mode (the DELETE/CANCEL
  // ConfirmButtons unmount with the toolbar, so they self-reset).
  $effect(() => {
    if (!inSelectionMode) {
      clearMoveTimers();
      moveStage = 'idle';
      moveUndo = null;
      moveMenuOpen = false;
    }
  });

  // --- MOVE / COPY submenu (lane pick → ✓ with a cooldown-to-undo "UNDO n"). ---
  let moveMenuOpen = $state(false);
  let moveRoot: HTMLDivElement | undefined = $state();
  let moveStage = $state<'idle' | 'done' | 'undo'>('idle');
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  let moveInterval: ReturnType<typeof setInterval> | null = null;
  let moveCount = $state(0); // seconds left in the undo countdown
  type MoveUndo = { kind: 'move'; map: Map<string, string> } | { kind: 'copy'; uids: string[] };
  let moveUndo: MoveUndo | null = null;

  function clearMoveTimers(): void {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = null;
    if (moveInterval) clearInterval(moveInterval);
    moveInterval = null;
  }

  function pickLane(laneId: string): void {
    // The move/copy is applied immediately (so it's visible), then we run the
    // ConfirmButton-style sequence: ✓ holds, then a live "UNDO n" countdown.
    moveUndo = copyMode
      ? { kind: 'copy', uids: copyEventsToLane(selection.uids, laneId) }
      : { kind: 'move', map: moveEventsToLane(selection.uids, laneId) };
    moveMenuOpen = false;
    moveStage = 'done';
    clearMoveTimers();
    moveTimer = setTimeout(() => {
      moveTimer = null;
      moveStage = 'undo';
      moveCount = MOVE_UNDO_SECONDS;
      moveInterval = setInterval(() => {
        moveCount -= 1;
        if (moveCount <= 0) {
          clearMoveTimers();
          moveStage = 'idle';
          moveUndo = null;
        }
      }, 1000);
    }, MOVE_DONE_HOLD_MS);
  }

  function onMoveTap(): void {
    if (moveStage === 'done' || moveStage === 'undo') {
      // A tap anytime in the post-pick window reverses the move/copy.
      clearMoveTimers();
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
    // Left mode is a plain click toggle (see the .handle onclick), never a
    // vertical height drag — bail before capturing the pointer.
    if (isKiosk() || leftMode) return;
    dragging = true;
    dragStartY = e.clientY;
    dragStartHeight = height;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDrag(e: PointerEvent): void {
    if (!dragging) return;
    const delta = dragStartY - e.clientY;
    const next = Math.min(maxHeight(), Math.max(closedHeight, dragStartHeight + delta));
    height = next;
  }

  function endDrag(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const netDelta = e.clientY - dragStartY;
    // Released within the tap slop of the press → a tap, always toggle. Only a
    // clear drag past the slop resolves by direction below.
    if (Math.abs(netDelta) < TAP_SLOP_PX) {
      toggleExpand();
      return;
    }
    const startedExpanded = dragStartHeight > collapsedHeight + 2;
    const startedCollapsed = !startedExpanded;
    const draggedDown = netDelta > 0;
    const draggedUp = netDelta < 0;
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

  // Swipe-down anywhere on the tray body drags it shut exactly like the header.
  // We arm only when the inner scroller is at the top; onTrayPointerMove then
  // locks the gesture's axis after a few px and hands a downward pull to the
  // same live drag (onDrag/endDrag) the handle uses, while letting sideways and
  // upward swipes scroll natively. A tap never reaches dragging, so row clicks
  // still fire.
  function onTrayPointerDown(e: PointerEvent): void {
    trayArmed = false;
    // No swipe-down-to-dismiss on the side panel — it isn't anchored to the bottom.
    if (isKiosk() || leftMode) return;
    const scroller = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(
      '.tray-scroll, .raw-block',
    );
    if (scroller && scroller.scrollTop > 0) return;
    trayArmed = true;
    trayArmStartY = e.clientY;
    trayArmStartX = e.clientX;
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
    const dx = Math.abs(e.clientX - trayArmStartX);
    // Wait until the gesture has travelled enough to read its direction.
    if (Math.max(dx, Math.abs(dy)) < AXIS_LOCK_PX) return;
    // Upward or sideways-dominant motion is a scroll (vertical content scroll,
    // or the horizontal raw table / filter chips) — release it to the browser.
    if (dy <= dx) {
      trayArmed = false;
      return;
    }
    // Downward, vertical-dominant: hand off to the same live drag the header
    // runs, mapped from the touch origin so the tray follows the finger 1:1 and
    // endDrag snaps it open/closed (the retry).
    trayArmed = false;
    dragging = true;
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
    // Left mode: the bar stays collapsed; only the side panel opens/closes.
    if (leftMode) {
      ui.statusExpanded = !ui.statusExpanded;
      if (ui.statusExpanded) trayExpand(); else trayCollapse();
      return;
    }
    // Decide from the real open state, not the live `height` — a tap can nudge
    // `height` a few px past the collapsed threshold, which would otherwise make
    // `expanded` read true and toggle the wrong way (a click that never opens).
    if (ui.statusExpanded) {
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
    const now = clock.now;
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
    const rel = formatNextRelative(nextEvent.start, clock.now);
    if (nextEvent.allDay) return rel + ' · ' + nextEvent.displayTitle;
    const time = formatTime(nextEvent.start, config.timeFormat, config.timezone);
    return rel + ' · ' + time + ' · ' + nextEvent.displayTitle;
  });

  // Marquee the next-event label when it's wider than the status bar: hold it
  // still for 2s (readable start), then scroll continuously. Two copies with a
  // fixed gap make the loop seamless — the shift is one copy plus that gap.
  const MARQUEE_GAP_PX = 48; // must match the .next-event-track gap in CSS
  const MARQUEE_SPEED_PX_S = 45;
  let nextEventEl = $state<HTMLElement>();
  let nextEventCopyEl = $state<HTMLElement>();
  let marquee = $state<{ on: boolean; shift: number; dur: number }>({ on: false, shift: 0, dur: 0 });

  $effect(() => {
    nextEventLabel; // re-measure when the text changes
    const container = nextEventEl;
    const copy = nextEventCopyEl;
    if (!container || !copy) return;
    const measure = (): void => {
      const on = copy.scrollWidth - container.clientWidth > 4;
      const shift = on ? copy.scrollWidth + MARQUEE_GAP_PX : 0;
      const cur = untrack(() => marquee);
      if (on !== cur.on || shift !== cur.shift) {
        marquee = { on, shift, dur: shift / MARQUEE_SPEED_PX_S };
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
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
    // Standard ISO week number, independent of the monday/sunday setting.
    const wn = isoWeekNumber(weekStart);
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
    // Only compute the (potentially large) grouping while the tray is actually
    // shown. `trayOpen` covers both bottom mode (dragged height) and left mode
    // (the explicit expand flag); selection mode always shows the tray too.
    if (!trayOpen && !inSelectionMode) return null;

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
      for (const ev of (byFeed[feed.id] ?? [])) {
        if (ev.hidden) continue;
        // A per-event travel tag (local-lane events) overrides the feed's.
        if (!config.trayFilter.travel.includes(ev.travel ?? feedTravel)) continue;
        if (hiddenLocations.size > 0 && ev.displayLocation && hiddenLocations.has(ev.displayLocation)) continue;
        const ef: EventWithFeed = { event: ev, feedId: feed.id, feedName: feed.name, inferredCity: cityFromTz(feed.id) };
        if (inSelection) {
          // Group all selected events by week + type, like the normal tray.
          if (selection.uids.has(ev.uid)) futureItems.push(ef);
          continue;
        }
        // An event happening right now belongs in Today even if its clock end
        // fell before the UTC day-start (the pre-dawn window) or it started
        // days ago (a combined/multi-day bar still running) — only when the
        // base really is today, not a temp-marker preview of another day.
        const ongoingNow =
          ui.tempMarkerMs == null &&
          ev.start.getTime() <= clock.now &&
          clock.now < ev.end.getTime();
        if ((ev.start < todayEnd && ev.end > base) || ongoingNow) {
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
        const travel: Travel = ev.travel ?? feedTravel;
        if (travel === 'none') noneCount++;
        else if (travel === 'local') localCount++;
        else if (travel === 'international') intlCount++;
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
        const startDate = formatDate(
          ev.allDay ? ev.start : zonedDateProxy(ev.start, config.timezone),
          config.dateFormat,
          config.locale,
        );
        const endRaw = ev.allDay
          ? new Date(ev.end.getTime() - 1)
          : zonedDateProxy(ev.end, config.timezone);
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
      <ConfirmButton
        label="DELETE"
        variant="delete"
        height={28}
        hpad="0.95em"
        disabled={!hasLocalSelection}
        idleTitle="Delete selected"
        doneTitle="Tap to undo"
        onCommit={commitDelete}
        onpointerdown={(e) => e.stopPropagation()}
      />
      <div class="move-menu" bind:this={moveRoot}>
        <button
          type="button"
          class="sel-btn sel-move"
          class:done={moveStage === 'done'}
          class:undo={moveStage === 'undo'}
          aria-haspopup="menu"
          aria-expanded={moveMenuOpen}
          title={moveStage !== 'idle' ? 'Tap to undo' : copyMode ? 'Copy selected to lane' : 'Move selected to lane'}
          onpointerdown={(e) => e.stopPropagation()}
          onclick={onMoveTap}
        ><span class="sel-stack"><span class="sel-sizer" aria-hidden="true">COPY&nbsp;<span class="sel-icon-box"></span></span><span class="sel-current">{moveStage === 'undo' ? 'UNDO' : copyMode ? 'COPY' : 'MOVE'}{#if moveStage === 'undo'}&nbsp;<span class="sel-count">{moveCount}</span>{:else if moveStage === 'done'}&nbsp;<Icon name="check" size={13} />{/if}</span></span></button>
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
      <span class="sel-cancel-wrap">
        <ConfirmButton
          label="CANCEL"
          variant="neutral"
          stages={2}
          height={28}
          hpad="0.95em"
          idleTitle="Cancel selection"
          confirmTitle="Tap again to cancel"
          onConfirm={commitCancel}
          onpointerdown={(e) => e.stopPropagation()}
        />
      </span>
    </div>
  {:else}
    <button
      type="button"
      class="handle"
      aria-label={trayOpen ? 'Collapse events' : 'Expand events'}
      aria-expanded={trayOpen}
      bind:clientHeight={collapsedHeight}
      onpointerdown={startDrag}
      onpointermove={onDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      onclick={leftMode ? toggleExpand : undefined}
    >
      <span class="status-line status-line-left">
        {#if nextEventLabel}
          <span class="next-event" bind:this={nextEventEl}>
            {#if marquee.on}
              <span
                class="next-event-track marquee"
                style="--marquee-shift: {marquee.shift}px; --marquee-dur: {marquee.dur}s;"
              >
                <span class="next-event-copy" bind:this={nextEventCopyEl}>{nextEventLabel}</span>
                <span class="next-event-copy" aria-hidden="true">{nextEventLabel}</span>
              </span>
            {:else}
              <span class="next-event-copy next-event-static" bind:this={nextEventCopyEl}>{nextEventLabel}</span>
            {/if}
          </span>
        {/if}
      </span>
      {#if !isKiosk()}
        <span class="toggle" aria-hidden="true" style="transform: rotate({toggleDeg}deg)">
          <Icon name="triangle-up" size={14} />
        </span>
      {:else}
        <span aria-hidden="true"></span>
      {/if}
      <span class="status-line status-line-right">
        <span
          class="status-chip"
          data-online={online.value ? 'true' : null}
          title={online.value ? 'Online' : 'Offline'}
        >
          <span class="dot" aria-hidden="true"></span>
          <span class="status-text">{showVersion ? `v${__APP_VERSION__}` : (online.value ? 'ONLINE' : 'OFFLINE')}</span>
        </span>
      </span>
    </button>
  {/if}

  {#if leftMode || (eventGroups && (trayOpen || inSelectionMode))}
    <!-- In left mode the panel stays mounted (empty when closed) so the slide-in
         is a pure CSS transform; the heavy content only renders while open. In
         bottom mode it mounts on open exactly as before. -->
    <div
      class="events-tray"
      class:side-left={leftMode}
      role="region"
      aria-label="Upcoming events"
      data-open={sidePanelShown ? 'true' : null}
      inert={leftMode ? !sidePanelShown : !fullyExpanded}
      style={leftMode ? `top: 0; bottom: ${closedHeight}px` : undefined}
      onpointerdown={onTrayPointerDown}
      onpointermove={onTrayPointerMove}
      onpointerup={onTrayPointerUp}
      onpointercancel={onTrayPointerUp}
    >
      {#if eventGroups}
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
                      {#each catGroup.items as ef (ef.feedId + ':' + ef.event.uid)}
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
                      {#each catGroup.items as ef (ef.feedId + ':' + ef.event.uid)}
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
              {@const chipIcon = travelIcon(t)}
              <button
                type="button"
                class="filter-chip"
                aria-pressed={config.trayFilter.travel.includes(t)}
                onclick={() => toggleTravel(t)}
              >{#if chipIcon}<Icon name={chipIcon} size={11} />{/if}{t === 'none' ? 'N/A' : t === 'local' ? 'Local' : 'International'}{travelCount > 0 ? ` (${travelCount})` : ''}</button>
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
        ><span class="flash-swap"><span class:flash-swap-off={copyDone}>Copy</span><span class:flash-swap-off={!copyDone}>Copy&nbsp;✓</span></span></button>
      </div>
      {/if}
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
    border-top: calc(var(--border-w) + 1px) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    user-select: none;
    -webkit-user-select: none;
    transition: height 120ms ease-out;
  }
  .status-bar[data-expanded='true'] .handle {
    border-bottom: var(--border-w) dashed var(--ink-color);
  }
  .status-bar[data-expanded='true'] {
    transition: none;
  }
  .handle {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--toolbar-gap);
    /* Height tracks the spacing setting; multi-select uses the taller
       .selection-head instead. collapsedHeight is measured from this. */
    height: var(--tray-header-h);
    flex-shrink: 0;
    padding: 0 var(--time-header-pad-x);
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
    gap: 0.6em;
    overflow: hidden;
    font-size: var(--fs-12);
    min-width: 0;
  }
  /* Next-event text sits on the left; the online pill on the right. The centre
     toggle stays centred via the grid's auto column. */
  .status-line-left {
    justify-content: flex-start;
  }
  .status-line-right {
    justify-content: flex-end;
    /* Relaxed breathing room to the right of the version / online chip so it
       doesn't sit flush against the edge (the base inset is only 2px). */
    padding-right: 0.75em;
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
    line-height: 1;
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;
  }
  /* Static (fits, or reduced motion): clip with an ellipsis as before. */
  .next-event-static {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Marquee: two copies + a gap scroll as one seamless loop. The initial 2s
     delay holds the start still before the first scroll; --marquee-shift (one
     copy + the gap) lands the second copy exactly where the first began. */
  .next-event-track {
    display: inline-flex;
    gap: 48px; /* = MARQUEE_GAP_PX; also the seamless-loop shift offset */
    white-space: nowrap;
    will-change: transform;
  }
  .next-event-track.marquee {
    animation: next-marquee var(--marquee-dur) linear 2s infinite;
  }
  .next-event-copy {
    white-space: nowrap;
  }
  @keyframes next-marquee {
    from { transform: translateX(0); }
    to { transform: translateX(calc(-1 * var(--marquee-shift))); }
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    justify-self: center;
    color: var(--ink-color);
    /* Rotated via inline style to point up/down/left/right; animate the turn
       (neutralized under reduced motion globally). */
    transition: transform 150ms ease;
  }
  .selection-head {
    display: flex;
    align-items: center;
    gap: var(--toolbar-gap);
    /* Height is driven by its 28px buttons + the shared spacing inset, so its
       gap/margin match the top toolbar. */
    height: auto;
    padding: var(--time-header-pad-x);
    cursor: pointer;
    touch-action: none;
  }
  /* DELETE and MOVE sit at the start; CANCEL is pushed to the far right. */
  .sel-cancel-wrap {
    margin-left: auto;
    display: inline-flex;
  }
  .sel-count {
    font-size: var(--fs-12);
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .sel-btn {
    height: 28px;
    padding: 0 0.95em;
    border: var(--btn-border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    font-size: var(--fs-12);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* MOVE/COPY: label + nbsp + icon, centered, with the icon slot reserved in
     every state so the button width stays constant (mirrors ConfirmButton). */
  .sel-stack {
    display: inline-grid;
  }
  .sel-stack > * {
    grid-area: 1 / 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .sel-sizer {
    visibility: hidden;
  }
  .sel-icon-box {
    display: inline-block;
    width: 13px;
    height: 13px;
  }
  /* The undo countdown takes the icon slot; its number ticks once a second so
     the closing window is visible without a (motion-gated) animation. */
  .sel-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
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
    border: var(--btn-border-w) solid var(--ink-color);
    background: var(--paper-color);
  }
  .move-menu-item {
    text-align: left;
    padding: 0.4em 0.6em;
    border: none;
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    font-size: var(--fs-12);
    white-space: nowrap;
  }
  .move-menu-item + .move-menu-item {
    border-top: var(--border-w) dashed var(--ink-color);
  }
  /* Hover cue is the accent text tint from the global button:hover rule — no fill. */

  /* Tray */
  .events-tray {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  /* Desktop left mode: the tray detaches from the bottom bar and becomes a
     fixed panel pinned to the left edge (below the toolbar, above the still-
     visible bottom bar). It slides in via translateX; the timeline is pushed
     right by --tray-left-w so nothing is obscured. top/bottom come from an
     inline style (they depend on the search bar and the measured bar height).
     Reduced motion neutralizes the transition globally (see global.css). */
  .events-tray.side-left {
    position: fixed;
    left: 0;
    width: var(--tray-side-w);
    transform: translateX(-100%);
    transition: transform 150ms ease;
    background: var(--paper-color);
    border-right: calc(var(--border-w) + 1px) solid var(--ink-color);
    box-shadow: 2px 0 6px rgba(0, 0, 0, 0.12);
    z-index: 19;
  }
  .events-tray.side-left[data-open='true'] {
    transform: translateX(0);
  }
  /* In left mode the tray's control bar acts as the panel's own toolbar: move it
     to the top and size it to the main toolbar (--toolbar-h) with a solid bottom
     border, so it lines up with the app toolbar to its right and the event list
     below starts level with the timeline rows. Ordering via `order` keeps the
     DOM structure (and bottom-mode layout) untouched. */
  .events-tray.side-left .copy-bar {
    order: -2;
    height: var(--toolbar-h);
    border-top: 0;
    border-bottom: var(--border-w) solid var(--ink-color);
  }
  .events-tray.side-left .filter-panel {
    order: -1;
  }
  .filter-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3em;
    padding: 0.4em 0;
    border-top: var(--border-w) dashed var(--ink-color);
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
    border: var(--border-w) solid var(--ink-faint);
    border-radius: 0;
    background: var(--paper-color);
    color: var(--ink-muted);
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .filter-clear[data-active='true'] {
    border-color: var(--ink-color);
    color: var(--ink-color);
  }
  .filter-chip {
    font-size: var(--fs-12);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0 calc(0.5em - 2px);
    border: var(--border-w) dashed var(--ink-color);
    border-radius: 0;
    background: transparent;
    color: var(--ink-color);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  /* Travel charms inside the Local / International chips. */
  .filter-chip :global(.icon) {
    margin-right: 3px;
    vertical-align: -2px;
  }
  .filter-chip[aria-pressed='true'] {
    border-style: solid;
    border-color: var(--ink-color);
    background: var(--ink-color);
    color: var(--paper-color);
  }
  .copy-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--toolbar-gap);
    padding: var(--time-header-pad-x);
    border-top: var(--border-w) dashed var(--ink-color);
  }
  .copy-spacer {
    flex: 1 1 auto;
  }
  .copy-btn {
    height: 28px;
    padding: 0 12px;
    border: var(--btn-border-w) solid var(--ink-color);
    background: var(--paper-color);
    color: var(--ink-color);
    cursor: pointer;
    font-size: var(--fs-12);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* Persistent pressed state keeps the inverted fill; hover is just the accent tint. */
  .copy-btn[aria-pressed='true'] {
    background: var(--ink-color);
    color: var(--paper-color);
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
    color: var(--ink-color);
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
    border-bottom: var(--border-w) solid var(--ink-faint);
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
    border-bottom: var(--border-w) solid var(--ink-color);
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
    /* Give the title most of the row; cap the location so it can't crowd it out. */
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 6em);
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
