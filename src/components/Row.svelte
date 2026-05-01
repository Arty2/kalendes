<script lang="ts">
  import EventPill from './EventPill.svelte';
  import { assignLanes, dateToPx, ROW_PADDING_PX } from '../lib/layout';
  import type { CalendarFeed, ParsedEvent } from '../lib/types';

  type Props = {
    feed: CalendarFeed;
    events: ParsedEvent[];
    rangeStart: Date;
    pxPerDay: number;
    height: number;
    matchUids: Set<string>;
    currentMatchUid: string | null;
  };
  const { feed, events, rangeStart, pxPerDay, height, matchUids, currentMatchUid }: Props = $props();

  const lanes = $derived(assignLanes(events, pxPerDay, rangeStart));

  const dots = $derived.by(() => {
    if (!feed.collapsed) return [] as { px: number }[];
    return events.map((e) => ({ px: dateToPx(e.start, rangeStart, pxPerDay) }));
  });
</script>

<section
  data-feed-id={feed.id}
  data-collapsed={feed.collapsed ? 'true' : null}
  style="height: {height}px; padding-top: {ROW_PADDING_PX}px; padding-bottom: {ROW_PADDING_PX}px;"
>
  {#if feed.collapsed}
    {#each dots as d (d.px)}
      <i class="dot" style="left: {d.px}px"></i>
    {/each}
  {:else}
    {#each lanes.laneEvents as e (e.uid)}
      <EventPill
        event={e}
        isMatch={matchUids.has(e.uid)}
        isCurrent={currentMatchUid === e.uid}
      />
    {/each}
  {/if}
</section>

<style>
  section {
    position: relative;
    border-bottom: 1px solid var(--ink);
    box-sizing: border-box;
  }
  .dot {
    position: absolute;
    top: 50%;
    width: 3px;
    height: 3px;
    background: var(--ink);
    transform: translate(-50%, -50%);
  }
</style>
