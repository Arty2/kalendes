<script lang="ts">
  import Icon from './Icon.svelte';
  import { zoom, config, markerRange, markerIsSpan } from '../lib/state.svelte';
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
  const { rangeStart, rangeEnd, pxPerDay, thickDayKeys, thinDayKeys }: Props = $props();

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
  // label at each week's start. They sit under the month names, which carry a
  // paper backing and a paper fade on their right, so a week number slides
  // beneath a (sticky) month name rather than over it.
  // A week whose number would run into the next month's name (that month starts
  // within the label's width — W49 against DECEMBER, W22 against JUNE on a
  // narrow phone) drops its label: the paper-backed name would clip it to "W2".
  // Width of "W53" at --fs-10 plus its left inset and a hair of air.
  const laneWeekPx = $derived(6 + 3 * 0.62 * 10 * (config.fontSize / 14) + 2);
  const monthLaneWeeks = $derived.by<Band[]>(() => {
    if (zoom.value !== 'month') return [];
    const ticks = ticksBetween(rangeStart, rangeEnd, 'week', config.weekStart);
    const monthLefts = ticksBetween(rangeStart, rangeEnd, 'month').map((m) => dateToPx(m, rangeStart, pxPerDay));
    const crowded = (left: number): boolean =>
      monthLefts.some((m) => m >= left && m - left < laneWeekPx);
    return ticks.map((d, i) => {
      const next = ticks[i + 1] ?? rangeEnd;
      const left = dateToPx(d, rangeStart, pxPerDay);
      return {
        date: d,
        left,
        width: dateToPx(next, rangeStart, pxPerDay) - left,
        label: labelFor(d, 'week'),
        past: next.getTime() <= today.value.getTime(),
        current: d.getTime() <= today.value.getTime() && today.value.getTime() < next.getTime(),
        temp: range != null && d.getTime() < range.endMs + MS_PER_DAY && range.startMs < next.getTime(),
      };
    }).filter((w) => !crowded(w.left));
  });

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
    range == null || !markerIsSpan()
      ? null
      : dateToPx(new Date(range.endMs + MS_PER_DAY), rangeStart, pxPerDay),
  );
  // Left of the start edge: the day count for a duration ("12D", "12Η" in
  // Greek), the start day's name for a single-day marker.
  const tempMarkerDayName = $derived(
    range == null
      ? ''
      : markerIsSpan()
        ? formatDayCount(range.days, config.locale)
        : formatDayAbbrev(new Date(range.startMs), config.locale),
  );
  // Right of the start edge: the plain date, for a single-day marker only — a
  // duration puts the rest of its readout on the end edge instead (see below).
  const tempMarkerStartLabel = $derived(
    range == null || markerIsSpan()
      ? ''
      : formatDate(new Date(range.startMs), config.dateFormat, config.locale),
  );
  // Right of the end edge: both edge days and the dates, e.g. "WED — SUN ·
  // 2026-08-05 — 16". Same single label 1W renders, so the two views read
  // identically.
  const tempMarkerRangeLabel = $derived(
    range == null || !markerIsSpan()
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

<div class="tiers" data-zoom={zoom.value} data-marked={range ? 'true' : null}>
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
            data-temp={w.temp ? 'true' : null}
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
        <!-- Paper backing + halo bridging the gap between the day/night icon
             and the time; the today line stays in front of it. -->
        <span class="now-gap" style="left: {nowLineLeft - 4}px" aria-hidden="true"></span>
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
  <!-- The today line's run through the header. Drawn here, not by Timeline's
       SVG (which passes under the sticky header), so it follows the header on
       vertical scroll, in front of the paper patch between the day/night icon
       and the time. Same 4/4 accent dash. -->
  <i class="now-line-head" style="left: {nowLineLeft}px" aria-hidden="true"></i>
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
  .now-line-head {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1.5px;
    transform: translateX(-50%);
    background: repeating-linear-gradient(to bottom, var(--accent-color) 0 4px, transparent 4px 8px);
    pointer-events: none;
    z-index: 3;
  }
  /* Fills the top tier's height and is clipped to it vertically, so its halo
     softens the patch sideways but never spills into the month row below. */
  .now-gap {
    position: absolute;
    top: 0;
    height: 100%;
    width: 10px;
    background: var(--paper-color);
    filter: var(--clock-halo);
    clip-path: inset(0 -12px);
    pointer-events: none;
    z-index: 2;
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
  /* Month names stay regular weight in the current month too. */
  [data-tier='month'] .band[data-current='true'] .label {
    font-weight: 400;
  }
  /* The current date (day-letters tier) reads in the accent colour across all
     zooms, and so does the current week (week tier) until a marker is set —
     then the marker's week takes the accent (data-temp, below) instead. The
     broader month/quarter/year labels keep their default ink. */
  [data-tier='day-letters'] .band[data-current='true'] .day-letter,
  [data-tier='day-letters'] .band[data-current='true'] .day-num,
  .tiers:not([data-marked]) [data-tier='week'] .band[data-current='true'] .label,
  .tiers:not([data-marked]) [data-tier='week'] .band[data-current='true'] .week-letter,
  .tiers:not([data-marked]) [data-tier='week'] .band[data-current='true'] .week-num {
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
     month names — which get a paper backing, a paper fade on their right and
     the higher layer, so a week label slides beneath a (sticky) month name
     instead of over it. */
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
  .lane-week[data-past='true'] {
    color: var(--ink-faint);
  }
  .tiers:not([data-marked]) .lane-week[data-current='true'],
  .tiers .lane-week[data-temp='true'] {
    color: var(--accent-color);
  }
  .tiers .lane-week[data-temp='true'] {
    font-weight: 700;
  }
  /* Keep the month names' paper backing (and anything else in the row) inside
     the row; sideways it still overflows, so the fade past a name shows. */
  [data-zoom='month'] [data-tier='month'] {
    overflow-y: clip;
  }
  [data-zoom='month'] [data-tier='month'] .label {
    z-index: 1;
    background: var(--paper-color);
  }
  [data-zoom='month'] [data-tier='month'] .label::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 100%;
    width: 1.5em;
    background: linear-gradient(to right, var(--paper-color), transparent);
    pointer-events: none;
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
     header labels highlights. Kept last, and prefixed with .tiers to match the
     past-weekend dimming's specificity, so it wins for a marked past weekend. */
  .tiers .band[data-temp='true'] .label,
  .tiers .band[data-temp='true'] .day-letter,
  .tiers .band[data-temp='true'] .day-num,
  .tiers .band[data-temp='true'] .week-letter,
  .tiers .band[data-temp='true'] .week-num {
    color: var(--accent-color);
    font-weight: 700;
  }
  /* The quarter / year names stay regular weight, current or marked. */
  .tiers [data-tier='quarter-year'] .band .label,
  .tiers [data-tier='year'] .band .label {
    font-weight: 400;
  }
</style>
