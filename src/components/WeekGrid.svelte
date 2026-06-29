<script lang="ts">
  import WeekEvent from './WeekEvent.svelte';
  import Icon from './Icon.svelte';
  import { config, search, displayEventsFor } from '../lib/state.svelte';
  import { getMatchUids, getCurrentMatchUid } from '../lib/search-state.svelte';
  import { clock } from '../lib/clock.svelte';
  import {
    zonedParts,
    dayLimitMinutes,
    offsetMinutes,
    formatTimezoneLabel,
    formatTzDiff,
    resolveLocalTz,
    isDaylight,
    formatDayInitial,
    formatMonth,
    isWeekend,
  } from '../lib/format';
  import { packLanes } from '../lib/layout';
  import { MS_PER_DAY, formatTier } from '../lib/time';
  import type { CalendarFeed, DisplayEvent } from '../lib/types';

  // `today` is accepted for parity with the timeline (and so the grid re-derives
  // when the device day rolls over); the day columns themselves are anchored to
  // the primary zone's calendar day, derived from clock.now below.
  type Props = { today: Date; feedsById: Record<string, CalendarFeed> };
  const { today, feedsById }: Props = $props();

  // The grid keeps a fixed-size window of day columns in the DOM but *slides* it
  // as the user scrolls (see the re-anchor handler below), so horizontal scrolling
  // is effectively continuous in both directions without unbounded DOM growth.
  const RENDERED_DAYS = 91; // ~13 weeks kept rendered at once
  const INITIAL_PAST = 21; // days of past shown left of today on open
  const SHIFT_DAYS = 28; // how far the window slides when nearing an edge
  // Day offset (relative to today, primary zone) of the LEFTMOST rendered column.
  // Slides by ±SHIFT_DAYS as the user nears either edge; the rendered count stays
  // constant so the content geometry never changes (only which dates fill it).
  let startOffset = $state(-INITIAL_PAST);

  // Base metrics scaled by the font-size setting, mirroring the timeline's
  // fontScale pattern so the grid grows with larger text.
  const fontScale = $derived(config.fontSize / 14);
  const HOUR_H = $derived(Math.round(44 * fontScale));
  // Narrow hour-label columns (one per shown timezone, left gutter).
  const GUTTER_W = $derived(Math.round(22 * fontScale));
  // Day columns floor low enough that a full week fits on a vertical phone.
  const MIN_DAY_W = $derived(Math.round(44 * fontScale));
  const ALLDAY_ROW_H = $derived(Math.round(20 * fontScale));
  const MIN_BLOCK_H = 14;
  const bodyH = $derived(24 * HOUR_H);

  // Header tiers: Quarter+Year, Month, and a Date row styled like the 1M zoom.
  const TIER_Q_H = $derived(Math.round(16 * fontScale));
  const TIER_M_H = $derived(Math.round(16 * fontScale));
  const TIER_D_H = $derived(Math.round(30 * fontScale));
  const headerH = $derived(TIER_Q_H + TIER_M_H + TIER_D_H);

  const tzTop = $derived(config.weekTzTop);
  const tzBottom = $derived(config.weekTzBottom);
  const localTz = $derived(config.timezone === 'local' ? resolveLocalTz() : config.timezone);

  // Left-gutter timezone columns: primary (anchors the grid) + secondary, then the
  // local/display zone as a third reference only when it differs from both.
  const tzZones = $derived.by(() => {
    const zones = [tzTop, tzBottom];
    if (localTz !== tzTop && localTz !== tzBottom) zones.push(localTz);
    return zones;
  });
  const numTz = $derived(tzZones.length);
  const gutterW = $derived(numTz * GUTTER_W);

  // Day-column width: fit seven across the visible day area, but never below a
  // legibility floor — so wide viewports show a week at a glance while the full
  // window stays reachable by horizontal scroll (and narrow screens scroll too).
  let viewW = $state(0);
  const dayW = $derived.by(() => {
    if (viewW <= 0) return MIN_DAY_W;
    return Math.max(MIN_DAY_W, Math.round((viewW - gutterW) / 7));
  });
  const daysW = $derived(RENDERED_DAYS * dayW);
  const contentW = $derived(gutterW + daysW);

  function pad(n: number): string {
    return n < 10 ? '0' + n : String(n);
  }

  // UTC-midnight anchor for the primary-zone calendar day an instant falls on —
  // the basis for both the day columns and per-event (timed) day placement.
  function primaryAnchorMs(date: Date): number {
    const p = zonedParts(date, tzTop);
    return Date.UTC(p.y, p.m - 1, p.d);
  }
  // Re-anchored each time the day rolls over (clock.now / today drive this).
  const primaryTodayMs = $derived.by(() => {
    void today;
    return primaryAnchorMs(new Date(clock.now));
  });
  function dayIndexOf(date: Date): number {
    return Math.round((primaryAnchorMs(date) - primaryTodayMs) / MS_PER_DAY);
  }
  // Column index within the rendered window (the leftmost column is startOffset).
  function colIndexOf(date: Date): number {
    return dayIndexOf(date) - startOffset;
  }
  // All-day events are date-only (stored at UTC midnight); index them by their UTC
  // calendar day so a +offset primary zone doesn't push the inclusive last moment
  // into the next column. Column anchors (primaryTodayMs) are already UTC midnights.
  function utcColIndexOf(date: Date): number {
    const utcMid = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.round((utcMid - primaryTodayMs) / MS_PER_DAY) - startOffset;
  }

  // The rendered day columns: [startOffset, startOffset + RENDERED_DAYS).
  const days = $derived.by(() => {
    const out: { date: Date; isToday: boolean; weekend: boolean; initial: string; num: number }[] = [];
    for (let i = 0; i < RENDERED_DAYS; i++) {
      const off = startOffset + i;
      const d = new Date(primaryTodayMs + off * MS_PER_DAY);
      out.push({
        date: d,
        isToday: off === 0,
        weekend: isWeekend(d),
        initial: formatDayInitial(d, config.locale),
        num: d.getUTCDate(),
      });
    }
    return out;
  });

  // Quarter+Year and Month header tiers: consecutive day-columns grouped into one
  // band per quarter / per month, sized to span their columns.
  const quarterBands = $derived.by(() => {
    const out: { from: number; span: number; label: string; key: string }[] = [];
    let i = 0;
    while (i < days.length) {
      const d = days[i]!.date;
      const key = d.getUTCFullYear() + '-' + Math.floor(d.getUTCMonth() / 3);
      let j = i + 1;
      while (j < days.length) {
        const dj = days[j]!.date;
        if (dj.getUTCFullYear() + '-' + Math.floor(dj.getUTCMonth() / 3) !== key) break;
        j++;
      }
      out.push({ from: i, span: j - i, label: formatTier(d, 'quarter-year'), key });
      i = j;
    }
    return out;
  });
  const monthBands = $derived.by(() => {
    const out: { from: number; span: number; label: string; key: string }[] = [];
    let i = 0;
    while (i < days.length) {
      const d = days[i]!.date;
      const key = d.getUTCFullYear() + '-' + d.getUTCMonth();
      let j = i + 1;
      while (j < days.length) {
        const dj = days[j]!.date;
        if (dj.getUTCFullYear() + '-' + dj.getUTCMonth() !== key) break;
        j++;
      }
      out.push({ from: i, span: j - i, label: formatMonth(d, config.locale, 'short'), key });
      i = j;
    }
    return out;
  });

  // Every visible feed merged (the week grid has no per-feed rows). Matches the
  // timeline's visibility rule: time-limit-hidden events drop, but Hidden-style
  // events still render as a faint placeholder.
  const visibleEvents = $derived.by<DisplayEvent[]>(() => {
    const out: DisplayEvent[] = [];
    for (const feed of config.feeds) {
      if (feed.hidden) continue;
      for (const e of displayEventsFor(feed.id)) {
        if (e.hidden && e.styleVariant !== 'hidden') continue;
        out.push(e);
      }
    }
    return out;
  });

  const matchUids = $derived(getMatchUids());
  const currentMatchUid = $derived(getCurrentMatchUid());

  type TimedBlock = {
    ev: DisplayEvent;
    startMin: number;
    endMin: number;
    lane: number;
    laneCount: number;
  };

  // Timed events grouped into their start day's column, then packed into
  // side-by-side sub-columns by their [startMin, endMin) overlap. Overnight
  // events are clipped to the start column's midnight (continuation noted as a
  // future enhancement).
  const timedByDay = $derived.by<TimedBlock[][]>(() => {
    const cols: { ev: DisplayEvent; startMin: number; endMin: number }[][] = Array.from(
      { length: RENDERED_DAYS },
      () => [],
    );
    for (const ev of visibleEvents) {
      if (ev.allDay) continue;
      const idx = colIndexOf(ev.start);
      if (idx < 0 || idx >= RENDERED_DAYS) continue;
      const startMin = zonedParts(ev.start, tzTop).minutes;
      const sameDay = colIndexOf(ev.end) === idx;
      let endMin = sameDay ? zonedParts(ev.end, tzTop).minutes : 1440;
      if (endMin < startMin) endMin = 1440; // overnight / malformed → clip to midnight
      cols[idx]!.push({ ev, startMin, endMin });
    }
    return cols.map((items) => {
      const { packed, laneCount } = packLanes(items);
      return packed.map(({ item, lane }) => ({
        ev: item.ev,
        startMin: item.startMin,
        endMin: item.endMin,
        lane,
        laneCount,
      }));
    });
  });

  function blockPlacement(b: TimedBlock): string {
    const top = (b.startMin / 60) * HOUR_H;
    const height = Math.max(MIN_BLOCK_H, ((b.endMin - b.startMin) / 60) * HOUR_H);
    const width = 100 / b.laneCount;
    const left = b.lane * width;
    return `top:${top}px; height:${height}px; left:${left}%; width:${width}%;`;
  }

  // All-day events span the (UTC) day columns they cover, clamped to the window,
  // and stack into rows so concurrent ones don't overlap.
  const allDayLayout = $derived.by(() => {
    const items: { from: number; span: number; ev: DisplayEvent; startMin: number; endMin: number }[] = [];
    for (const ev of visibleEvents) {
      if (!ev.allDay) continue;
      const startIdx = utcColIndexOf(ev.start);
      const lastIdx = utcColIndexOf(new Date(Math.max(ev.start.getTime(), ev.end.getTime() - 1)));
      if (lastIdx < 0 || startIdx >= RENDERED_DAYS) continue;
      const from = Math.max(0, startIdx);
      const to = Math.min(RENDERED_DAYS - 1, lastIdx);
      items.push({ from, span: to - from + 1, ev, startMin: from, endMin: to + 1 });
    }
    const { packed, laneCount } = packLanes(items);
    const rows = packed.map(({ item, lane }) => ({ ev: item.ev, from: item.from, span: item.span, lane }));
    return { rows, laneCount };
  });

  const allDayHeight = $derived(Math.max(1, allDayLayout.laneCount) * ALLDAY_ROW_H);

  function allDayPlacement(r: { from: number; span: number; lane: number }): string {
    const left = (r.from / RENDERED_DAYS) * 100;
    const width = (r.span / RENDERED_DAYS) * 100;
    const top = r.lane * ALLDAY_ROW_H;
    return `top:${top}px; height:${ALLDAY_ROW_H - 1}px; left:${left}%; width:${width}%;`;
  }

  const morningMin = $derived(dayLimitMinutes(config.morningLimit, 8 * 60));
  const eveningMin = $derived(dayLimitMinutes(config.eveningLimit, 20 * 60));
  const morningTop = $derived((morningMin / 60) * HOUR_H);
  const eveningTop = $derived((eveningMin / 60) * HOUR_H);

  // Per-gutter-column metadata: the signed diff-from-local label (e.g. "+7", "−5",
  // blank when the zone is local), the hour offset from the primary zone (for the
  // hour labels), the current day/night state, and a full-name tooltip.
  const tzCols = $derived.by(() => {
    const at = new Date(clock.now);
    const primOff = offsetMinutes(tzTop, at, config.dst) ?? 0;
    return tzZones.map((tz) => {
      const off = offsetMinutes(tz, at, config.dst) ?? primOff;
      const diff = formatTzDiff(tz, config.timezone, at, config.dst);
      return {
        tz,
        diffLabel: diff, // already '' when equal to local, signed otherwise
        title: formatTimezoneLabel(tz, config.dst),
        offsetFromPrimary: off - primOff,
        isDay: isDaylight(tz, at, morningMin, eveningMin),
      };
    });
  });

  function hourLabel(totalMin: number): string {
    const m = (((totalMin % 1440) + 1440) % 1440) | 0;
    const h = Math.floor(m / 60);
    const min = m % 60;
    if (config.timeFormat === '12h') {
      const ampm = h < 12 ? 'a' : 'p';
      let h12 = h % 12;
      if (h12 === 0) h12 = 12;
      return min ? `${h12}:${pad(min)}${ampm}` : `${h12}${ampm}`;
    }
    return min ? `${pad(h)}:${pad(min)}` : pad(h);
  }

  const hours = $derived(Array.from({ length: 24 }, (_, h) => h));

  // Hour gridlines as a repeating gradient — one line per hour — plus a night
  // tint outside the morning→evening working window, layered over the gridlines.
  const gridLines = $derived(
    `repeating-linear-gradient(to bottom, var(--ink-faint) 0, var(--ink-faint) var(--border-w), transparent var(--border-w), transparent ${HOUR_H}px)`,
  );
  const nightShade = $derived(
    `linear-gradient(to bottom, var(--wg-night) 0, var(--wg-night) ${morningTop}px, transparent ${morningTop}px, transparent ${eveningTop}px, var(--wg-night) ${eveningTop}px, var(--wg-night) ${bodyH}px)`,
  );
  const dayColBg = $derived(`${nightShade}, ${gridLines}`);

  // Live now-line position, in primary-zone minutes. Shown only while today's
  // column is within the rendered window (it leaves when scrolled far away).
  const nowMin = $derived(zonedParts(new Date(clock.now), tzTop).minutes);
  const nowTop = $derived((nowMin / 60) * HOUR_H);
  const nowMs = $derived(clock.now);
  const todayInWindow = $derived(startOffset <= 0 && 0 < startOffset + RENDERED_DAYS);

  // One-shot open scroll: vertically to working hours (or the current hour if
  // later), horizontally to today's column at the day-area's left edge. Guarded
  // so it never fights the user's own scrolling afterwards.
  let scrollBody: HTMLElement | undefined = $state();
  let didScroll = false;
  $effect(() => {
    if (didScroll || !scrollBody || viewW <= 0) return;
    const cur = zonedParts(new Date(clock.now), tzTop).minutes;
    const targetMin = Math.max(morningMin, cur);
    // Lead in by one hour so the target row isn't flush against the sticky header.
    scrollBody.scrollTop = Math.max(0, (targetMin / 60) * HOUR_H - HOUR_H);
    // Today's column sits at index -startOffset; put it at the day-area's edge.
    scrollBody.scrollLeft = -startOffset * dayW;
    didScroll = true;
  });

  // Continuous scroll: slide the rendered window when the viewport nears either
  // edge, compensating scrollLeft by the same amount. Because the rendered column
  // count (and so the content width) is invariant, the compensation keeps the
  // exact pixels under the viewport — no visual jump — while making more days
  // available to scroll into. rAF-throttled with a single-flight guard.
  $effect(() => {
    const el = scrollBody;
    if (!el) return;
    let raf = 0;
    const onScroll = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (viewW <= 0 || dayW <= 0) return;
        const areaW = RENDERED_DAYS * dayW;
        const viewDayW = el.clientWidth - gutterW;
        const buffer = 7 * dayW;
        if (el.scrollLeft + viewDayW > areaW - buffer) {
          startOffset += SHIFT_DAYS;
          el.scrollLeft -= SHIFT_DAYS * dayW;
        } else if (el.scrollLeft < buffer) {
          startOffset -= SHIFT_DAYS;
          el.scrollLeft += SHIFT_DAYS * dayW;
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
  });

  const dayCols = $derived(`repeat(${RENDERED_DAYS}, ${dayW}px)`);
  const tzGridCols = $derived(`repeat(${numTz}, ${GUTTER_W}px)`);
</script>

<div
  class="week-grid"
  style="--wg-header-h: {headerH}px; --tier-q-h: {TIER_Q_H}px; --tier-m-h: {TIER_M_H}px; height: calc(100dvh - var(--toolbar-h) - {search.open
    ? 'var(--toolbar-h)'
    : '0px'});"
