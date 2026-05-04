<script lang="ts">
  import TimeHeader from './TimeHeader.svelte';
  import Row from './Row.svelte';
  import { zoom, search, config, focus, displayEventsFor } from '../lib/state.svelte';
  import { PX_PER_DAY, dateToPx, pxToDate, LANE_HEIGHT, ROW_PADDING_PX, assignLanes } from '../lib/layout';
  import { MS_PER_DAY, ticksBetween, addDays } from '../lib/time';
  import { isWeekend } from '../lib/format';
  import { buildIndex, search as runSearch } from '../lib/search';
  import { pinchZoom } from '../lib/pinch';
  import { today } from '../lib/today.svelte';
  import type { DisplayEvent, Zoom } from '../lib/types';

  type Props = { rangeStart: Date; rangeEnd: Date; today: Date };
  const { rangeStart, rangeEnd, today: todayDate }: Props = $props();

  const pxPerDay = $derived(PX_PER_DAY[zoom.value]);
  const totalWidth = $derived(((rangeEnd.getTime() - rangeStart.getTime()) / MS_PER_DAY) * pxPerDay);
  const todayPx = $derived(dateToPx(todayDate, rangeStart, pxPerDay));
  const searchActive = $derived(search.query.trim().length > 0);

  const orderedFeeds = $derived([...config.feeds].sort((a, b) => a.order - b.order));

  const displayByFeed = $derived.by<Record<string, DisplayEvent[]>>(() => {
    const out: Record<string, DisplayEvent[]> = {};
    for (const feed of config.feeds) out[feed.id] = displayEventsFor(feed.id);
    return out;
  });

  const visibleByFeed = $derived.by<Record<string, DisplayEvent[]>>(() => {
    const out: Record<string, DisplayEvent[]> = {};
    for (const feed of config.feeds) {
      out[feed.id] = (displayByFeed[feed.id] ?? []).filter((e) => !e.hidden);
    }
    return out;
  });

  const allVisibleEvents = $derived.by(() => {
    const out: DisplayEvent[] = [];
    for (const feed of orderedFeeds) {
      if (feed.collapsed) continue;
      const arr = visibleByFeed[feed.id] ?? [];
      for (const e of arr) out.push(e);
    }
    return out;
  });

  const searchableEvents = $derived.by(() => {
    if (search.includesPast) return allVisibleEvents;
    const cutoff = today.value.getTime();
    return allVisibleEvents.filter((e) => e.end.getTime() >= cutoff);
  });

  const searchIndex = $derived(buildIndex(searchableEvents));
  const matches = $derived(searchActive ? runSearch(searchIndex, search.query) : []);
  const matchUids = $derived(new Set(matches.map((m) => m.event.uid)));
  const currentMatchUid = $derived(matches[search.currentIndex]?.event.uid ?? null);

  const monthStartsPx = $derived.by(() => {
    return ticksBetween(addDays(rangeStart, 1), rangeEnd, 'month').map((d) =>
      dateToPx(d, rangeStart, pxPerDay),
    );
  });

  const weekendStrips = $derived.by(() => {
    const out: { left: number; width: number }[] = [];
    const days = ticksBetween(rangeStart, rangeEnd, 'day');
    for (const d of days) {
      if (isWeekend(d)) {
        out.push({ left: dateToPx(d, rangeStart, pxPerDay), width: pxPerDay });
      }
    }
    return out;
  });

  const dayTicksPx = $derived.by(() => {
    if (pxPerDay < 30) return [] as number[];
    const days = ticksBetween(rangeStart, rangeEnd, 'day');
    return days.map((d) => dateToPx(d, rangeStart, pxPerDay));
  });

  const holidayDayKeys = $derived.by(() => {
    const out = new Set<string>();
    for (const feed of config.feeds) {
      if (feed.kind !== 'holidays') continue;
      const arr = visibleByFeed[feed.id] ?? [];
      for (const ev of arr) {
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
          out.add(
            d.getUTCFullYear() +
              '-' +
              (d.getUTCMonth() + 1) +
              '-' +
              d.getUTCDate(),
          );
          cursor += MS_PER_DAY;
        }
      }
    }
    return out;
  });

  const holidayStrips = $derived.by(() => {
    if (holidayDayKeys.size === 0) return [] as { left: number; width: number }[];
    const out: { left: number; width: number }[] = [];
    const days = ticksBetween(rangeStart, rangeEnd, 'day');
    for (const d of days) {
      const key = d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
      if (holidayDayKeys.has(key)) {
        out.push({ left: dateToPx(d, rangeStart, pxPerDay), width: pxPerDay });
      }
    }
    return out;
  });

  const rowBodyHeights = $derived.by(() => {
    const result: Record<string, number> = {};
    for (const feed of orderedFeeds) {
      const arr = visibleByFeed[feed.id] ?? [];
      const { laneCount } = assignLanes(arr, pxPerDay, rangeStart);
      result[feed.id] = Math.max(LANE_HEIGHT, laneCount * LANE_HEIGHT) + ROW_PADDING_PX * 2;
    }
    return result;
  });

  let scrollEl: HTMLElement | undefined = $state();
  let didCenter = false;

  function updateViewportVars(): void {
    if (!scrollEl) return;
    scrollEl.style.setProperty('--scroll-left', scrollEl.scrollLeft + 'px');
    scrollEl.style.setProperty('--viewport-w', scrollEl.clientWidth + 'px');
  }

  let rafScheduled = false;
  function onScroll(): void {
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

  const ZOOM_ORDER: Zoom[] = ['month', 'quarter', 'half-year', 'year'];

  function setZoomPreservingCenter(next: Zoom): void {
    if (!scrollEl) {
      zoom.value = next;
      return;
    }
    const center = scrollEl.scrollLeft + scrollEl.clientWidth / 2;
    const centerDate = pxToDate(center, rangeStart, pxPerDay);
    zoom.value = next;
    queueMicrotask(() => {
      if (!scrollEl) return;
      const newPxPerDay = PX_PER_DAY[next];
      const newCenterPx = dateToPx(centerDate, rangeStart, newPxPerDay);
      scrollEl.scrollLeft = Math.max(0, newCenterPx - scrollEl.clientWidth / 2);
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
      const detail = (e as CustomEvent<{ zoom: Zoom }>).detail;
      if (!detail) return;
      setZoomPreservingCenter(detail.zoom);
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
    if (!scrollEl || !currentMatchUid) return;
    const ev = matches[search.currentIndex]?.event;
    if (!ev) return;
    const px = dateToPx(ev.start, rangeStart, pxPerDay);
    scrollEl.scrollLeft = Math.max(0, px - scrollEl.clientWidth / 2);
  });

  $effect(() => {
    if (!scrollEl) return;
    const expanded = orderedFeeds.filter((f) => !f.collapsed);
    if (expanded.length === 0) return;
    const target = expanded[focus.rowIndex];
    if (!target) return;
    const arr = visibleByFeed[target.id] ?? [];
    const ev = arr[focus.eventIndex];
    if (!ev) return;
    const px = dateToPx(ev.start, rangeStart, pxPerDay);
    scrollEl.scrollTo({ left: Math.max(0, px - scrollEl.clientWidth / 2), behavior: 'smooth' });
  });
</script>

<main
  id="timeline"
  bind:this={scrollEl}
  data-zoom={zoom.value}
  data-search-active={searchActive ? 'true' : null}
>
  <header id="time-header" style="width: {totalWidth}px">
    <TimeHeader {rangeStart} {rangeEnd} {pxPerDay} {scrollEl} />
  </header>
  <div class="rows" style="width: {totalWidth}px;">
    {#each orderedFeeds as feed, i (feed.id)}
      <Row
        {feed}
        events={displayByFeed[feed.id] ?? []}
        {rangeStart}
        {pxPerDay}
        bodyHeight={rowBodyHeights[feed.id] ?? LANE_HEIGHT + ROW_PADDING_PX * 2}
        {matchUids}
        {currentMatchUid}
        {scrollEl}
        {monthStartsPx}
        {weekendStrips}
        {dayTicksPx}
        {holidayStrips}
        rowIndex={i}
      />
    {/each}
    <hr class="today-line" style="left: {todayPx}px" />
  </div>
</main>

<style>
  #timeline {
    overflow: auto;
    height: calc(100dvh - 50px);
    background: var(--paper);
    display: flex;
    flex-direction: column;
    overscroll-behavior: contain;
    touch-action: pan-x pan-y;
  }
  #time-header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--paper);
    border-bottom: 1px solid var(--ink);
    height: 64px;
    flex-shrink: 0;
  }
  .rows {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 8px 0 16px 0;
    flex: 1 0 auto;
    width: max-content;
    min-width: 100%;
  }
  .today-line {
    position: absolute;
    top: -64px;
    bottom: 0;
    width: 0;
    margin: 0;
    border: none;
    border-left: 2px dotted var(--accent);
    z-index: 3;
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
</style>
