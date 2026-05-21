<script lang="ts">
  import IconButton from './IconButton.svelte';
  import TimeHeader from './TimeHeader.svelte';
  import Row from './Row.svelte';
  import { zoom, search, config, focus, selection, ui, displayEventsFor } from '../lib/state.svelte';
  import { getMatches, getMatchUids, getCurrentMatchUid } from '../lib/search-state.svelte';
  import { computePxPerDay, dateToPx, pxToDate, LANE_HEIGHT, ROW_PADDING_PX, assignLanes } from '../lib/layout';
  import type { CalendarFeed, DisplayEvent, LaneEvent, StyleVariant, Zoom } from '../lib/types';
  import { MS_PER_DAY, ticksBetween, addDays } from '../lib/time';
  import { isWeekend } from '../lib/format';
  import { pinchZoom } from '../lib/pinch';
  import { wheelZoom } from '../lib/wheel-zoom';
  import { clock } from '../lib/clock.svelte';

  const RIGHT_PAD_PX = 280;

  type Props = { rangeStart: Date; rangeEnd: Date; today: Date };
  const { rangeStart, rangeEnd, today: todayDate }: Props = $props();

  let viewportWidth = $state(0);
  const pxPerDay = $derived(computePxPerDay(zoom.value, viewportWidth));
  const totalWidth = $derived(((rangeEnd.getTime() - rangeStart.getTime()) / MS_PER_DAY) * pxPerDay);
  const nowDateForLine = $derived(zoom.value === 'month' ? new Date(clock.now) : todayDate);
  const todayPx = $derived(dateToPx(nowDateForLine, rangeStart, pxPerDay));
  const searchActive = $derived(search.query.trim().length > 0);

  const orderedFeeds = $derived(
    [...config.feeds].filter((f) => !f.hidden).sort((a, b) => a.order - b.order),
  );
  const expandedRowIndex = $derived.by<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    let i = 0;
    for (const f of orderedFeeds) {
      if (!f.collapsed) {
        out[f.id] = i;
        i++;
      }
    }
    return out;
  });

  const displayByFeed = $derived.by<Record<string, DisplayEvent[]>>(() => {
    const out: Record<string, DisplayEvent[]> = {};
    for (const feed of config.feeds) out[feed.id] = displayEventsFor(feed.id);
    return out;
  });

  const visibleByFeed = $derived.by<Record<string, DisplayEvent[]>>(() => {
    const out: Record<string, DisplayEvent[]> = {};
    for (const feed of config.feeds) {
      if (feed.collapsed) continue;
      // Time-limit-hidden events are omitted, but Hidden-style events still
      // render (as a faint, label-less placeholder pill).
      out[feed.id] = (displayByFeed[feed.id] ?? []).filter(
        (e) => !e.hidden || e.styleVariant === 'hidden',
      );
    }
    return out;
  });

  const matches = $derived(getMatches());
  const matchUids = $derived(getMatchUids());
  const currentMatchUid = $derived(getCurrentMatchUid());

  const monthStartsPx = $derived.by(() => {
    const todayMs = todayDate.getTime();
    return ticksBetween(addDays(rangeStart, 1), rangeEnd, 'month').map((d) => ({
      px: dateToPx(d, rangeStart, pxPerDay),
      past: d.getTime() < todayMs,
    }));
  });

  const allDays = $derived(ticksBetween(rangeStart, rangeEnd, 'day'));

  const weekendStrips = $derived.by(() => {
    const out: { left: number; width: number; past: boolean }[] = [];
    const todayMs = todayDate.getTime();
    for (const d of allDays) {
      if (isWeekend(d)) {
        out.push({
          left: dateToPx(d, rangeStart, pxPerDay),
          width: pxPerDay,
          past: d.getTime() < todayMs,
        });
      }
    }
    return out;
  });

  const dayTicksPx = $derived.by(() => {
    if (pxPerDay < 30) return [] as { px: number; past: boolean }[];
    const todayMs = todayDate.getTime();
    return allDays.map((d) => ({
      px: dateToPx(d, rangeStart, pxPerDay),
      past: d.getTime() < todayMs,
    }));
  });

  // Resolve an event's effective style the same way EventPill does, so the
  // row/header hatch matches what each pill renders as.
  function effectiveStyle(ev: DisplayEvent, feed: CalendarFeed): StyleVariant {
    if (ev.styleVariant !== 'none') return ev.styleVariant;
    if (feed.style) return feed.style;
    if (feed.category === 'holidays') return 'bold';
    return 'none';
  }

  // Hatch density by effective style: prominent styles get the heavy hatch,
  // tentative ones the discreet hatch, and struck/hidden contribute nothing.
  function hatchDensity(ev: DisplayEvent, feed: CalendarFeed): 'thick' | 'thin' | 'none' {
    const s = effectiveStyle(ev, feed);
    if (s === 'striked' || s === 'hidden') return 'none';
    if (s === 'dashed' || s === 'muted') return 'thin';
    return 'thick';
  }

  function eventDayKeys(ev: DisplayEvent): string[] {
    const keys: string[] = [];
    const start = ev.start;
    const lastMs = ev.allDay ? Math.max(start.getTime(), ev.end.getTime() - 1) : ev.end.getTime();
    let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const last = Date.UTC(
      new Date(lastMs).getUTCFullYear(),
      new Date(lastMs).getUTCMonth(),
      new Date(lastMs).getUTCDate(),
    );
    while (cursor <= last) {
      const d = new Date(cursor);
      keys.push(d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate());
      cursor += MS_PER_DAY;
    }
    return keys;
  }

  // Hatch classification for the time header and per-feed row bodies, driven
  // by each event's effective style (see hatchDensity):
  //   thick  = prominent (none/bold/inverted)
  //   thin   = tentative (dashed/muted)
  //   none   = struck/hidden -> no hatch
  // Holiday-category thick events span the full timeline as a band; their thin
  // events are confined to the row. Observance-category events are confined to
  // their own row (thick or thin) and never touch the header. The header only
  // reflects holiday-category days.
  const dayHatch = $derived.by(() => {
    const thickHeader = new Set<string>();
    const thinHeader = new Set<string>();
    const bandKeys = new Set<string>();
    const thickByFeed: Record<string, Set<string>> = {};
    const thinByFeed: Record<string, Set<string>> = {};
    for (const feed of config.feeds) {
      if (feed.hidden) continue;
      if (feed.category !== 'holidays' && feed.category !== 'observances') continue;
      const isHoliday = feed.category === 'holidays';
      const events = displayByFeed[feed.id] ?? [];
      for (const ev of events) {
        const density = hatchDensity(ev, feed);
        if (density === 'none') continue;
        const days = eventDayKeys(ev);
        if (density === 'thick') {
          if (isHoliday) {
            for (const d of days) {
              thickHeader.add(d);
              bandKeys.add(d);
            }
          } else {
            for (const d of days) (thickByFeed[feed.id] ??= new Set()).add(d);
          }
        } else {
          if (isHoliday) for (const d of days) thinHeader.add(d);
          for (const d of days) (thinByFeed[feed.id] ??= new Set()).add(d);
        }
      }
    }
    return { thickHeader, thinHeader, bandKeys, thickByFeed, thinByFeed };
  });

  const thickDayKeys = $derived(dayHatch.thickHeader);
  const thinDayKeys = $derived(dayHatch.thinHeader);

  function stripsForKeys(dayKeys: Set<string>): { left: number; width: number }[] {
    if (dayKeys.size === 0) return [];
    const out: { left: number; width: number }[] = [];
    for (const d of allDays) {
      const key = d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
      if (dayKeys.has(key)) {
        out.push({ left: dateToPx(d, rangeStart, pxPerDay), width: pxPerDay });
      }
    }
    return out;
  }

  function stripsByFeed(
    byFeed: Record<string, Set<string>>,
  ): Record<string, { left: number; width: number }[]> {
    const out: Record<string, { left: number; width: number }[]> = {};
    for (const [feedId, dayKeys] of Object.entries(byFeed)) {
      out[feedId] = stripsForKeys(dayKeys);
    }
    return out;
  }

  const holidayStrips = $derived(stripsForKeys(dayHatch.bandKeys));
  const thickStripsByFeed = $derived(stripsByFeed(dayHatch.thickByFeed));
  const thinStripsByFeed = $derived(stripsByFeed(dayHatch.thinByFeed));

  const rowLanes = $derived.by(() => {
    const result: Record<string, { height: number; laneEvents: LaneEvent[] }> = {};
    for (const feed of orderedFeeds) {
      if (feed.collapsed) {
        result[feed.id] = { height: LANE_HEIGHT + ROW_PADDING_PX * 2, laneEvents: [] };
        continue;
      }
      const arr = visibleByFeed[feed.id] ?? [];
      const { laneEvents, laneCount } = assignLanes(arr, pxPerDay, rangeStart);
      result[feed.id] = {
        height: Math.max(LANE_HEIGHT, laneCount * LANE_HEIGHT) + ROW_PADDING_PX * 2,
        laneEvents,
      };
    }
    return result;
  });

  let scrollEl: HTMLElement | undefined = $state();
  let didCenter = false;

  function updateViewportVars(): void {
    if (!scrollEl) return;
    scrollEl.style.setProperty('--scroll-left', scrollEl.scrollLeft + 'px');
    scrollEl.style.setProperty('--viewport-w', scrollEl.clientWidth + 'px');
    viewportWidth = scrollEl.clientWidth;
  }

  let rafScheduled = false;
  let lastInteractionMs = $state(0);
  function markInteraction(): void {
    lastInteractionMs = Date.now();
  }
  function onScroll(): void {
    markInteraction();
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      updateViewportVars();
    });
  }

  $effect(() => {
    if (!scrollEl) return;
    updateViewportVars();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(updateViewportVars);
    ro.observe(scrollEl);
    return () => {
      scrollEl?.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  });

  // Track explicit user input (separate from passive scroll) so the
  // 5-minute idle gate below can tell "user actively interacting" from
  // "user idle while the wall clock ticks."
  $effect(() => {
    if (typeof window === 'undefined') return;
    const events = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'];
    for (const e of events) window.addEventListener(e, markInteraction, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, markInteraction);
    };
  });

  function jumpToToday(): void {
    if (!scrollEl) return;
    scrollEl.scrollTo({ left: Math.max(0, todayPx - scrollEl.clientWidth / 2), behavior: 'smooth' });
  }

  $effect(() => {
    if (!scrollEl || didCenter) return;
    if (totalWidth <= 0) return;
    scrollEl.scrollLeft = Math.max(0, todayPx - scrollEl.clientWidth / 2);
    didCenter = true;
  });

  // Month zoom: nudge the viewport so the today line stays centered as
  // it drifts during the day. Only re-center when the user has been
  // idle for 5 minutes so panning is never overridden mid-interaction.
  // The today line itself keeps ticking via nowDateForLine -> todayPx.
  const RECENTER_IDLE_MS = 5 * 60 * 1000;
  let lastCenteredPx = -1;
  $effect(() => {
    if (!scrollEl) return;
    if (zoom.value !== 'month') return;
    // depend on clock.now
    void clock.now;
    if (!didCenter) return;
    if (Date.now() - lastInteractionMs < RECENTER_IDLE_MS) return;
    const cur = scrollEl.scrollLeft + scrollEl.clientWidth / 2;
    const drift = Math.abs(cur - todayPx);
    if (drift > scrollEl.clientWidth / 2) return;
    if (lastCenteredPx === todayPx) return;
    lastCenteredPx = todayPx;
    scrollEl.scrollLeft = Math.max(0, todayPx - scrollEl.clientWidth / 2);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (): void => jumpToToday();
    window.addEventListener('cal:jump-today', handler);
    return () => window.removeEventListener('cal:jump-today', handler);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event): void => {
      if (!scrollEl) return;
      const detail = (e as CustomEvent<{ dir: number }>).detail;
      const dir = detail?.dir ?? 1;
      scrollEl.scrollBy({ left: dir * scrollEl.clientWidth * 0.9, behavior: 'smooth' });
    };
    window.addEventListener('cal:scroll-page', handler);
    return () => window.removeEventListener('cal:scroll-page', handler);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event): void => {
      if (!scrollEl) return;
      const detail = (e as CustomEvent<{ date: Date }>).detail;
      if (!detail) return;
      const px = dateToPx(detail.date, rangeStart, pxPerDay);
      scrollEl.scrollTo({ left: Math.max(0, px - scrollEl.clientWidth / 2), behavior: 'smooth' });
    };
    window.addEventListener('cal:scroll-to-date', handler as EventListener);
    return () => window.removeEventListener('cal:scroll-to-date', handler as EventListener);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ date: Date }>).detail;
      if (!detail) return;
      ui.tempMarkerMs = detail.date.getTime();
    };
    window.addEventListener('cal:set-temp-marker', handler as EventListener);
    return () => window.removeEventListener('cal:set-temp-marker', handler as EventListener);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (): void => {
      ui.tempMarkerMs = null;
    };
    window.addEventListener('cal:clear-temp-marker', handler);
    return () => window.removeEventListener('cal:clear-temp-marker', handler);
  });

  let tempDrag: { startX: number; moved: boolean; pid: number } | null = $state(null);
  let tempLastTapMs = 0;
  let headerTapMs = 0;
  const DOUBLE_TAP_MS = 1200;

  function tempPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    tempDrag = { startX: e.clientX, moved: false, pid: e.pointerId };
    e.stopPropagation();
  }

  function tempPointerMove(e: PointerEvent): void {
    if (!tempDrag || tempDrag.pid !== e.pointerId || !scrollEl) return;
    const dx = e.clientX - tempDrag.startX;
    if (!tempDrag.moved) {
      if (Math.abs(dx) < 4) return;
      tempDrag.moved = true;
    }
    const rect = scrollEl.getBoundingClientRect();
    const xInTimeline = e.clientX - rect.left + scrollEl.scrollLeft;
    const newDate = pxToDate(xInTimeline, rangeStart, pxPerDay);
    ui.tempMarkerMs = Date.UTC(
      newDate.getUTCFullYear(),
      newDate.getUTCMonth(),
      newDate.getUTCDate(),
    );
  }

  function tempPointerUp(e: PointerEvent): void {
    if (!tempDrag || tempDrag.pid !== e.pointerId) return;
    const moved = tempDrag.moved;
    tempDrag = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer capture may already be released */
    }
    if (!moved) {
      const now = Date.now();
      if (now - tempLastTapMs < DOUBLE_TAP_MS) {
        ui.tempMarkerMs = null;
        tempLastTapMs = 0;
      } else {
        tempLastTapMs = now;
      }
    }
  }

  let toggleLast: 'today' | 'temp' = $state('today');
  function toggleTodayTempMarker(): void {
    if (!scrollEl || ui.tempMarkerMs == null) return;
    markInteraction();
    const tempPx = dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay);
    const targetPx = toggleLast === 'today' ? tempPx : todayPx;
    toggleLast = toggleLast === 'today' ? 'temp' : 'today';
    scrollEl.scrollTo({ left: Math.max(0, targetPx - scrollEl.clientWidth / 2), behavior: 'smooth' });
  }

  function onHeaderPointerUp(e: PointerEvent): void {
    if (ui.tempMarkerMs == null || !scrollEl) return;
    const scrollRect = scrollEl.getBoundingClientRect();
    const xInTimeline = e.clientX - scrollRect.left + scrollEl.scrollLeft;
    const markerPx = dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay);
    const headerEl = e.currentTarget as HTMLElement;
    const headerRect = headerEl.getBoundingClientRect();
    const isYearRow = (e.clientY - headerRect.top) < 27;
    const threshold = isYearRow ? Math.max(44, pxPerDay * 2) : Math.max(20, pxPerDay);
    if (Math.abs(xInTimeline - markerPx) > threshold) { headerTapMs = 0; return; }
    const now = Date.now();
    if (now - headerTapMs < DOUBLE_TAP_MS) {
      ui.tempMarkerMs = null;
      headerTapMs = 0;
      tempLastTapMs = 0;
    } else {
      headerTapMs = now;
    }
  }

  function onHeaderDblClick(e: MouseEvent): void {
    if (ui.tempMarkerMs == null || !scrollEl) return;
    const scrollRect = scrollEl.getBoundingClientRect();
    const xInTimeline = e.clientX - scrollRect.left + scrollEl.scrollLeft;
    const markerPx = dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay);
    const headerEl = e.currentTarget as HTMLElement;
    const headerRect = headerEl.getBoundingClientRect();
    // Year/month row is ~27px tall (top tier); use wider threshold there
    const isYearRow = (e.clientY - headerRect.top) < 27;
    const threshold = isYearRow ? Math.max(44, pxPerDay * 2) : Math.max(20, pxPerDay);
    if (Math.abs(xInTimeline - markerPx) <= threshold) {
      ui.tempMarkerMs = null;
      tempLastTapMs = 0;
    }
  }

  const ZOOM_ORDER: Zoom[] = ['month', 'quarter', 'half-year', 'year', '2-year'];

  function setZoomPreservingCenter(next: Zoom, jumpToday = false): void {
    if (!scrollEl) {
      zoom.value = next;
      return;
    }
    const center = scrollEl.scrollLeft + scrollEl.clientWidth / 2;
    const centerDate = pxToDate(center, rangeStart, pxPerDay);
    zoom.value = next;
    queueMicrotask(() => {
      if (!scrollEl) return;
      const newPxPerDay = computePxPerDay(next, scrollEl.clientWidth);
      // For a jump-to-today zoom, center on today using the freshly computed
      // pxPerDay; otherwise keep the previous viewport center.
      const targetDate = jumpToday ? nowDateForLine : centerDate;
      const targetPx = dateToPx(targetDate, rangeStart, newPxPerDay);
      scrollEl.scrollLeft = Math.max(0, targetPx - scrollEl.clientWidth / 2);
    });
  }

  function shiftZoom(dir: -1 | 1): void {
    const i = ZOOM_ORDER.indexOf(zoom.value);
    const next = i + dir;
    if (next >= 0 && next < ZOOM_ORDER.length) setZoomPreservingCenter(ZOOM_ORDER[next]!);
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ zoom: Zoom; jumpToday?: boolean }>).detail;
      if (!detail) return;
      setZoomPreservingCenter(detail.zoom, detail.jumpToday);
    };
    window.addEventListener('cal:set-zoom', handler as EventListener);
    return () => window.removeEventListener('cal:set-zoom', handler as EventListener);
  });

  $effect(() => {
    if (!scrollEl) return;
    const handle = pinchZoom(scrollEl, {
      onZoomIn: () => shiftZoom(-1),
      onZoomOut: () => shiftZoom(1),
    });
    return () => handle.destroy();
  });

  $effect(() => {
    if (!scrollEl) return;
    const handle = wheelZoom(scrollEl, {
      onZoomIn: () => shiftZoom(-1),
      onZoomOut: () => shiftZoom(1),
    });
    return () => handle.destroy();
  });

  $effect(() => {
    if (!scrollEl || !currentMatchUid) return;
    const ev = matches[search.currentIndex]?.event;
    if (!ev) return;
    const px = dateToPx(ev.start, rangeStart, pxPerDay);
    scrollEl.scrollLeft = Math.max(0, px - scrollEl.clientWidth / 2);
  });

  // Scroll to the focused event only when the focus itself changes — not when
  // unrelated state (e.g. expanding/collapsing another row) re-runs the effect.
  let lastScrolledFocus = '';
  $effect(() => {
    if (!scrollEl) return;
    const key = focus.feedId + ':' + focus.eventIndex;
    if (key === lastScrolledFocus) return;
    const target = orderedFeeds.find((f) => !f.collapsed && f.id === focus.feedId);
    if (!target) return;
    const arr = visibleByFeed[target.id] ?? [];
    const ev = arr[focus.eventIndex];
    if (!ev) return;
    lastScrolledFocus = key;
    const px = dateToPx(ev.start, rangeStart, pxPerDay);
    scrollEl.scrollTo({ left: Math.max(0, px - scrollEl.clientWidth / 2), behavior: 'smooth' });
  });