>
  <!-- Each row is a flex pair [frozen-left | scrolling day-area]; the frozen
       left is position:sticky;left:0 so its containing block is the full-width
       row and it stays pinned across the whole horizontal scroll. -->
  <div class="wg-scroll" bind:this={scrollBody} bind:clientWidth={viewW}>
    <!-- Tiered day headers (sticky top): Quarter+Year, Month, Date (1M style).
         The corner shows each gutter zone's difference from local. -->
    <div class="wg-header" style="width: {contentW}px;">
      <div class="wg-corner" style="width: {gutterW}px; grid-template-columns: {tzGridCols};">
        {#each tzCols as c (c.tz)}
          <span class="wg-tz" title={c.title} data-mono>{c.diffLabel}</span>
        {/each}
      </div>
      <div class="wg-header-tiers" style="width: {daysW}px;">
        <div class="wg-tier wg-tier-q">
          {#each quarterBands as b (b.key)}
            <div class="wg-band" style="width: {b.span * dayW}px;">
              <span class="wg-band-label" style="left: {gutterW}px;">{b.label}</span>
            </div>
          {/each}
        </div>
        <div class="wg-tier wg-tier-m">
          {#each monthBands as b (b.key)}
            <div class="wg-band wg-band-month" style="width: {b.span * dayW}px;">
              <span class="wg-band-label" style="left: {gutterW}px;">{b.label}</span>
            </div>
          {/each}
        </div>
        <div class="wg-tier wg-tier-d" style="grid-template-columns: {dayCols};">
          {#each days as d, i (i)}
            <div
              class="wg-datecell"
              data-current={d.isToday ? 'true' : null}
              data-weekend={d.weekend ? 'true' : null}
            >
              <span class="wg-dl">{d.initial}</span>
              <span class="wg-dn" data-mono>{d.num}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- All-day strip (sticky, below the headers); the corner shows each zone's
         current day/night glyph instead of an "all-day" title. -->
    <div class="wg-allday" style="width: {contentW}px; top: var(--wg-header-h);">
      <div class="wg-corner wg-allday-corner" style="width: {gutterW}px; grid-template-columns: {tzGridCols};">
        {#each tzCols as c (c.tz)}
          <span class="wg-daynight" title={c.title}><Icon name={c.isDay ? 'sun' : 'moon'} size={12} /></span>
        {/each}
      </div>
      <div class="wg-allday-area" style="width: {daysW}px; height: {allDayHeight}px;">
        {#each allDayLayout.rows as r (r.ev.uid)}
          <WeekEvent
            event={r.ev}
            tz={tzTop}
            feedColor={feedsById[r.ev.feedId]?.color}
            feedStyle={feedsById[r.ev.feedId]?.style}
            mode="bar"
            isMatch={matchUids.has(r.ev.uid)}
            isCurrent={currentMatchUid === r.ev.uid}
            isPast={r.ev.end.getTime() < nowMs}
            placement={allDayPlacement(r)}
          />
        {/each}
      </div>
    </div>

    <!-- Scrollable hour grid -->
    <div class="wg-body" style="width: {contentW}px; height: {bodyH}px;">
      <!-- Timezone label columns (frozen left), one per shown zone -->
      <div class="wg-gutter-group" style="width: {gutterW}px; grid-template-columns: {tzGridCols};">
        {#each tzCols as c, ci (c.tz)}
          <div class="wg-gutter" data-div={ci < numTz - 1 ? 'true' : null}>
            {#each hours as h (h)}
              <span class="wg-hour" data-mono style="top: {h * HOUR_H}px;"
                >{hourLabel(h * 60 + c.offsetFromPrimary)}</span
              >
            {/each}
            {#if ci === 0}
              <!-- Morning / evening working-hours boundary markers -->
              <span class="wg-limit" style="top: {morningTop}px;" aria-hidden="true">
                <Icon name="sun" size={11} />
              </span>
              <span class="wg-limit" style="top: {eveningTop}px;" aria-hidden="true">
                <Icon name="moon" size={11} />
              </span>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Day columns -->
      <div class="wg-days" style="grid-template-columns: {dayCols};">
        {#each days as d, i (i)}
          <div
            class="wg-daycol"
            data-current={d.isToday ? 'true' : null}
            style="background-image: {dayColBg};"
          >
            {#each timedByDay[i] ?? [] as b (b.ev.uid)}
              <WeekEvent
                event={b.ev}
                tz={tzTop}
                feedColor={feedsById[b.ev.feedId]?.color}
                feedStyle={feedsById[b.ev.feedId]?.style}
                isMatch={matchUids.has(b.ev.uid)}
                isCurrent={currentMatchUid === b.ev.uid}
                isPast={b.ev.end.getTime() < nowMs}
                placement={blockPlacement(b)}
              />
            {/each}
            {#if d.isToday}
              <i class="wg-now-dot" style="top: {nowTop}px;" aria-hidden="true"></i>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Live now-line across the day area (only while today is in the window) -->
      {#if todayInWindow}
        <i class="wg-now-line" style="top: {nowTop}px; left: {gutterW}px;" aria-hidden="true"></i>
      {/if}
    </div>
  </div>
</div>

<style>
  .week-grid {
    --wg-night: rgba(10, 10, 10, 0.05);
    display: flex;
    flex-direction: column;
    /* height is set inline so it can subtract the search toolbar when open. */
    border-top: var(--border-w) solid var(--ink);
    background: var(--paper);
    box-sizing: border-box;
    overflow: hidden;
  }
  :global([data-theme='dark']) .week-grid {
    --wg-night: rgba(0, 0, 0, 0.22);
  }
  .wg-scroll {
    flex: 1;
    /* Scrolls both axes: vertically through the hours, horizontally through the
       days. The hour gutters pin left, the day headers / all-day strip pin top. */
    overflow: auto;
    scrollbar-width: thin;
    overscroll-behavior: contain;
  }

  /* Header text (tiers + gutter labels) is structural, not content — keep it
     unselectable so dragging across the grid doesn't highlight it. */
  .wg-header,
  .wg-allday-corner,
  .wg-gutter-group {
    user-select: none;
    -webkit-user-select: none;
  }

  .wg-header {
    position: sticky;
    top: 0;
    z-index: 7;
    display: flex;
    height: var(--wg-header-h);
    background: var(--paper);
    border-bottom: var(--border-w) solid var(--ink);
  }
  .wg-corner {
    position: sticky;
    left: 0;
    z-index: 1;
    flex: 0 0 auto;
    display: grid;
    box-sizing: border-box;
    background: var(--paper);
    border-right: var(--border-w) solid var(--ink);
  }
  .wg-tz {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-10);
    line-height: 1;
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
  }
  .wg-tz:not(:first-child),
  .wg-daynight:not(:first-child) {
    border-left: var(--border-w) solid var(--ink-faint);
  }

  .wg-header-tiers {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
  }
  .wg-tier {
    display: flex;
  }
  .wg-tier-q {
    height: var(--tier-q-h, 16px);
  }
  .wg-tier-m {
    height: var(--tier-m-h, 16px);
  }
  .wg-tier-q,
  .wg-tier-m {
    border-bottom: var(--border-w) solid var(--ink-faint);
  }
  .wg-tier-d {
    display: grid;
    flex: 1 1 auto;
  }
  .wg-band {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    border-left: var(--border-w) solid var(--ink);
    font-size: var(--fs-11);
    line-height: 1;
    color: var(--ink);
    white-space: nowrap;
  }
  /* The label sticks just past the frozen gutter so it stays visible while its
     band scrolls horizontally (mirrors the timeline header's sticky labels). */
  .wg-band-label {
    position: sticky;
    padding: 0 4px;
    white-space: nowrap;
  }
  .wg-tier-q .wg-band {
    font-weight: 700;
    font-size: var(--fs-12);
  }
  .wg-band-month .wg-band-label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .wg-datecell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    box-sizing: border-box;
    border-left: var(--border-w) solid var(--ink-faint);
  }
  .wg-datecell[data-weekend='true'] {
    background: var(--weekend-bg);
  }
  .wg-dl,
  .wg-dn {
    font-size: var(--fs-10);
    line-height: 1;
    color: var(--ink);
  }
  .wg-datecell[data-weekend='true'] .wg-dl,
  .wg-datecell[data-weekend='true'] .wg-dn {
    color: var(--ink-muted);
  }
  .wg-datecell[data-current='true'] .wg-dl,
  .wg-datecell[data-current='true'] .wg-dn {
    color: var(--accent);
    font-weight: 700;
  }

  .wg-allday {
    position: sticky;
    z-index: 6;
    display: flex;
    background: var(--paper);
    border-bottom: var(--border-w) solid var(--ink);
  }
  .wg-allday-corner {
    z-index: 1;
  }
  .wg-daynight {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-muted);
  }
  .wg-allday-area {
    position: relative;
    flex: 0 0 auto;
    min-height: 100%;
  }

  .wg-body {
    position: relative;
    display: flex;
  }
  .wg-gutter-group {
    position: sticky;
    left: 0;
    z-index: 4;
    flex: 0 0 auto;
    display: grid;
    box-sizing: border-box;
    background: var(--paper);
    border-right: var(--border-w) solid var(--ink);
  }
  .wg-gutter {
    position: relative;
  }
  .wg-gutter[data-div='true'] {
    border-right: var(--border-w) solid var(--ink-faint);
  }
  .wg-hour {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    transform: translateY(-50%);
    font-size: var(--fs-10);
    line-height: 1;
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .wg-limit {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    transform: translateY(-50%);
    color: var(--ink-muted);
    pointer-events: none;
  }
  .wg-days {
    display: grid;
    flex: 0 0 auto;
  }
  .wg-daycol {
    position: relative;
    border-left: var(--border-w) solid var(--ink-faint);
    background-repeat: repeat;
  }
  .wg-daycol[data-current='true'] {
    background-color: color-mix(in srgb, var(--accent) 5%, transparent);
  }

  .wg-now-line {
    position: absolute;
    right: 0;
    height: 0;
    border-top: 2px solid var(--accent);
    pointer-events: none;
    z-index: 3;
  }
  .wg-now-dot {
    position: absolute;
    left: -4px;
    width: 8px;
    height: 8px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--accent);
    pointer-events: none;
    z-index: 3;
  }
</style>
