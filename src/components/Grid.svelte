<script lang="ts">
  import Row from './Row.svelte';
  import { events } from '../lib/state.svelte';
  import type { CalendarFeed } from '../lib/types';

  type Props = {
    feeds: CalendarFeed[];
    rangeStart: Date;
    pxPerDay: number;
    todayPx: number;
    totalWidth: number;
    rowHeights: Record<string, number>;
    matchUids: Set<string>;
    currentMatchUid: string | null;
    searchActive: boolean;
  };
  const {
    feeds,
    rangeStart,
    pxPerDay,
    todayPx,
    rowHeights,
    matchUids,
    currentMatchUid,
  }: Props = $props();
</script>

<hr id="today-line" style="left: {todayPx}px" />
<div class="rows">
  {#each feeds as feed (feed.id)}
    <Row
      {feed}
      events={events.byFeed[feed.id] ?? []}
      {rangeStart}
      {pxPerDay}
      height={rowHeights[feed.id] ?? 40}
      {matchUids}
      {currentMatchUid}
    />
  {/each}
</div>

<style>
  #today-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    margin: 0;
    border: none;
    border-left: 2px solid var(--ink);
    z-index: 1;
    pointer-events: none;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
</style>