</script>

<main
  id="timeline"
  bind:this={scrollEl}
  data-zoom={zoom.value}
  data-search-active={searchActive ? 'true' : null}
  style="height: calc(100dvh - {50 + (search.open ? 44 : 0) + (selection.mode ? 44 : 0)}px);"
>
  <div class="scroll-content" style="width: {totalWidth + RIGHT_PAD_PX}px;">
    <header id="time-header" ondblclick={onHeaderDblClick} onpointerup={onHeaderPointerUp}>
      <TimeHeader {rangeStart} {rangeEnd} {pxPerDay} {scrollEl} {thickDayKeys} {thinDayKeys} />
      {#if ui.tempMarkerMs != null}
        <div class="toggle-marker-wrap" style="top: {50 + (search.open ? 44 : 0) + (selection.mode ? 44 : 0) + 3}px">
          <IconButton
            icon="arrows-horizontal"
            label="Toggle between today and temporary marker"
            size={14}
            onclick={toggleTodayTempMarker}
          />
        </div>
      {/if}
    </header>
    {#each holidayStrips as h, i (i)}
      <i class="holiday-band" style="left: {h.left}px; width: {h.width}px"></i>
    {/each}
    <div class="rows">
      {#each orderedFeeds as feed (feed.id)}
        <Row
          {feed}
          events={displayByFeed[feed.id] ?? []}
          laneEvents={rowLanes[feed.id]?.laneEvents ?? []}
          {rangeStart}
          {pxPerDay}
          bodyHeight={rowLanes[feed.id]?.height ?? LANE_HEIGHT + ROW_PADDING_PX * 2}
          {matchUids}
          {currentMatchUid}
          {scrollEl}
          {monthStartsPx}
          {weekendStrips}
          {dayTicksPx}
          thickStrips={thickStripsByFeed[feed.id] ?? []}
          thinStrips={thinStripsByFeed[feed.id] ?? []}
          rowIndex={expandedRowIndex[feed.id] ?? -1}
        />
      {/each}
    </div>
    <hr class="today-line" style="left: {todayPx}px" />
    {#if ui.tempMarkerMs != null}
      <button
        type="button"
        class="temp-line"
        style="left: {dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay)}px; width: {Math.max(2, pxPerDay)}px"
        aria-label="Drag to move or double-tap to clear temporary marker"
        onpointerdown={tempPointerDown}
        onpointermove={tempPointerMove}
        onpointerup={tempPointerUp}
        onpointercancel={tempPointerUp}
      ></button>
    {/if}
  </div>
</main>

<style>
  #timeline {
    overflow: auto;
    background: var(--paper);
    overscroll-behavior: contain;
    touch-action: pan-x pan-y;
  }
  .scroll-content {
    position: relative;
    min-width: 100%;
    min-height: 100%;
  }
  #time-header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--paper);
    border-bottom: 1px solid var(--ink);
    height: 80px;
  }
  .rows {
    position: relative;
    display: flex;
    flex-direction: column;
    padding-bottom: 16px;
  }
  .holiday-band {
    position: absolute;
    top: 80px;
    bottom: 0;
    pointer-events: none;
    z-index: 1;
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 4px,
      var(--holiday-stripe) 4px,
      var(--holiday-stripe) 5px
    );
    background-attachment: fixed;
    opacity: 0.6;
  }
  .today-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    margin: 0;
    border: none;
    border-left: 2px dashed var(--accent);
    z-index: 6;
    pointer-events: none;
  }
  .today-line::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
  }
  .temp-line {
    position: absolute;
    top: 0;
    bottom: 0;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--accent);
    opacity: 0.4;
    z-index: 7;
    cursor: ew-resize;
    touch-action: none;
  }
  .temp-line:hover,
  .temp-line:focus-visible {
    opacity: 0.6;
  }
  .toggle-marker-wrap {
    position: fixed;
    right: calc(0.75em + 5px);
    z-index: 11;
    pointer-events: auto;
  }
  .toggle-marker-wrap :global(.icon-button) {
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
  }
  .toggle-marker-wrap :global(.icon-button) :global(.icon) {
    transform: translate(4px, -2px);
    /* ~5px page-colored halo around the (mask-rendered) icon. */
    filter:
      drop-shadow(0 0 2px var(--paper)) drop-shadow(0 0 2px var(--paper))
      drop-shadow(0 0 2px var(--paper)) drop-shadow(0 0 2px var(--paper))
      drop-shadow(0 0 2px var(--paper));
  }
</style>
