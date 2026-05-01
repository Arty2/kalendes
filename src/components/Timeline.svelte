<script lang="ts">
  import TimeHeader from './TimeHeader.svelte';
  import RowLabels from './RowLabels.svelte';
  import Grid from './Grid.svelte';
  import { zoom, search, config, events } from '../lib/state.svelte';
  import { PX_PER_DAY, dateToPx, LANE_HEIGHT, ROW_PADDING_PX, assignLanes } from '../lib/layout';
  import { MS_PER_DAY } from '../lib/time';
  import { buildIndex, search as runSearch } from '../lib/search';
  import type { ParsedEvent } from '../lib/types';

  type Props = { rangeStart: Date; rangeEnd: Date; today: Date };
  const { rangeStart, rangeEnd, today }: Props = $props();

  const pxPerDay = $derived(PX_PER_DAY[zoom.value]);
  const totalWidth = $derived(((rangeEnd.getTime() - rangeStart.getTime()) / MS_PER_DAY) * pxPerDay);
  const todayPx = $derived(dateToPx(today, rangeStart, pxPerDay));
  const searchActive = $derived(search.query.trim().length > 0);

  const orderedFeeds = $derived([...config.feeds].sort((a, b) => a.order - b.order));

  const allVisibleEvents = $derived.by(() => {
    const out: ParsedEvent[] = [];
    for (const feed of orderedFeeds) {
      if (feed.collapsed) continue;
      const arr = events.byFeed[feed.id] ?? [];
      for (const e of arr) out.push(e);
    }
    return out;
  });

  const searchIndex = $derived(buildIndex(allVisibleEvents));
  const matches = $derived(searchActive ? runSearch(searchIndex, search.query) : []);
  const matchUids = $derived(new Set(matches.map((m) => m.event.uid)));
  const currentMatchUid = $derived(matches[search.currentIndex]?.event.uid ?? null);

  const rowHeights = $derived.by(() => {
    const result: Record<string, number> = {};
    for (const feed of orderedFeeds) {
      if (feed.collapsed) {
        result[feed.id] = 18;
        continue;
      }
      const arr = events.byFeed[feed.id] ?? [];
      const { laneCount } = assignLanes(arr, pxPerDay, rangeStart);
      result[feed.id] = Math.max(LANE_HEIGHT, laneCount * LANE_HEIGHT) + ROW_PADDING_PX * 2;
    }
    return result;
  });

  let scrollEl: HTMLElement | undefined = $state();
  let didCenter = false;
  $effect(() => {
    if (!scrollEl || didCenter) return;
    if (totalWidth <= 0) return;
    const target = todayPx - scrollEl.clientWidth / 2;
    scrollEl.scrollLeft = Math.max(0, target);
    didCenter = true;
  });

  $effect(() => {
    if (!scrollEl || !currentMatchUid) return;
    const ev = matches[search.currentIndex]?.event;
    if (!ev) return;
    const px = dateToPx(ev.start, rangeStart, pxPerDay);
    scrollEl.scrollLeft = Math.max(0, px - scrollEl.clientWidth / 2);
  });
</script>

<main
  id="timeline"
  bind:this={scrollEl}
  data-zoom={zoom.value}
  data-search-active={searchActive ? 'true' : null}
>
  <header id="corner"></header>
  <header id="time-header" style="width: {totalWidth}px">
    <TimeHeader {rangeStart} {rangeEnd} {pxPerDay} />
  </header>
  <aside id="row-labels">
    <RowLabels feeds={orderedFeeds} rowHeights={rowHeights} />
  </aside>
  <section id="grid" style="width: {totalWidth}px">
    <Grid
      feeds={orderedFeeds}
      {rangeStart}
      {pxPerDay}
      {todayPx}
      {totalWidth}
      {rowHeights}
      matchUids={matchUids}
      currentMatchUid={currentMatchUid}
      searchActive={searchActive}
    />
  </section>
</main>

<style>
  #timeline {
    display: grid;
    grid-template-columns: 200px 1fr;
    grid-template-rows: 64px 1fr;
    overflow: auto;
    height: calc(100vh - 50px);
    background: var(--paper);
  }
  #corner {
    position: sticky;
    top: 0;
    left: 0;
    z-index: 3;
    background: var(--paper);
    border-right: 1px solid var(--ink);
    border-bottom: 1px solid var(--ink);
  }
  #time-header {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--paper);
    border-bottom: 1px solid var(--ink);
  }
  #row-labels {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--paper);
    border-right: 1px solid var(--ink);
  }
  #grid {
    position: relative;
  }
</style>
