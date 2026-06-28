<script lang="ts">
  import Icon from './Icon.svelte';
  import { zoom, config, ui } from '../lib/state.svelte';
  import { today } from '../lib/today.svelte';
  import { clock } from '../lib/clock.svelte';
  import { dateToPx, pxToDate } from '../lib/layout';
  import { HEADER_TIERS, MS_PER_DAY, ticksBetween, formatTier, tierToGranularity, isoWeekNumber, addDays } from '../lib/time';
  import { formatDate, formatDayInitial, formatMonth, formatTime, formatTimezoneLabel, isWeekend, isDaylight, dayLimitMinutes } from '../lib/format';
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

  type Band = { date: Date; left: number; width: number; label: string; past?: boolean; current?: boolean };

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
    if (tier === 'week') {
      return 'W' + isoWeekNumber(addDays(d, config.weekStart === 'sunday' ? 4 : 3));
    }
    return formatTier(d, tier);
  }

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
        };
      });
      return { tier, bands };
    });
  });

  const showDayLetters = $derived(zoom.value === 'month');

  // On portrait mobile the 3M/6M week labels stack "W" over the number (like the
  // 1M day column) instead of the single-line "W24" used where there's room.
  const weekStacked = $derived(
    isPortraitMobile && (zoom.value === 'quarter' || zoom.value === 'half-year'),
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
    }));
  });

  function tooltip(d: Date): string {
    return formatDate(d, config.dateFormat, config.locale);
  }

  // --- 1W week view header: a day row + two timezone hour rows ---
  const isWeek = $derived(zoom.value === 'week');

  function weekdayShort(d: Date): string {
    const tag = config.locale === 'el' ? 'el' : 'en-US';
    return d.toLocaleString(tag, { weekday: 'short', timeZone: 'UTC' });
  }

  // Full weekday + date per day column (e.g. "Mon 30").
  const weekDayBands = $derived.by<Band[]>(() => {
    if (!isWeek) return [];
    return ticksBetween(rangeStart, rangeEnd, 'day').map((d) => ({
      date: d,
      left: dateToPx(d, rangeStart, pxPerDay),
      width: pxPerDay,
      label: weekdayShort(d) + ' ' + d.getUTCDate(),
      current: d.getTime() === today.value.getTime(),
    }));
  });

  // Hourly ticks can span years across the full range, so they are virtualized
  // to the visible scroll window (plus an overscan of one viewport each side).
  let winLeft = $state(0);
  let winRight = $state(0);
  $effect(() => {
    if (!isWeek || !scrollEl) return;
    const el = scrollEl;
    const update = (): void => {
      const overscan = el.clientWidth;
      winLeft = el.scrollLeft - overscan;
      winRight = el.scrollLeft + el.clientWidth + overscan;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  });

  // Stride between labelled hours, chosen so labels keep ~44px of breathing room.
  const HOUR_STRIDES = [1, 2, 3, 4, 6, 12];
  const hourStride = $derived.by(() => {
    const pxPerHour = pxPerDay / 24;
    return HOUR_STRIDES.find((s) => s * pxPerHour >= 44) ?? 12;
  });

  type HourTick = { date: Date; left: number };
  const hourTicks = $derived.by<HourTick[]>(() => {
    if (!isWeek) return [];
    const hasWindow = winRight > winLeft;
    const leftPx = hasWindow ? Math.max(0, winLeft) : 0;
    const rightPx = hasWindow ? winRight : pxPerDay * 7;
    const startMs = rangeStart.getTime() + (leftPx / pxPerDay) * MS_PER_DAY;
    const endMs = rangeStart.getTime() + (rightPx / pxPerDay) * MS_PER_DAY;
    const strideMs = hourStride * 3_600_000;
    const ticks: HourTick[] = [];
    // Stride-aligned to the UTC epoch → round UTC hours (and round local hours
    // in every whole-hour-offset zone, e.g. Athens and US).
    for (let t = Math.ceil(startMs / strideMs) * strideMs; t <= endMs; t += strideMs) {
      const date = new Date(t);
      ticks.push({ date, left: dateToPx(date, rangeStart, pxPerDay) });
    }
    return ticks;
  });

  const weekTzRows = $derived([
    { tz: config.weekTzTop, label: formatTimezoneLabel(config.weekTzTop, config.dst) },
    { tz: config.weekTzBottom, label: formatTimezoneLabel(config.weekTzBottom, config.dst) },
  ]);

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
  const tempMarkerWeek = $derived(
    ui.tempMarkerMs != null
      ? 'W' + isoWeekNumber(addDays(new Date(ui.tempMarkerMs), config.weekStart === 'sunday' ? 4 : 3))
      : '',
  );
  // Day/night glyph for the current-date marker, using the configured
  // morning/evening limits (same boundaries as the calendar row headers).
  const morningMin = $derived(dayLimitMinutes(config.morningLimit, 8 * 60));
  const eveningMin = $derived(dayLimitMinutes(config.eveningLimit, 20 * 60));
  const nowIcon = $derived(
    isDaylight(config.timezone, new Date(clock.now), morningMin, eveningMin) ? 'sun' : 'moon',
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
  {#if isWeek}
    <div class="tier week-day-tier" data-tier="week-day">
      {#each weekDayBands as b (b.date.toISOString())}
        <button
          type="button"
          class="band week-day-band"
          data-weekend={isWeekend(b.date) ? 'true' : null}
          data-holiday={thickDayKeys?.has(dayKey(b.date)) ? 'true' : null}
          data-observance={thinDayKeys?.has(dayKey(b.date)) ? 'true' : null}
          data-past={b.date.getTime() < today.value.getTime() ? 'true' : null}
          data-current={b.current ? 'true' : null}
          style="left: {b.left}px; width: {b.width}px"
          title={tooltip(b.date)}
          onclick={(e) => setTempMarker(b, e)}
        >
          <time datetime={b.date.toISOString()} class="label">{b.label}</time>
        </button>
      {/each}
    </div>
    {#each weekTzRows as row (row.tz)}
      <div class="tier week-tz-tier" data-tier="week-tz">
        <span class="tz-badge" data-mono>{row.label}</span>
        {#each hourTicks as h (h.date.toISOString())}
          <span class="hour-tick" data-mono style="left: {h.left}px"
            >{formatTime(h.date, config.timeFormat, row.tz)}</span>
        {/each}
      </div>
    {/each}
  {:else}
  {#each tiers as t (t.tier)}
    <div
      class="tier"
      data-tier={t.tier}
      data-stacked={t.tier === 'week' && weekStacked ? 'true' : null}
    >
      {#each t.bands as b (b.date.toISOString())}
        <button
          type="button"
          class="band"
          data-past={b.past ? 'true' : null}
          data-current={b.current ? 'true' : null}
          style="left: {b.left}px; width: {b.width}px"
          title={tooltip(b.date)}
          onclick={(e) => setTempMarker(b, e)}
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
          <span
            class="temp-week-label"
            data-mono
            style="left: {tempMarkerPxLeft - 4}px"
            aria-hidden="true"
          >{tempMarkerWeek}</span>
          <button
            type="button"
            class="temp-date-label"
            data-mono
            style="left: {tempMarkerPxLeft + Math.max(2, pxPerDay)}px"
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
          data-holiday={thickDayKeys?.has(dayKey(b.date)) ? 'true' : null}
          data-observance={thinDayKeys?.has(dayKey(b.date)) ? 'true' : null}
          data-past={b.date.getTime() < today.value.getTime() ? 'true' : null}
          data-current={b.current ? 'true' : null}
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
    color: var(--accent);
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
    color: var(--accent);
    filter: var(--clock-halo);
    transition: none;
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
  }
  .temp-week-label {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    font-size: var(--fs-12);
    line-height: 1;
    color: var(--accent);
    transform: translateX(-100%);
    filter: var(--clock-halo);
    transition: none;
    white-space: nowrap;
    pointer-events: none;
    z-index: 3;
  }
  .temp-date-label {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    padding: 0 4px 0 5px;
    border: none;
    font: inherit;
    font-size: var(--fs-12);
    line-height: 1;
    color: var(--accent);
    background: transparent;
    filter: var(--clock-halo);
    transition: none;
    white-space: nowrap;
    cursor: ew-resize;
    touch-action: none;
    z-index: 3;
  }
  .tier {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    border-bottom: var(--border-w) solid var(--ink);
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
    border-left: var(--border-w) solid var(--ink);
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
    color: var(--ink);
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
    color: var(--ink);
  }
  .week-num {
    font-family: var(--mono);
  }
  [data-tier='day-letters'] {
    flex: 1.5 1 0;
  }
  .day-letter-band {
    border-left: var(--border-w) solid var(--ink);
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
    color: var(--ink);
    padding: 0;
    text-align: center;
  }
  .day-num {
    display: block;
    font-family: var(--mono);
    font-size: var(--fs-10);
    line-height: 1;
    color: var(--ink);
  }

  /* --- 1W week view header: day row + two timezone hour rows --- */
  .week-day-band {
    justify-content: center;
  }
  .week-day-band .label {
    position: static;
    width: 100%;
    padding: 0;
    text-align: center;
    font-size: var(--fs-11);
  }
  [data-zoom='week'] .week-day-band[data-holiday='true']::before {
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
  [data-zoom='week'] .week-day-band[data-observance='true']::before {
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
  [data-zoom='week'] .week-day-band[data-holiday='true'] .label,
  [data-zoom='week'] .week-day-band[data-observance='true'] .label {
    position: relative;
    z-index: 1;
  }
  .tz-badge {
    position: sticky;
    left: 0;
    z-index: 4;
    display: inline-flex;
    align-items: center;
    height: 100%;
    padding: 0 var(--time-header-pad-x);
    font-size: var(--fs-10);
    line-height: 1;
    white-space: nowrap;
    color: var(--ink-muted);
    background: var(--paper);
    border-right: var(--border-w) solid var(--ink-faint);
  }
  .hour-tick {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    padding-left: 3px;
    border-left: var(--border-w) solid var(--ink-faint);
    font-size: var(--fs-10);
    line-height: 1;
    color: var(--ink-muted);
    white-space: nowrap;
    pointer-events: none;
  }
</style>
