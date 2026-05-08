<script lang="ts">
  import { zoom, config } from '../lib/state.svelte';
  import { today } from '../lib/today.svelte';
  import { dateToPx } from '../lib/layout';
  import { HEADER_TIERS, ticksBetween, formatTier, tierToGranularity } from '../lib/time';
  import { formatMonth, formatDayInitial, formatDate, isWeekend } from '../lib/format';
  import type { Tier } from '../lib/time';

  type Props = {
    rangeStart: Date;
    rangeEnd: Date;
    pxPerDay: number;
    scrollEl: HTMLElement | undefined;
    holidayDayKeys?: Set<string>;
  };
  const { rangeStart, rangeEnd, pxPerDay, holidayDayKeys }: Props = $props();

  function dayKey(d: Date): string {
    return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
  }

  function setTempMarker(d: Date): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('cal:set-temp-marker', { detail: { date: d } }));
  }

  type Band = { date: Date; left: number; width: number; label: string };
  type TierData = { tier: Tier; bands: Band[] };

  function labelFor(d: Date, tier: Tier): string {
    if (tier === 'month') {
      const length = zoom.value === '2-year' ? 'short' : 'long';
      return formatMonth(d, config.locale, length);
    }
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

<div class="tiers" data-zoom={zoom.value}>
  {#each tiers as t (t.tier)}
    <div class="tier" data-tier={t.tier}>
      {#each t.bands as b (b.date.toISOString())}
        <button
          type="button"
          class="band"
          data-past={b.date.getTime() < today.value.getTime() ? 'true' : null}
          style="left: {b.left}px; width: {b.width}px"
          title={tooltip(b.date)}
          onclick={() => setTempMarker(b.date)}
        >
          <time datetime={b.date.toISOString()} class="label">{b.label}</time>
        </button>
      {/each}
    </div>
  {/each}
  {#if showDayLetters}
    <div class="tier" data-tier="day-letters">
      {#each dayBands as b (b.date.toISOString())}
        <button
          type="button"
          class="band day-letter-band"
          data-weekend={isWeekend(b.date) ? 'true' : null}
          data-holiday={holidayDayKeys?.has(dayKey(b.date)) ? 'true' : null}
          data-past={b.date.getTime() < today.value.getTime() ? 'true' : null}
          style="left: {b.left}px; width: {b.width}px"
          title={tooltip(b.date)}
          onclick={() => setTempMarker(b.date)}
        >
          <time datetime={b.date.toISOString()} class="day-letter">{b.label}</time>
          <span class="day-num">{b.date.getUTCDate()}</span>
        </button>
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
    border-top: none;
    border-right: none;
    border-bottom: none;
    background: transparent;
    padding: 0;
    box-sizing: border-box;
    color: inherit;
    font: inherit;
    text-align: inherit;
    cursor: pointer;
  }
  .band[data-weekend='true'] {
    background: var(--weekend-bg);
  }
  .band[data-past='true'] .label,
  .band[data-past='true'] .day-letter,
  .band[data-past='true'] .day-num {
    color: var(--ink-muted);
  }
  [data-zoom='month'] .day-letter-band[data-holiday='true'] {
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 4px,
      var(--holiday-stripe) 4px,
      var(--holiday-stripe) 5px
    );
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
