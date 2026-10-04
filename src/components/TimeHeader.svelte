<script lang="ts">
  import Icon from './Icon.svelte';
  import { untrack } from 'svelte';
  import { zoom, config, ui, markerRange } from '../lib/state.svelte';
  import { today } from '../lib/today.svelte';
  import { clock } from '../lib/clock.svelte';
  import { viewport } from '../lib/viewport.svelte';
  import { dateToPx } from '../lib/layout';
  import { HEADER_TIERS, MS_PER_DAY, ticksBetween, formatTier, tierToGranularity, isoWeekNumber } from '../lib/time';
  import { formatDate, formatDayAbbrev, formatDayCount, formatDayInitial, formatMonth, formatSpanEdgeLabel, formatTime, isWeekend, isDaylight, dayLimitMinutes } from '../lib/format';
  import type { Tier } from '../lib/time';

  type Props = {
    rangeStart: Date;
    rangeEnd: Date;
    pxPerDay: number;
    scrollEl: HTMLElement | undefined;
    thickDayKeys?: Set<string>;
    thinDayKeys?: Set<string>;
  };
  const { rangeStart, rangeEnd, pxPerDay, scrollEl, thickDayKeys, thinDayKeys }: Props = $props();

  function dayKey(d: Date): string {
    return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
  }

  type Band = { date: Date; left: number; width: number; label: string; past?: boolean; current?: boolean; temp?: boolean };

  function setTempMarkerFromBand(b: Band, e: MouseEvent): void {
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

  function labelFor(d: Date, tier: Tier): string {
    if (tier === 'month') {
      const forceShort =
        zoom.value === '2-year' ||
        (viewport.isPortraitMobile && (zoom.value === 'half-year' || zoom.value === 'year')) ||
        (viewport.isLandscapeMobile && zoom.value === 'year');
      return formatMonth(d, config.locale, forceShort ? 'short' : 'long');
    }
    if (tier === 'week') {
      // Standard ISO week number (Monday/Thursday rule), independent of the
      // monday/sunday setting — constant across a week, so it matches the temp
      // marker's readout for any day in the same week.
      return 'W' + isoWeekNumber(d);
    }
    return formatTier(d, tier);
  }

  // The marked span (single day or duration), shared by the band highlighting
  // and the four marker labels below.
  const range = $derived(markerRange());

  const tiers = $derived.by<TierData[]>(() => {
    const cfg = HEADER_TIERS[zoom.value];
    return cfg.map((tier) => {
      const ticks = ticksBetween(rangeStart, rangeEnd, tierToGranularity(tier), config.weekStart);
      const bands: Band[] = ticks.map((d, i) => {
        const next = ticks[i + 1] ?? rangeEnd;
        return {
          date: d,
          left: dateToPx(d, rangeStart, pxPerDay),
          width: dateToPx(next, rangeStart, pxPerDay) - dateToPx(d, rangeStart, pxPerDay),
          label: labelFor(d, tier),
          // Past only if the whole period ends on/before today — so the band
          // containing today (current week/month/quarter/year) is not dimmed.
          past: next.getTime() <= today.value.getTime(),
          current:
            d.getTime() <= today.value.getTime() && today.value.getTime() < next.getTime(),
          // Any band overlapping the marked span reads accent, so a duration
          // marker highlights every week/month/quarter label it covers.
          temp: range != null && d.getTime() < range.endMs + MS_PER_DAY && range.startMs < next.getTime(),
        };
      });
      return { tier, bands };
    });
  });

  const showDayLetters = $derived(zoom.value === 'month');

  // 1M has no week tier: its week numbers ride in the month lane instead, one
  // label at each week's start, layered under the month names (which carry a
  // paper backing) so a month name is never obscured. A week label that would
  // run into a month name at its band start is skipped rather than left as a
  // sliver poking out beside it. Widths are estimated from the text (a few px
  // generous), not measured.
  const weekLabelW = $derived(8 + 3 * 0.62 * config.fontSize * (10 / 14));
  // Each month band, with where its name ends when drawn at the band start.
  const monthNameSpans = $derived(
    zoom.value !== 'month'
      ? []
      : (tiers.find((t) => t.tier === 'month')?.bands ?? []).map((m) => ({
          left: m.left,
          right: m.left + m.width,
          nameW: 14 + m.label.length * 0.72 * config.fontSize * (11 / 14),
          labelRight: m.left + 14 + m.label.length * 0.72 * config.fontSize * (11 / 14),
        })),
  );
  const monthLaneWeeks = $derived.by<Band[]>(() => {
    if (zoom.value !== 'month') return [];
    const ticks = ticksBetween(rangeStart, rangeEnd, 'week', config.weekStart);
    const clear = (x: number): boolean =>
      !monthNameSpans.some((m) => x < m.labelRight && x + weekLabelW > m.left);
    return ticks
      .map((d, i) => {
        const next = ticks[i + 1] ?? rangeEnd;
        const left = dateToPx(d, rangeStart, pxPerDay);
        return {
          date: d,
          left,
          width: dateToPx(next, rangeStart, pxPerDay) - left,
          label: labelFor(d, 'week'),
          past: next.getTime() <= today.value.getTime(),
          current: d.getTime() <= today.value.getTime() && today.value.getTime() < next.getTime(),
        };
      })
      .filter((w) => clear(w.left));
  });

  // The month name pinned at the left edge (sticky, once its band starts off
  // screen) covers whatever week label is under it: hide those too, rather than
  // leave a sliver beside the name. Checked once a frame while scrolling, and
  // written only when the hidden set actually changes (at week boundaries).
  let pinnedHidden = $state<string>('');
  $effect(() => {
    if (!scrollEl || monthLaneWeeks.length === 0) {
      pinnedHidden = '';
      return;
    }
    const el = scrollEl;
    const weeks = monthLaneWeeks;
    const spans = monthNameSpans;
    const wW = weekLabelW;
    let raf = 0;
    const check = (): void => {
      raf = 0;
      const x = el.scrollLeft;
      const m = spans.find((s) => s.left <= x && x < s.right);
      let key = '';
      if (m && x > m.left) {
        const r = Math.min(x + m.nameW, m.right);
        key = weeks
          .filter((w) => w.left < r && w.left + wW > x)
          .map((w) => w.date.getTime())
          .join(',');
      }
      if (key !== pinnedHidden) pinnedHidden = key;
    };
    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    untrack(check);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  });
  const pinnedHiddenSet = $derived(new Set(pinnedHidden ? pinnedHidden.split(',').map(Number) : []));

  // On portrait mobile the 3M/6M week labels stack "W" over the number (like the
  // 1M day column) instead of the single-line "W24" used where there's room.
  const weekStacked = $derived(
    viewport.isPortraitMobile && (zoom.value === 'quarter' || zoom.value === 'half-year'),
  );

  const dayBands = $derived.by<Band[]>(() => {
    if (!showDayLetters) return [];
    const days = ticksBetween(rangeStart, rangeEnd, 'day');
    return days.map((d) => ({
      date: d,
      left: dateToPx(d, rangeStart, pxPerDay),
      width: pxPerDay,
      label: formatDayInitial(d, config.locale),
      current: d.getTime() === today.value.getTime(),
      temp: range != null && d.getTime() >= range.startMs && d.getTime() <= range.endMs,
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
    range == null ? null : dateToPx(new Date(range.startMs), rangeStart, pxPerDay),
  );
  // The duration marker's right edge: the far side of the inclusive last day.
  // null for a single-day marker, which keeps the original two-label layout.
  const tempMarkerPxRight = $derived(
    range == null || ui.tempMarkerEndMs == null
      ? null
      : dateToPx(new Date(range.endMs + MS_PER_DAY), rangeStart, pxPerDay),
  );
  // Left of the start edge: the day count for a duration ("12D", "12Η" in
  // Greek), the start day's name for a single-day marker.
  const tempMarkerDayName = $derived(
    range == null
      ? ''
      : ui.tempMarkerEndMs != null
        ? formatDayCount(range.days, config.locale)
        : formatDayAbbrev(new Date(range.startMs), config.locale),
  );
  // Right of the start edge: the plain date, for a single-day marker only — a
  // duration puts the rest of its readout on the end edge instead (see below).
  const tempMarkerStartLabel = $derived(
    range == null || ui.tempMarkerEndMs != null
      ? ''
      : formatDate(new Date(range.startMs), config.dateFormat, config.locale),
  );
  // Right of the end edge: both edge days and the dates, e.g. "WED — SUN ·
  // 2026-08-05 — 16". Same single label 1W renders, so the two views read
  // identically.
  const tempMarkerRangeLabel = $derived(
    range == null || ui.tempMarkerEndMs == null
      ? ''
      : formatSpanEdgeLabel(range.startMs, range.endMs, config.dateFormat, config.locale),
  );
  // Day/night glyph for the current-date marker, using the configured
  // morning/evening limits (same boundaries as the calendar row headers).
  const morningMin = $derived(dayLimitMinutes(config.morningLimit, 8.5 * 60));
  const eveningMin = $derived(dayLimitMinutes(config.eveningLimit, 20.5 * 60));
  const nowIcon = $derived(
    isDaylight(config.timezone, new Date(clock.now), morningMin, eveningMin) ? 'sun' : 'moon',
  );

</script>

<div class="tiers" data-zoom={zoom.value}>
  {#each tiers as t (t.tier)}
    <div
      class="tier"
      data-tier={t.tier}
      data-stacked={t.tier === 'week' && weekStacked ? 'true' : null}
    >
      {#if t.tier === 'month'}
        {#each monthLaneWeeks as w (w.date.toISOString())}
          <time
            class="lane-week"
            datetime={w.date.toISOString()}
            data-past={w.past ? 'true' : null}
            data-current={w.current ? 'true' : null}
            hidden={pinnedHiddenSet.has(w.date.getTime())}
            style="left: {w.left}px"
            aria-hidden="true"
          >{w.label}</time>
        {/each}
      {/if}
      {#each t.bands as b (b.date.toISOString())}
        <button
          type="button"
          class="band"
          data-past={b.past ? 'true' : null}
          data-current={b.current ? 'true' : null}
          data-temp={b.temp ? 'true' : null}
          style="left: {b.left}px; width: {b.width}px"
          title={tooltip(b.date)}
          onclick={(e) => setTempMarkerFromBand(b, e)}
        >
          {#if t.tier === 'week' && weekStacked}
            <span class="week-letter">W</span>
            <span class="week-num">{b.label.slice(1)}</span>
          {:else}
            <time datetime={b.date.toISOString()} class="label">{b.label}</time>
          {/if}
        </button>
      {/each}
      {#if t.tier === 'quarter-year' || t.tier === 'year'}
        <span
          class="now-day-icon"
          style="left: {nowLineLeft - 4}px"
          aria-hidden="true"
        ><Icon name={nowIcon} size={12} /></span>
        <span
          class="now-time-label"
          data-mono
          style="left: {nowLineLeft + 6}px"
          aria-hidden="true"
        >{nowTimeLabel}</span>
        {#if tempMarkerPxLeft != null}
          <!-- Start edge: the day count (duration) or day name (single day) to
               its left, and for a single day the date to its right. -->
          <span
            class="temp-day-label"
            data-mono
            style="left: {tempMarkerPxLeft - 4}px"
            aria-hidden="true"
          >{tempMarkerDayName}</span>
          {#if tempMarkerStartLabel}
            <span
              class="temp-date-label"
              data-mono
              style="left: {tempMarkerPxLeft + Math.max(2, pxPerDay)}px"
              aria-hidden="true"
            >{tempMarkerStartLabel}</span>
          {/if}
        {/if}
        {#if tempMarkerPxRight != null}
          <!-- End edge: both edge day names and the dates, in one readout to
               its right. -->
          <span
            class="temp-date-label"
            data-mono
            style="left: {tempMarkerPxRight}px"
            aria-hidden="true"
          >{tempMarkerRangeLabel}</span>
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
          data-holiday={thickDayKeys?.has(dayKey(b.date)) ? 'true' : null}
          data-observance={thinDayKeys?.has(dayKey(b.date)) ? 'true' : null}
          data-past={b.date.getTime() < today.value.getTime() ? 'true' : null}
          data-current={b.current ? 'true' : null}
          data-temp={b.temp ? 'true' : null}
          style="left: {b.left}px; width: {b.width}px"
          title={tooltip(b.date)}
          onclick={(e) => setTempMarkerFromBand(b, e)}
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
  .now-day-icon {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    color: var(--accent-color);
    transform: translateX(-100%);
    pointer-events: none;
    z-index: 2;
    filter: var(--clock-halo);
    transition: none;
  }
  .now-time-label {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    font-size: var(--fs-12);
    line-height: 1;
    color: var(--accent-color);
    filter: var(--clock-halo);
    transition: none;
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
  }
  .temp-day-label {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    font-size: var(--fs-12);
    line-height: 1;
    color: var(--accent-color);
    transform: translateX(-100%);
    filter: var(--clock-halo);
    transition: none;
    white-space: nowrap;
    pointer-events: none;
    z-index: 3;
  }
  /* The date reads with the exact same font + size as the day-name label — both
     are data-mono spans; no button font reset that would diverge them. */
  .temp-date-label {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    padding: 0 4px 0 5px;
    font-size: var(--fs-12);
    line-height: 1;
    color: var(--accent-color);
    filter: var(--clock-halo);
    transition: none;
    white-space: nowrap;
    pointer-events: none;
    z-index: 3;
  }
  .tier {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    border-bottom: var(--border-w) solid var(--ink-color);
  }
  .tier:last-child {
    border-bottom: none;
  }
  [data-tier='quarter-year'],
  [data-tier='year'] {
    flex: 0 0 var(--time-header-date-h);
  }
  .band {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    border-left: var(--border-w) solid var(--ink-color);
    border-top: none;
    border-right: none;
    border-bottom: none;
    border-radius: 0;
    background: transparent;
    padding: 0;
    box-sizing: border-box;
    color: inherit;
    font: inherit;
    text-align: inherit;
    cursor: pointer;
  }
  .band[data-past='true'] {
    border-left-color: var(--ink-faint);
  }
  .band[data-weekend='true'] {
    background: var(--weekend-bg);
  }
  .band[data-weekend='true'][data-past='true'] {
    background: var(--weekend-bg-past);
  }
  .band[data-past='true'] .label,
  .band[data-past='true'] .day-letter,
  .band[data-past='true'] .day-num,
  .band[data-past='true'] .week-letter,
  .band[data-past='true'] .week-num {
    color: var(--ink-faint);
  }
  .band[data-current='true'] .label,
  .band[data-current='true'] .day-letter,
  .band[data-current='true'] .day-num {
    font-weight: 500;
  }
  /* The current date (day-letters tier) and current week (week tier) read in the
     accent colour across all zooms; the broader month/quarter/year labels keep
     their default ink. */
  [data-tier='day-letters'] .band[data-current='true'] .day-letter,
  [data-tier='day-letters'] .band[data-current='true'] .day-num,
  [data-tier='week'] .band[data-current='true'] .label,
  [data-tier='week'] .band[data-current='true'] .week-letter,
  [data-tier='week'] .band[data-current='true'] .week-num {
    color: var(--accent-color);
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
      var(--holiday-stripe) 4.5px,
      transparent 5px
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
      var(--holiday-stripe) 9.5px,
      transparent 10px
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
    padding-left: var(--time-header-pad-x);
    padding-right: var(--time-header-pad-x);
  }
  .label {
    position: sticky;
    left: 0;
    display: inline-block;
    /* Keeps every tier's sticky label (year/quarter/month) lined up the same
       small distance from the edge when pinned. */
    padding: 0 var(--time-header-pad-x);
    font-size: var(--fs-11);
    line-height: 1.25;
    white-space: nowrap;
    color: var(--ink-color);
  }
  [data-tier='quarter-year'] .label,
  [data-tier='year'] .label {
    font-weight: 700;
    font-size: var(--fs-12);
  }
  [data-tier='week'] .label {
    position: static;
    display: block;
    width: 100%;
    padding: 0;
    text-align: center;
  }
  [data-tier='month'] .label,
  [data-tier='quarter'] .label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  /* 1M's week numbers in the month lane: muted, at each week's start, under the
     month names — which get a paper backing and the higher layer, so a week
     label slides beneath a (sticky) month name instead of over it. */
  .lane-week {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    padding-left: var(--time-header-pad-x);
    font-size: var(--fs-10);
    line-height: 1;
    white-space: nowrap;
    color: var(--ink-muted);
    pointer-events: none;
    z-index: 0;
  }
  .lane-week[hidden] {
    display: none;
  }
  .lane-week[data-past='true'] {
    color: var(--ink-faint);
  }
  .lane-week[data-current='true'] {
    color: var(--accent-color);
  }
  [data-zoom='month'] [data-tier='month'] .label {
    z-index: 1;
    background: var(--paper-color);
  }
  /* Portrait-mobile 3M/6M: stack "W" over the week number like the 1M day column. */
  [data-tier='week'][data-stacked='true'] {
    flex: 1.5 1 0;
  }
  [data-tier='week'][data-stacked='true'] .band {
    flex-direction: column;
    justify-content: center;
    padding-top: var(--time-header-pad-y);
    padding-bottom: var(--time-header-pad-y);
  }
  .week-letter,
  .week-num {
    display: block;
    font-size: var(--fs-10);
    line-height: 1;
    text-align: center;
    color: var(--ink-color);
  }
  .week-num {
    font-family: var(--mono);
  }
  [data-tier='day-letters'] {
    flex: 1.5 1 0;
  }
  .day-letter-band {
    border-left: var(--border-w) solid var(--ink-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    /* Small breathing room above/below the letter + number stack. */
    padding-top: var(--time-header-pad-y);
    padding-bottom: var(--time-header-pad-y);
  }
  .day-letter-band[data-weekend='true'] .day-letter,
  .day-letter-band[data-weekend='true'] .day-num {
    color: var(--ink-muted);
  }
  /* Past weekends match other past dates rather than the weekend muted color. */
  .day-letter-band[data-weekend='true'][data-past='true'] .day-letter,
  .day-letter-band[data-weekend='true'][data-past='true'] .day-num {
    color: var(--ink-faint);
  }
  .day-letter {
    display: block;
    font-size: var(--fs-10);
    line-height: 1;
    color: var(--ink-color);
    padding: 0;
    text-align: center;
  }
  .day-num {
    display: block;
    font-family: var(--mono);
    font-size: var(--fs-10);
    line-height: 1;
    color: var(--ink-color);
  }
  /* When a marker is set, every tier band it falls in — quarter / month / week /
     day — reads accent and bold (matching 1W), so the whole marked column of
     header labels highlights. Kept last so it wins over the past / weekend
     dimming for a marked past weekend. */
  .band[data-temp='true'] .label,
  .band[data-temp='true'] .day-letter,
  .band[data-temp='true'] .day-num,
  .band[data-temp='true'] .week-letter,
  .band[data-temp='true'] .week-num {
    color: var(--accent-color);
    font-weight: 700;
  }
</style>
