<script lang="ts">
  import { zoom, config, ui } from '../lib/state.svelte';
  import { today } from '../lib/today.svelte';
  import { clock } from '../lib/clock.svelte';
  import { dateToPx, pxToDate } from '../lib/layout';
  import { HEADER_TIERS, MS_PER_DAY, ticksBetween, formatTier, tierToGranularity } from '../lib/time';
  import { formatDate, formatDayInitial, formatMonth, formatTime, isWeekend } from '../lib/format';
  import type { Tier } from '../lib/time';

  type Props = {
    rangeStart: Date;
    rangeEnd: Date;
    pxPerDay: number;
    scrollEl: HTMLElement | undefined;
    holidayDayKeys?: Set<string>;
    observanceDayKeys?: Set<string>;
  };
  const { rangeStart, rangeEnd, pxPerDay, scrollEl, holidayDayKeys, observanceDayKeys }: Props = $props();

  function dayKey(d: Date): string {
    return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
  }

  type Band = { date: Date; left: number; width: number; label: string };

  function setTempMarker(b: Band, e: MouseEvent): void {
    if (typeof window === 'undefined') return;
    const target = e.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const frac = rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
    const bandDays = b.width / pxPerDay;
    const tappedMs = b.date.getTime() + frac * bandDays * MS_PER_DAY;
    const tapped = new Date(tappedMs);
    const snappedUtc = Date.UTC(
      tapped.getUTCFullYear(),
      tapped.getUTCMonth(),
      tapped.getUTCDate(),
    );
    window.dispatchEvent(
      new CustomEvent('cal:set-temp-marker', { detail: { date: new Date(snappedUtc) } }),
    );
  }
  type TierData = { tier: Tier; bands: Band[] };

  let isPortraitMobile = $state(false);
  let isLandscapeMobile = $state(false);

  $effect(() => {
    if (typeof window === 'undefined') return;
    const mqP = window.matchMedia('(orientation: portrait) and (max-width: 640px)');
    const mqL = window.matchMedia('(orientation: landscape) and (max-width: 900px)');
    const upd = (): void => {
      isPortraitMobile = mqP.matches;
      isLandscapeMobile = mqL.matches;
    };
    upd();
    mqP.addEventListener('change', upd);
    mqL.addEventListener('change', upd);
    return () => {
      mqP.removeEventListener('change', upd);
      mqL.removeEventListener('change', upd);
    };
  });

  function labelFor(d: Date, tier: Tier): string {
    if (tier === 'month') {
      const forceShort =
        zoom.value === '2-year' ||
        (isPortraitMobile && (zoom.value === 'half-year' || zoom.value === 'year')) ||
        (isLandscapeMobile && zoom.value === 'year');
      return formatMonth(d, config.locale, forceShort ? 'short' : 'long');
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

  // Year-row labels: live wall-clock time hugging the today line +
  // formatted date next to the temp marker. The today line in month
  // zoom tracks clock.now, otherwise sits at start-of-day.
  const nowDateForLine = $derived(zoom.value === 'month' ? new Date(clock.now) : today.value);
  const nowLineLeft = $derived(dateToPx(nowDateForLine, rangeStart, pxPerDay));
  const nowTimeLabel = $derived(formatTime(new Date(clock.now), config.timeFormat, config.timezone));
  const tempMarkerPxLeft = $derived(
    ui.tempMarkerMs != null ? dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay) : null,
  );
  const tempMarkerDateLabel = $derived(
    ui.tempMarkerMs != null
      ? formatDate(new Date(ui.tempMarkerMs), config.dateFormat, config.locale)
      : '',
  );

  let labelDrag: { startX: number; moved: boolean; pid: number } | null = $state(null);

  function labelPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    labelDrag = { startX: e.clientX, moved: false, pid: e.pointerId };
    e.stopPropagation();
  }

  function labelPointerMove(e: PointerEvent): void {
    if (!labelDrag || labelDrag.pid !== e.pointerId || !scrollEl) return;
    const dx = e.clientX - labelDrag.startX;
    if (!labelDrag.moved) {
      if (Math.abs(dx) < 4) return;
      labelDrag.moved = true;
    }
    const rect = scrollEl.getBoundingClientRect();
    const xInTimeline = e.clientX - rect.left + scrollEl.scrollLeft;
    const d = pxToDate(xInTimeline, rangeStart, pxPerDay);
    ui.tempMarkerMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function labelPointerUp(e: PointerEvent): void {
    if (!labelDrag || labelDrag.pid !== e.pointerId) return;
    labelDrag = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer capture may already be released */
    }
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
          onclick={(e) => setTempMarker(b, e)}
        >
          <time datetime={b.date.toISOString()} class="label">{b.label}</time>
        </button>
      {/each}
      {#if t.tier === 'year'}
        <span
          class="now-time-label"
          data-mono
          style="left: {nowLineLeft + 6}px"
          aria-hidden="true"
        >{nowTimeLabel}</span>
        {#if tempMarkerPxLeft != null}
          <button
            type="button"
            class="temp-date-label"
            data-mono
            style="left: {tempMarkerPxLeft + Math.max(2, pxPerDay) + 4}px"
            aria-label="Drag to move temporary marker"
            onpointerdown={labelPointerDown}
            onpointermove={labelPointerMove}
            onpointerup={labelPointerUp}
            onpointercancel={labelPointerUp}
          >{tempMarkerDateLabel}</button>
        {/if}
      {/if}
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
          data-observance={observanceDayKeys?.has(dayKey(b.date)) ? 'true' : null}
          data-past={b.date.getTime() < today.value.getTime() ? 'true' : null}
          style="left: {b.left}px; width: {b.width}px"
          title={tooltip(b.date)}
          onclick={(e) => setTempMarker(b, e)}
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
  .now-time-label {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    font-size: 11px;
    line-height: 1;
    color: var(--accent);
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
  }
  .temp-date-label {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    padding: 0 4px;
    border: none;
    font: inherit;
    font-size: 11px;
    line-height: 1;
    color: var(--accent);
    background-color: var(--paper);
    white-space: nowrap;
    cursor: ew-resize;
    touch-action: none;
    z-index: 3;
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
  [data-tier='year'] {
    flex: 0 0 27px;
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
    position: absolute;
  }
  [data-zoom='month'] .day-letter-band[data-holiday='true']::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 4px,
      var(--holiday-stripe) 4px,
      var(--holiday-stripe) 5px
    );
    background-attachment: fixed;
    opacity: 0.6;
    pointer-events: none;
    z-index: 0;
  }
  [data-zoom='month'] .day-letter-band[data-holiday='true'] .day-letter,
  [data-zoom='month'] .day-letter-band[data-holiday='true'] .day-num {
    position: relative;
    z-index: 1;
  }
  [data-zoom='month'] .day-letter-band[data-observance='true'] {
    position: absolute;
  }
  [data-zoom='month'] .day-letter-band[data-observance='true']::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 9px,
      var(--holiday-stripe) 9px,
      var(--holiday-stripe) 10px
    );
    background-attachment: fixed;
    opacity: 0.6;
    pointer-events: none;
    z-index: 0;
  }
  [data-zoom='month'] .day-letter-band[data-observance='true'] .day-letter,
  [data-zoom='month'] .day-letter-band[data-observance='true'] .day-num {
    position: relative;
    z-index: 1;
  }
  [data-tier='week'] .band,
  .day-letter-band {
    padding-left: 2px;
    padding-right: 2px;
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
  [data-tier='week'] .label {
    position: static;
    display: block;
    width: 100%;
    padding: 1px 0;
    text-align: center;
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
