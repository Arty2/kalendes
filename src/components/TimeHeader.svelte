<script lang="ts">
  import { zoom, config } from '../lib/state.svelte';
  import { dateToPx } from '../lib/layout';
  import { HEADER_TIERS, ticksBetween, formatTier, tierToGranularity } from '../lib/time';
  import { formatMonth, formatDayInitial, formatDate, isWeekend } from '../lib/format';
  import type { Tier } from '../lib/time';

  type Props = {
    rangeStart: Date;
    rangeEnd: Date;
    pxPerDay: number;
    scrollEl: HTMLElement | undefined;
  };
  const { rangeStart, rangeEnd, pxPerDay }: Props = $props();

  type Band = { date: Date; left: number; width: number; label: string };
  type TierData = { tier: Tier; bands: Band[] };

  function labelFor(d: Date, tier: Tier): string {
    if (tier === 'month') return formatMonth(d, config.locale, 'short');
    return formatTier(d, tier);
  }

  const tiers = $derived.by<TierData[]>(() => {
    const cfg = HEADER_TIERS[zoom.value];
    return cfg.map((tier) => {
      const ticks = ticksBetween(rangeStart, rangeEnd, tierToGranularity(tier));
      const bands: Band[] = ticks.map((d, i) => {
        const next = ticks[i + 1] ?? rangeEnd;
        return {
          date: d,
          left: dateToPx(d, rangeStart, pxPerDay),
          width: dateToPx(next, rangeStart, pxPerDay) - dateToPx(d, rangeStart, pxPerDay),
          label: labelFor(d, tier),
        };
      });
      return { tier, bands };
    });
  });

  const showDayLetters = $derived(zoom.value === 'month');

  const dayBands = $derived.by<Band[]>(() => {
    if (!showDayLetters) return [];
    const days = ticksBetween(rangeStart, rangeEnd, 'day');
    return days.map((d) => ({
      date: d,
      left: dateToPx(d, rangeStart, pxPerDay),
      width: pxPerDay,
      label: formatDayInitial(d, config.locale),
    }));
  });

  function tooltip(d: Date): string {
    return formatDate(d, config.dateFormat, config.locale);
  }
</script>

<div class="tiers">
  {#each tiers as t (t.tier)}
    <div class="tier" data-tier={t.tier}>
      {#each t.bands as b (b.date.toISOString())}
        <div
          class="band"
          style="left: {b.left}px; width: {b.width}px"
          title={tooltip(b.date)}
        >
          <time datetime={b.date.toISOString()} class="label">{b.label}</time>
        </div>
      {/each}
    </div>
  {/each}
  {#if showDayLetters}
    <div class="tier" data-tier="day-letters">
      {#each dayBands as b (b.date.toISOString())}
        <div
          class="band day-letter-band"
          data-weekend={isWeekend(b.date) ? 'true' : null}
          style="left: {b.left}px; width: {b.width}px"
          title={tooltip(b.date)}
        >
          <time datetime={b.date.toISOString()} class="day-letter">{b.label}</time>
          <span class="day-num">{b.date.getUTCDate()}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tiers {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .tier {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    border-bottom: 1px solid var(--ink);
  }
  .tier:last-child {
    border-bottom: none;
  }
  .band {
    position: absolute;
    top: 0;
    height: 100%;
    border-left: 1px solid var(--ink);
    box-sizing: border-box;
  }
  .band[data-weekend='true'] {
    background: var(--weekend-bg);
  }
  .label {
    position: sticky;
    left: 0;
    display: inline-block;
    padding: 1px 6px;
    font-size: 11px;
    line-height: 1.5;
    white-space: nowrap;
    color: var(--ink);
  }
  [data-tier='year'] .label {
    font-weight: 700;
    font-size: 12px;
  }
  [data-tier='month'] .label,
  [data-tier='quarter'] .label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  [data-tier='day-letters'] {
    flex: 1.5 1 0;
  }
  .day-letter-band {
    border-left: 1px solid var(--ink);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .day-letter-band[data-weekend='true'] .day-letter,
  .day-letter-band[data-weekend='true'] .day-num {
    color: var(--ink-muted);
  }
  .day-letter {
    display: block;
    font-size: 10px;
    line-height: 1.1;
    color: var(--ink);
    padding: 0;
    text-align: center;
  }
  .day-num {
    display: block;
    font-family: var(--mono);
    font-size: 10px;
    line-height: 1.1;
    color: var(--ink);
  }
</style>
