<script lang="ts">
  import WeekEvent from './WeekEvent.svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import { config, search, ui, displayEventsFor, isKiosk } from '../lib/state.svelte';
  import { getMatchUids, getCurrentMatchUid } from '../lib/search-state.svelte';
  import { clock } from '../lib/clock.svelte';
  import {
    zonedParts,
    dayLimitMinutes,
    offsetMinutes,
    formatTime,
    formatTimezoneLabel,
    tzCountryCode,
    resolveLocalTz,
    isDaylight,
    formatDayInitial,
    formatMonth,
    isWeekend,
  } from '../lib/format';
  import { effectiveBlock, hatchDensity, dayKeyOf, eventDayKeys } from '../lib/blocking';
  import { packLanes } from '../lib/layout';
  import { MS_PER_DAY, formatTier, isoWeekNumber } from '../lib/time';
  import { pinchZoom } from '../lib/pinch';
  import type { CalendarFeed, DisplayEvent } from '../lib/types';
  import { untrack } from 'svelte';

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
  // Hour rows ~20% taller than the prior compact height, times the user's
  // vertical-zoom setting (pinch / Ctrl+wheel adjust config.weekHourScale).
  const HOUR_H = $derived(Math.round(22 * 1.2 * fontScale * config.weekHourScale));
  // Narrow hour-label columns (one per shown timezone, left gutter).
  const GUTTER_W = $derived(Math.round(22 * fontScale));
  // Day columns floor low enough that a full week fits on a vertical phone.
  const MIN_DAY_W = $derived(Math.round(44 * fontScale));
  const ALLDAY_ROW_H = $derived(Math.round(20 * fontScale));
  // Top padding in the all-day strip, matching the inter-bar gap.
  const ALLDAY_PAD = 1;
  // Gap above & below the hour grid so the 00:00 / 23:00 labels aren't clipped;
  // the day-column separators continue through it as dashed lines.
  const BODY_PAD = $derived(Math.round(7 * fontScale));
  const MIN_BLOCK_H = 14;
  const bodyH = $derived(24 * HOUR_H);

  // Header tiers (Quarter+Year, Month, Week, Date) sized to match the timeline
  // header — Quarter row ≈ the timeline's date-tier height, fs-12 bold.
  const TIER_Q_H = $derived(Math.round(21 * fontScale));
  const TIER_M_H = $derived(Math.round(18 * fontScale));
  const TIER_W_H = $derived(Math.round(18 * fontScale));
  const TIER_D_H = $derived(Math.round(28 * fontScale));
  const headerH = $derived(TIER_Q_H + TIER_M_H + TIER_W_H + TIER_D_H);

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
  // Week-number tier: group days by their ISO week (Monday-anchored), labelled
  // "W NN" like the timeline's week tier.
  const weekBands = $derived.by(() => {
    const out: { from: number; span: number; label: string; key: string }[] = [];
    const mondayOf = (d: Date): number => d.getTime() - ((d.getUTCDay() || 7) - 1) * MS_PER_DAY;
    let i = 0;
    while (i < days.length) {
      const d0 = days[i]!.date;
      const key = mondayOf(d0);
      let j = i + 1;
      while (j < days.length && mondayOf(days[j]!.date) === key) j++;
      out.push({ from: i, span: j - i, label: 'W ' + isoWeekNumber(d0), key: String(key) });
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

  // Day-blocking hatch: in 1W (a single merged surface) both global and local
  // blocks hatch the whole day, so collapse them into thick/thin day-key sets —
  // same classification as the timeline (shared helpers in lib/blocking).
  const blockedDays = $derived.by(() => {
    const thick = new Set<string>();
    const thin = new Set<string>();
    for (const feed of config.feeds) {
      if (feed.hidden) continue;
      for (const ev of displayEventsFor(feed.id)) {
        if (effectiveBlock(ev, feed) === 'none') continue;
        const density = hatchDensity(ev, feed);
        if (density === 'none') continue;
        const set = density === 'thick' ? thick : thin;
        for (const k of eventDayKeys(ev)) set.add(k);
      }
    }
    return { thick, thin };
  });
  function dayBlock(date: Date): 'thick' | 'thin' | null {
    const k = dayKeyOf(date);
    if (blockedDays.thick.has(k)) return 'thick';
    if (blockedDays.thin.has(k)) return 'thin';
    return null;
  }

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

  function blockHeightPx(b: TimedBlock): number {
    return Math.max(MIN_BLOCK_H, ((b.endMin - b.startMin) / 60) * HOUR_H);
  }
  function blockPlacement(b: TimedBlock): string {
    const top = (b.startMin / 60) * HOUR_H;
    const height = blockHeightPx(b);
    const width = 100 / b.laneCount;
    const left = b.lane * width;
    return `top:${top}px; height:${height}px; left:${left}%; width:${width}%;`;
  }
  // A block shorter than two text lines can't fit a time line under the title.
  const TIME_MIN_H = $derived(Math.round(30 * fontScale));

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

  const allDayHeight = $derived(Math.max(1, allDayLayout.laneCount) * ALLDAY_ROW_H + ALLDAY_PAD);

  function allDayPlacement(r: { from: number; span: number; lane: number }): string {
    const left = (r.from / RENDERED_DAYS) * 100;
    const width = (r.span / RENDERED_DAYS) * 100;
    const top = r.lane * ALLDAY_ROW_H + ALLDAY_PAD;
    return `top:${top}px; height:${ALLDAY_ROW_H - 1}px; left:${left}%; width:${width}%;`;
  }

  const morningMin = $derived(dayLimitMinutes(config.morningLimit, 8 * 60));
  const eveningMin = $derived(dayLimitMinutes(config.eveningLimit, 20 * 60));
  const morningTop = $derived((morningMin / 60) * HOUR_H);
  const eveningTop = $derived((eveningMin / 60) * HOUR_H);

  // Per-gutter-column metadata: a 2-letter ISO country code (always shown), the
  // hour offset from the primary zone (for the hour labels), the current day/night
  // state, the live current time in that zone, and a full-name tooltip.
  // Wrap a minute-of-day into [0,1440) → its y on the primary axis.
  function topForMin(min: number): number {
    return ((((min % 1440) + 1440) % 1440) / 60) * HOUR_H;
  }
  const tzCols = $derived.by(() => {
    const at = new Date(clock.now);
    const primOff = offsetMinutes(tzTop, at, config.dst) ?? 0;
    return tzZones.map((tz) => {
      const off = offsetMinutes(tz, at, config.dst) ?? primOff;
      const offsetFromPrimary = off - primOff;
      return {
        tz,
        code: tzCountryCode(tz),
        title: formatTimezoneLabel(tz, config.dst),
        offsetFromPrimary,
        isDay: isDaylight(tz, at, morningMin, eveningMin),
        isLocal: tz === localTz,
        nowTime: formatTime(at, config.timeFormat, tz),
        // This zone's working-hours edges, mapped onto the primary axis.
        morningTopP: topForMin(morningMin - offsetFromPrimary),
        eveningTopP: topForMin(eveningMin - offsetFromPrimary),
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
  // Weekdays show the day/night working-hours split; weekends are off, so the
  // whole column is tinted (no working-hours window).
  const weekdayBg = $derived(`${nightShade}, ${gridLines}`);
  const weekendBg = $derived(`linear-gradient(var(--wg-night), var(--wg-night)), ${gridLines}`);

  // Live now-line position, in primary-zone minutes. Shown only while today's
  // column is within the rendered window (it leaves when scrolled far away).
  const nowMin = $derived(zonedParts(new Date(clock.now), tzTop).minutes);
  const nowTop = $derived((nowMin / 60) * HOUR_H);
  const nowMs = $derived(clock.now);
  const todayInWindow = $derived(startOffset <= 0 && 0 < startOffset + RENDERED_DAYS);

  // Temporary day marker, reusing the global ui.tempMarkerMs (UTC-midnight ms)
  // that the timeline and the #d= URL hash already drive. Set/cleared by clicking
  // a date-header cell; rendered as a vertical accent band on its column.
  const markerMs = $derived(ui.tempMarkerMs);
  const markerOffset = $derived(
    markerMs == null ? null : Math.round((markerMs - primaryTodayMs) / MS_PER_DAY),
  );
  const markerCol = $derived(markerOffset == null ? null : markerOffset - startOffset);
  const markerInWindow = $derived(markerCol != null && markerCol >= 0 && markerCol < RENDERED_DAYS);
  const markerLeft = $derived(markerCol == null ? 0 : gutterW + markerCol * dayW);

  function toggleTempDay(date: Date): void {
    const ms = date.getTime(); // date is the column's UTC-midnight anchor
    ui.tempMarkerMs = ui.tempMarkerMs === ms ? null : ms;
  }

  // Open scroll: vertically to working hours (or the current hour if later),
  // horizontally to today's (or the temp marker's) column at the day-area's left
  // edge. Re-asserted until the user first interacts, because `dayW` is measured
  // from the viewport one frame after mount — a one-shot would latch on the
  // pre-measure MIN_DAY_W and land the target off-screen once the columns widen.
  let scrollBody: HTMLElement | undefined = $state();
  let userInteracted = $state(false);
  // After this long with no interaction, gently re-scroll vertically to the
  // current hour (mirrors the timeline's idle re-centre). Horizontal position
  // is left alone — the user may be reading a different week.
  const IDLE_RECENTER_MS = 5 * 60 * 1000;
  function recenterVertical(): void {
    if (!scrollBody || !todayInWindow) return;
    const cur = zonedParts(new Date(clock.now), tzTop).minutes;
    const top = Math.max(0, (cur / 60) * HOUR_H - HOUR_H);
    scrollBody.scrollTo({ top, behavior: smoothBehavior() });
  }
  $effect(() => {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const armIdle = (): void => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(recenterVertical, IDLE_RECENTER_MS);
    };
    const stop = (): void => {
      userInteracted = true;
      armIdle();
    };
    window.addEventListener('pointerdown', stop, { passive: true });
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    armIdle();
    return () => {
      if (idle) clearTimeout(idle);
      window.removeEventListener('pointerdown', stop);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
  });
  // Jump back to today's column (e.g. double-tapping the 1W toolbar button,
  // which also clears the marker). Mirrors the timeline's cal:jump-today.
  $effect(() => {
    const onJump = (): void => {
      jumpToOffset(0);
      toggleLast = 'today';
    };
    window.addEventListener('cal:jump-today', onJump);
    return () => window.removeEventListener('cal:jump-today', onJump);
  });
  $effect(() => {
    // Re-run when the measured width (and so dayW) changes; ignore clock ticks.
    void dayW;
    void viewW;
    if (!scrollBody || viewW <= 0) return;
    untrack(() => {
      if (userInteracted) return;
      const cur = zonedParts(new Date(clock.now), tzTop).minutes;
      const targetMin = Math.max(morningMin, cur);
      // Open on the temp-marker day if one is set (e.g. carried over from
      // another zoom), otherwise today; place it at the day-area's left edge.
      const targetOff = markerOffset ?? 0;
      if (targetOff - startOffset < 0 || targetOff - startOffset > RENDERED_DAYS - 1) {
        startOffset = targetOff - INITIAL_PAST;
      }
      // Lead in by one hour so the target row isn't flush against the header.
      const wantTop = Math.max(0, (targetMin / 60) * HOUR_H - HOUR_H);
      const wantLeft = (targetOff - startOffset) * dayW;
      // Re-apply across a few frames: on the mount/zoom-switch flush the day
      // columns' full width hasn't laid out yet, so a single assignment gets
      // clamped to the partial scrollWidth. Re-asserting until the value sticks
      // (or the user scrolls) lands the target once the content is final.
      let frames = 0;
      const apply = (): void => {
        if (userInteracted || !scrollBody) return;
        scrollBody.scrollTop = wantTop;
        scrollBody.scrollLeft = wantLeft;
        if (Math.abs(scrollBody.scrollLeft - wantLeft) > 1 && frames++ < 20) {
          requestAnimationFrame(apply);
        }
      };
      apply();
      toggleLast = markerOffset != null ? 'temp' : 'today';
    });
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

  // Honour the Reduced-motion setting: an explicit behavior:'smooth' in JS
  // overrides the CSS scroll-behavior the reduced-motion stylesheet forces to
  // auto, so the programmatic scrolls must opt out themselves. App.svelte sets
  // data-motion="reduced" on <html>; fall back to the OS preference.
  function smoothBehavior(): ScrollBehavior {
    if (typeof document !== 'undefined') {
      const m = document.documentElement.getAttribute('data-motion');
      if (m === 'reduced') return 'auto';
      if (m === 'full') return 'smooth';
    }
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 'auto';
    }
    return 'smooth';
  }

  // Scroll the day area so the column at day-offset `off` (0 = today) sits at the
  // left edge; re-anchor the window first if the target isn't currently rendered.
  function jumpToOffset(off: number): void {
    if (!scrollBody) return;
    if (off - startOffset < 0 || off - startOffset > RENDERED_DAYS - 1) {
      startOffset = off - INITIAL_PAST;
    }
    const col = off - startOffset;
    scrollBody.scrollTo({ left: Math.max(0, col * dayW), behavior: smoothBehavior() });
  }
  let toggleLast: 'today' | 'temp' = $state('today');
  function toggleTempMarker(): void {
    if (markerOffset == null) return;
    const target = toggleLast === 'today' ? markerOffset : 0;
    toggleLast = toggleLast === 'today' ? 'temp' : 'today';
    jumpToOffset(target);
  }

  // Hover crosshair: with a mouse, a faint horizontal line tracks the cursor's
  // height across the day area, and the gutter shows the exact time at that row.
  // Touch leaves it null (no hover), so it's mouse-only.
  let hoverMin: number | null = $state(null);
  const hoverTop = $derived(hoverMin == null ? 0 : (hoverMin / 60) * HOUR_H);
  function onGridHover(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    hoverMin = Math.max(0, Math.min(1440, (y / HOUR_H) * 60));
  }
  function clearHover(): void {
    hoverMin = null;
  }

  // Vertical zoom: pinch (touch) or Ctrl/⌘+wheel (desktop) grows/shrinks the
  // hour rows, persisted in config.weekHourScale. Clamped to a legible range.
  function bumpHourScale(delta: number): void {
    const next = Math.min(2, Math.max(0.6, Math.round((config.weekHourScale + delta) * 100) / 100));
    config.weekHourScale = next;
  }
  function onGridWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    bumpHourScale(e.deltaY < 0 ? 0.1 : -0.1);
  }

  // Clicking empty space in a day column opens the Add-event modal prefilled to
  // that day and the clicked time (snapped to 15 min). Clicks on an event fall
  // through to the event's own handler.
  function onGridCreate(e: MouseEvent): void {
    if (isKiosk() || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.wg-event')) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / dayW);
    const d = days[col];
    if (!d) return;
    const rawMin = ((e.clientY - rect.top) / HOUR_H) * 60;
    const min = Math.max(0, Math.min(1425, Math.round(rawMin / 15) * 15));
    const dt = d.date; // UTC-midnight anchor of the primary-zone calendar day
    ui.addEventPrefillStartMs = new Date(
      dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(),
      Math.floor(min / 60), min % 60, 0, 0,
    ).getTime();
    ui.addEventOpen = true;
  }

  const dayCols = $derived(`repeat(${RENDERED_DAYS}, ${dayW}px)`);
  const tzGridCols = $derived(`repeat(${numTz}, ${GUTTER_W}px)`);
</script>

<div
  class="week-grid"
  style="--wg-header-h: {headerH}px; --tier-q-h: {TIER_Q_H}px; --tier-m-h: {TIER_M_H}px; --tier-w-h: {TIER_W_H}px; --wg-body-pad: {BODY_PAD}px; height: calc(100dvh - var(--toolbar-h) - {search.open
    ? 'var(--toolbar-h)'
    : '0px'});"
>
  <!-- Each row is a flex pair [frozen-left | scrolling day-area]; the frozen
       left is position:sticky;left:0 so its containing block is the full-width
       row and it stays pinned across the whole horizontal scroll. -->
  <div
    class="wg-scroll"
    bind:this={scrollBody}
    bind:clientWidth={viewW}
    onwheel={onGridWheel}
    use:pinchZoom={{ onZoomIn: () => bumpHourScale(0.15), onZoomOut: () => bumpHourScale(-0.15) }}
  >
    <!-- Tiered day headers (sticky top): Quarter+Year, Month, Date (1M style).
         The corner shows each gutter zone's 2-letter ISO country code. -->
    <div class="wg-header" style="width: {contentW}px;">
      <div class="wg-corner" style="width: {gutterW}px; grid-template-columns: {tzGridCols};">
        {#each tzCols as c (c.tz)}
          <span class="wg-tz" title={c.title}>{c.code}</span>
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
        <div class="wg-tier wg-tier-w">
          {#each weekBands as b (b.key)}
            <div class="wg-band" style="width: {b.span * dayW}px;">
              <span class="wg-band-label" style="left: {gutterW}px;">{b.label}</span>
            </div>
          {/each}
        </div>
        <div class="wg-tier wg-tier-d" style="grid-template-columns: {dayCols};">
          {#each days as d, i (i)}
            {@const blk = dayBlock(d.date)}
            <button
              type="button"
              class="wg-datecell"
              data-current={d.isToday ? 'true' : null}
              data-weekend={d.weekend ? 'true' : null}
              data-temp={markerMs != null && markerMs === d.date.getTime() ? 'true' : null}
              data-holiday={blk === 'thick' ? 'true' : null}
              data-observance={blk === 'thin' ? 'true' : null}
              title="Set or clear the day marker"
              onclick={() => toggleTempDay(d.date)}
            >
              <span class="wg-dl">{d.initial}</span>
              <span class="wg-dn" data-mono>{d.num}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- All-day strip (sticky, below the headers); the corner shows each zone's
         current day/night glyph instead of an "all-day" title. -->
    <div class="wg-allday" style="width: {contentW}px; top: var(--wg-header-h);">
      <div class="wg-corner wg-allday-corner" style="width: {gutterW}px;"></div>
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
    <div class="wg-body" style="width: {contentW}px; height: {bodyH}px; margin-top: {BODY_PAD}px;">
      <!-- Timezone label columns (frozen left), one per shown zone -->
      <div class="wg-gutter-group" style="width: {gutterW}px; grid-template-columns: {tzGridCols};">
        {#if hoverMin != null}
          <span class="wg-hover-time" data-mono style="top: {hoverTop}px;" aria-hidden="true"
            >{hourLabel(hoverMin)}</span
          >
        {/if}
        {#each tzCols as c, ci (c.tz)}
          <div class="wg-gutter" data-div={ci < numTz - 1 ? 'true' : null}>
            {#each hours as h (h)}
              <span class="wg-hour" data-mono style="top: {h * HOUR_H}px;"
                >{hourLabel(h * 60 + c.offsetFromPrimary)}</span
              >
            {/each}
            <!-- This zone's morning / evening working-hours day/night markers -->
            <span class="wg-limit" style="top: {c.morningTopP}px;" aria-hidden="true">
              <Icon name="sun" size={11} />
            </span>
            <span class="wg-limit" style="top: {c.eveningTopP}px;" aria-hidden="true">
              <Icon name="moon" size={11} />
            </span>
            <!-- Live current time, only in the local zone, aligned with the now-line. -->
            {#if c.isLocal}
              <span class="wg-now-time" data-mono style="top: {nowTop}px;">{c.nowTime}</span>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Day columns. The click-to-create / hover crosshair are pointer-only
           affordances; keyboard users navigate events (arrow keys) and use the
           toolbar's Add button, so the a11y interaction rules don't apply. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="wg-days"
        style="grid-template-columns: {dayCols};"
        onpointermove={onGridHover}
        onpointerleave={clearHover}
        onclick={onGridCreate}
      >
        {#each days as d, i (i)}
          {@const blk = dayBlock(d.date)}
          <div
            class="wg-daycol"
            data-current={d.isToday ? 'true' : null}
            style="background-image: {d.weekend ? weekendBg : weekdayBg};"
          >
            {#if blk}
              <i class="wg-block" data-density={blk} aria-hidden="true"></i>
            {/if}
            {#if !d.weekend}
              <!-- Primary-zone working-hours edges, in the off-hours tone. -->
              <i class="wg-edge" style="top: {morningTop}px;" aria-hidden="true"></i>
              <i class="wg-edge" style="top: {eveningTop}px;" aria-hidden="true"></i>
              {#if numTz >= 2}
                <!-- Secondary-zone working-hours edges, in the page colour. -->
                <i class="wg-edge wg-edge-2" style="top: {tzCols[1]!.morningTopP}px;" aria-hidden="true"></i>
                <i class="wg-edge wg-edge-2" style="top: {tzCols[1]!.eveningTopP}px;" aria-hidden="true"></i>
              {/if}
            {/if}
            {#each timedByDay[i] ?? [] as b (b.ev.uid)}
              <WeekEvent
                event={b.ev}
                tz={tzTop}
                feedColor={feedsById[b.ev.feedId]?.color}
                feedStyle={feedsById[b.ev.feedId]?.style}
                isMatch={matchUids.has(b.ev.uid)}
                isCurrent={currentMatchUid === b.ev.uid}
                isPast={b.ev.end.getTime() < nowMs}
                compact={blockHeightPx(b) < TIME_MIN_H}
                placement={blockPlacement(b)}
              />
            {/each}
          </div>
        {/each}
      </div>

      <!-- Hover crosshair: horizontal line across the day area at the cursor row. -->
      {#if hoverMin != null}
        <i class="wg-hover-line" style="top: {hoverTop}px; left: {gutterW}px;" aria-hidden="true"></i>
      {/if}

      <!-- Temporary day marker (vertical accent band on the marked column) -->
      {#if markerInWindow}
        <i class="wg-temp" style="left: {markerLeft}px; width: {dayW}px;" aria-hidden="true"></i>
      {/if}

      <!-- Live now-line across the day area (only while today is in the window) -->
      {#if todayInWindow}
        <i class="wg-now-line" style="top: {nowTop}px; left: {gutterW}px;" aria-hidden="true"></i>
      {/if}
    </div>
  </div>

  {#if markerMs != null}
    <div class="wg-toggle-marker">
      <IconButton
        icon="arrows-horizontal"
        label="Toggle between today and the day marker"
        variant="ghost"
        size={18}
        onclick={toggleTempMarker}
      />
    </div>
  {/if}
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
    /* Scrollable bottom gap so the last hour row clears the edge with the same
       breathing room as the top margin (a flex child's bottom margin isn't
       counted in the scroll area, so the padding lives on the scroller). */
    padding-bottom: var(--wg-body-pad, 7px);
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
  .wg-tz:not(:first-child) {
    border-left: var(--border-w) solid var(--ink);
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
    height: var(--tier-q-h, 21px);
  }
  .wg-tier-m {
    height: var(--tier-m-h, 18px);
  }
  .wg-tier-w {
    height: var(--tier-w-h, 18px);
  }
  .wg-tier-q,
  .wg-tier-m,
  .wg-tier-w {
    border-bottom: var(--border-w) solid var(--ink);
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
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    box-sizing: border-box;
    border: none;
    border-left: var(--border-w) solid var(--ink);
    border-radius: 0;
    padding: 0;
    margin: 0;
    /* Opaque so day columns don't show through the sticky header while scrolling. */
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .wg-datecell[data-weekend='true'] {
    background: var(--weekend-bg);
  }
  /* A set day marker faintly tints its date cell — no outline (the body band is
     the primary indicator). */
  .wg-datecell[data-temp='true'] {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  /* Day-blocking hatch on the date cell, mirroring the month-zoom day-letter band. */
  .wg-datecell[data-holiday='true']::before,
  .wg-datecell[data-observance='true']::before {
    content: '';
    position: absolute;
    inset: 0;
    background-attachment: fixed;
    opacity: 0.6;
    pointer-events: none;
    z-index: 0;
  }
  .wg-datecell[data-holiday='true']::before {
    background-image: repeating-linear-gradient(
      45deg, transparent 0, transparent 4px, var(--holiday-stripe) 4px, var(--holiday-stripe) 5px);
  }
  .wg-datecell[data-observance='true']::before {
    background-image: repeating-linear-gradient(
      45deg, transparent 0, transparent 9px, var(--holiday-stripe) 9px, var(--holiday-stripe) 10px);
  }
  .wg-datecell > * {
    position: relative;
    z-index: 1;
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
  /* Continue the gutter's ink right border down through the bottom gap so the
     timezone columns read as tall as the day columns (whose separators extend
     as dashed lines into the same gap). */
  .wg-gutter-group::after {
    content: '';
    position: absolute;
    top: 100%;
    right: calc(-1 * var(--border-w));
    width: var(--border-w);
    height: var(--wg-body-pad, 7px);
    background: var(--ink);
    pointer-events: none;
  }
  .wg-gutter {
    position: relative;
    /* Opaque so day columns don't show through while scrolling horizontally. */
    background: var(--paper);
  }
  .wg-gutter[data-div='true'] {
    border-right: var(--border-w) solid var(--ink);
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
  /* Live current time on the hour axis, in accent, occluding the hour label
     behind it (paper background) and centred on the now-line. */
  .wg-now-time {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    transform: translateY(-50%);
    /* Smaller + tight tracking so HH:MM fits the narrow hour column. */
    font-size: calc(8 / 14 * 1rem);
    letter-spacing: -0.4px;
    line-height: 1;
    color: var(--accent);
    background: var(--paper);
    padding: 1px 0;
    white-space: nowrap;
    pointer-events: none;
    z-index: 1;
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
  /* Extend each day-column separator into the top & bottom margin gaps as a
     dashed line, so columns stay visually connected past the hour grid. */
  .wg-daycol::before,
  .wg-daycol::after {
    content: '';
    position: absolute;
    left: calc(-1 * var(--border-w));
    width: 0;
    height: var(--wg-body-pad, 7px);
    border-left: var(--border-w) dashed var(--ink-faint);
    pointer-events: none;
  }
  .wg-daycol::before {
    top: calc(-1 * var(--wg-body-pad, 7px));
  }
  .wg-daycol::after {
    bottom: calc(-1 * var(--wg-body-pad, 7px));
  }
  .wg-daycol[data-current='true'] {
    background-color: color-mix(in srgb, var(--accent) 5%, transparent);
  }
  /* Day-blocking hatch over the whole day column (global or local block). */
  .wg-block {
    position: absolute;
    inset: 0;
    background-attachment: fixed;
    opacity: 0.6;
    pointer-events: none;
    z-index: 0;
  }
  .wg-block[data-density='thick'] {
    background-image: repeating-linear-gradient(
      45deg, transparent 0, transparent 4px, var(--holiday-stripe) 4px, var(--holiday-stripe) 5px);
  }
  .wg-block[data-density='thin'] {
    background-image: repeating-linear-gradient(
      45deg, transparent 0, transparent 9px, var(--holiday-stripe) 9px, var(--holiday-stripe) 10px);
  }
  /* Dashed working-hours edges: primary zone in the off-hours background tone,
     secondary zone in the page colour (visible where it crosses the tint). */
  .wg-edge {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: var(--border-w) dashed var(--ink-muted);
    pointer-events: none;
    z-index: 0;
  }
  .wg-edge-2 {
    border-top-color: var(--paper);
  }

  /* Temporary day marker: a translucent accent band over the marked column. */
  .wg-temp {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--accent);
    opacity: 0.18;
    pointer-events: none;
    z-index: 2;
  }
  /* Floating today/marker toggle, mirroring the timeline's marker button. */
  .wg-toggle-marker {
    position: absolute;
    top: 2px;
    right: 6px;
    z-index: 9;
  }
  .wg-toggle-marker :global(.icon-button) {
    filter: var(--clock-halo);
  }
  .wg-toggle-marker :global(.icon-button) :global(.icon) {
    color: var(--accent);
  }

  .wg-now-line {
    position: absolute;
    right: 0;
    height: 0;
    border-top: var(--border-w) dashed var(--accent);
    pointer-events: none;
    z-index: 3;
  }

  /* Hover crosshair: a faint solid line across the day area, with the exact
     time shown in the gutter at the same row (mouse-only, decorative). */
  .wg-hover-line {
    position: absolute;
    right: 0;
    height: 0;
    border-top: var(--border-w) solid var(--ink-faint);
    pointer-events: none;
    z-index: 2;
  }
  .wg-hover-time {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    transform: translateY(-50%);
    font-size: calc(8 / 14 * 1rem);
    letter-spacing: -0.4px;
    line-height: 1;
    color: var(--ink-muted);
    background: var(--paper);
    padding: 1px 0;
    white-space: nowrap;
    pointer-events: none;
    z-index: 5;
  }
</style>
