<script lang="ts">
  import { zoom } from '../lib/state.svelte';
  import { dateToPx } from '../lib/layout';
  import { HEADER_TIERS, ticksBetween, formatTier, tierToGranularity } from '../lib/time';
  import type { Tier } from '../lib/time';

  type Props = { rangeStart: Date; rangeEnd: Date; pxPerDay: number };
  const { rangeStart, rangeEnd, pxPerDay }: Props = $props();

  type TierData = { tier: Tier; ticks: { date: Date; px: number; label: string }[] };

  const tiers = $derived.by<TierData[]>(() => {
    const cfg = HEADER_TIERS[zoom.value];
    return cfg.map((tier) => {
      const ticks = ticksBetween(rangeStart, rangeEnd, tierToGranularity(tier)).map((d) => ({
        date: d,
        px: dateToPx(d, rangeStart, pxPerDay),
        label: formatTier(d, tier),
      }));
      return { tier, ticks };
    });
  });
</script>

<div class="tiers">
  {#each tiers as t (t.tier)}
    <div class="tier" data-tier={t.tier}>
      {#each t.ticks as tk (tk.date.toISOString())}
        <time datetime={tk.date.toISOString()} style="left: {tk.px}px">{tk.label}</time>
      {/each}
    </div>
  {/each}
</div>

<style>
  .tiers {
    position: relative;
    height: 100%;
  }
  .tier {
    position: relative;
    height: 33%;
    border-bottom: 1px solid var(--ink);
  }
  .tier:last-child {
    border-bottom: none;
  }
  time {
    position: absolute;
    top: 0;
    padding: 1px 4px;
    font-size: 11px;
    line-height: 1.3;
    white-space: nowrap;
    border-left: 1px solid var(--ink);
  }
  [data-tier='year'] time {
    font-weight: bold;
    font-size: 12px;
  }
  [data-tier='day'] time {
    font-size: 10px;
  }
</style>
