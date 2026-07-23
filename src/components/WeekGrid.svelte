<script lang="ts">
  import WeekEvent from './WeekEvent.svelte';
  import Icon from './Icon.svelte';
  import {
    config,
    search,
    ui,
    zoom,
    toggleSelected,
    displayEventsFor,
    deleteLocalEvents,
    isKiosk,
    layout,
  } from '../lib/state.svelte';
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
    orderedGutterZones,
    isDaylight,
    formatWeekday,
    formatMonth,
    isWeekend,
  } from '../lib/format';
  import { effectiveBlock, hatchDensity, dayKeyOf, eventDayKeys } from '../lib/blocking';
  import { dedupeDisplayEvents, mergeConsecutiveDays } from '../lib/event-display';
  import { packLanes, AVG_CHAR_EM, BUTTON_PADDING_PX } from '../lib/layout';
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

  // Desktop vs mobile — mirrors TimeHeader's breakpoints (portrait ≤640,
  // landscape ≤900). On desktop the hour grid is sized to fill the viewport;
  // on mobile it keeps the fixed compact hour height and scrolls.
  let isDesktop = $state(false);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const mqP = window.matchMedia('(orientation: portrait) and (max-width: 640px)');
    const mqL = window.matchMedia('(orientation: landscape) and (max-width: 900px)');
    const upd = (): void => {
      isDesktop = !mqP.matches && !mqL.matches;
    };
    upd();
    mqP.addEventListener('change', upd);
    mqL.addEventListener('change', upd);
    return () => {
      mqP.removeEventListener('change', upd);
      mqL.removeEventListener('change', upd);
    };
  });

  // Visible height of the scroll area, used to fit all 24 hours on desktop.
  let viewH = $state(0);

  // Hour rows ~20% taller than the prior compact height, times the user's
  // vertical-zoom setting (pinch / Ctrl+wheel adjust config.weekHourScale). On
  // desktop the base is instead derived so 24h fills the available height (below
  // a legibility floor); pinch-zoom (weekHourScale) still multiplies on top.
  // Shared with minHourScale so "zoomed all the way out" lands exactly on a
  // full 24h day filling the viewport on every device class.
  const hourBaseH = $derived.by(() => {
    if (isDesktop && viewH > 0) {
      const avail = viewH - headerH - allDayHeight - BODY_PAD * 2;
      return Math.max(18 * fontScale, avail / 24);
    }
    return 22 * 1.2 * fontScale;
  });
  const HOUR_H = $derived(Math.round(hourBaseH * config.weekHourScale));
  // Narrow hour-label columns (one per shown timezone, left gutter). The min is
  // the legibility floor the gutter won't shrink below when aligning to a narrow
  // 1W button (condensed mobile, where the date collapses) — tight enough that
  // two columns still reach the button, but wide enough for a 2-digit hour.
  const GUTTER_MIN_W = $derived(Math.round(18 * fontScale));
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

  // The Current (display) timezone anchors the grid (day columns, event
  // placement, hour labels) and is always the leftmost gutter column.
  const tzTop = $derived(config.timezone === 'local' ? resolveLocalTz() : config.timezone);

  // Left-gutter columns: Current first, then the #1/#2 reference zones, deduped —
  // so a reference zone equal to Current collapses out (Current stays leftmost)
  // and a third column only shows when Current differs from both.
  const tzZones = $derived(orderedGutterZones(tzTop, config.timezone1, config.timezone2));
  const numTz = $derived(tzZones.length);
  // Line the gutter's right border up with the toolbar's 1W button (its measured
  // left edge, published by the toolbar). The timezone columns split that width
  // evenly. Floor only at the per-column legibility minimum so the gutter can
  // both grow (wide screens) and shrink (condensed mobile, where the date
  // collapses and the button sits narrow) to meet the button — e.g. two columns
  // still reach it. Falls back to the min width until the toolbar has measured.
  const gutterW = $derived(Math.max(numTz * GUTTER_MIN_W, layout.weekBtnLeft));

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

  // Column virtualization: the range of rendered column indices whose pills are
  // actually mounted. Only columns intersecting the viewport (± overscan) render
  // their WeekEvent subtrees; the other ~70 of 91 columns keep their grid cell and
  // background but stay empty. Falls open (whole window) until the width is known.
  const VCOL_OVERSCAN = 7;
  const visibleColRange = $derived.by(() => {
    if (viewW <= 0 || dayW <= 0) return { first: 0, last: RENDERED_DAYS - 1 };
    const viewDayW = viewW - gutterW;
    const first = Math.floor(scrollLeftPx / dayW) - VCOL_OVERSCAN;
    const last = Math.ceil((scrollLeftPx + viewDayW) / dayW) + VCOL_OVERSCAN;
    return { first: Math.max(0, first), last: Math.min(RENDERED_DAYS - 1, last) };
  });
  function colVisible(i: number): boolean {
    return i >= visibleColRange.first && i <= visibleColRange.last;
  }

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
  // Scrollable range, mirroring the timeline's pastMonths/futureMonths setting:
  // the grid can't be scrolled earlier than `pastMonths` back or later than
  // `futureMonths` forward (day offsets relative to today, primary zone).
  function offsetMonths(months: number): number {
    const d = new Date(primaryTodayMs);
    d.setUTCMonth(d.getUTCMonth() + months);
    return Math.round((d.getTime() - primaryTodayMs) / MS_PER_DAY);
  }
  const rangeMinOffset = $derived(offsetMonths(-config.pastMonths));
  const rangeMaxOffset = $derived(offsetMonths(config.futureMonths));
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
    const out: { date: Date; isToday: boolean; past: boolean; weekend: boolean; short: string; name: string; num: number }[] = [];
    for (let i = 0; i < RENDERED_DAYS; i++) {
      const off = startOffset + i;
      const d = new Date(primaryTodayMs + off * MS_PER_DAY);
      const name = formatWeekday(d, config.locale);
      out.push({
        date: d,
        isToday: off === 0,
        past: off < 0,
        weekend: isWeekend(d),
        short: name.slice(0, 3),
        name,
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
      out.push({ from: i, span: j - i, label: formatMonth(d, config.locale, 'long'), key });
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
      out.push({ from: i, span: j - i, label: 'W' + isoWeekNumber(d0), key: String(key) });
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
    // 1W merges every feed onto one surface, so exact-duplicate events (same
    // title + start + end, across feeds or a repeating series) pile up here.
    // Collapse them into one block carrying an ×N count. This is intentionally
    // 1W-only — the other zooms keep per-feed lanes, where duplicates stay
    // distinct and the label-width lane packing handles overlap instead.
    return dedupeDisplayEvents(out);
  });

  const matchUids = $derived(getMatchUids());
  const currentMatchUid = $derived(getCurrentMatchUid());

  // Day-blocking hatch, collapsed to thick/thin day-key sets (same classification
  // as the timeline, shared helpers in lib/blocking). The all-day lane hatches for
  // any block (global OR local); the whole-column hatch is global-only — a local
  // block stays confined to the all-day lane instead of running down the day
  // (the `col*` sets), mirroring the timeline where local blocks hatch just the
  // feed's own row and only global blocks band the shared day.
  const blockedDays = $derived.by(() => {
    const thick = new Set<string>();
    const thin = new Set<string>();
    const colThick = new Set<string>();
    const colThin = new Set<string>();
    for (const feed of config.feeds) {
      if (feed.hidden) continue;
      for (const ev of displayEventsFor(feed.id)) {
        const block = effectiveBlock(ev, feed);
        if (block === 'none') continue;
        const density = hatchDensity(ev, feed);
        if (density === 'none') continue;
        const isGlobal = block === 'global';
        for (const k of eventDayKeys(ev)) {
          if (density === 'thick') {
            thick.add(k);
            if (isGlobal) colThick.add(k);
          } else {
            thin.add(k);
            if (isGlobal) colThin.add(k);
          }
        }
      }
    }
    return { thick, thin, colThick, colThin };
  });
  // Any block (global or local) — used by the all-day lane and the date header.
  function dayBlock(date: Date): 'thick' | 'thin' | null {
    const k = dayKeyOf(date);
    if (blockedDays.thick.has(k)) return 'thick';
    if (blockedDays.thin.has(k)) return 'thin';
    return null;
  }
  // Global blocks only — used for the whole-column hatch, so a local block never
  // patterns the entire day column (it shows on the all-day lane via dayBlock).
  function columnBlock(date: Date): 'thick' | 'thin' | null {
    const k = dayKeyOf(date);
    if (blockedDays.colThick.has(k)) return 'thick';
    if (blockedDays.colThin.has(k)) return 'thin';
    return null;
  }

  type TimedBlock = {
    ev: DisplayEvent;
    startMin: number;
    endMin: number;
    continuesEnd: boolean;
    lane: number;
    laneCount: number;
  };

  // Timed events grouped into their start day's column, then packed into
  // side-by-side sub-columns by their [startMin, endMin) overlap. Overnight
  // events are clipped to the start column's midnight and flagged continuesEnd
  // so the block can show a caret indicating it carries into the next day.
  const timedByDay = $derived.by<TimedBlock[][]>(() => {
    const cols: { ev: DisplayEvent; startMin: number; endMin: number; continuesEnd: boolean }[][] =
      Array.from({ length: RENDERED_DAYS }, () => []);
    for (const ev of visibleEvents) {
      if (ev.allDay) continue;
      const idx = colIndexOf(ev.start);
      if (idx < 0 || idx >= RENDERED_DAYS) continue;
      const startMin = zonedParts(ev.start, tzTop).minutes;
      const endParts = zonedParts(ev.end, tzTop).minutes;
      const sameDay = colIndexOf(ev.end) === idx;
      let endMin = sameDay ? endParts : 1440;
      if (endMin < startMin) endMin = 1440; // overnight / malformed → clip to midnight
      // Genuinely past this day's midnight (an end at exactly 00:00 doesn't count).
      const continuesEnd = !sameDay && endParts > 0;
      cols[idx]!.push({ ev, startMin, endMin, continuesEnd });
    }
    return cols.map((items) => {
      const { packed, laneCount } = packLanes(items);
      return packed.map(({ item, lane }) => ({
        ev: item.ev,
        startMin: item.startMin,
        endMin: item.endMin,
        continuesEnd: item.continuesEnd,
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
    // Subtract 1px from the width and height for a hairline gap on the right and
    // bottom — margin is ignored on an absolutely-positioned box with left/width.
    return `top:${top}px; height:${Math.max(1, height - 1)}px; left:${left}%; width:calc(${width}% - 1px);`;
  }
  // A block shorter than two text lines can't fit a time line under the title.
  // A block at least this tall has room for a second wrapped title line, so its
  // title wraps instead of overflowing on one line.
  const WRAP_MIN_H = $derived(Math.round(34 * fontScale));
  // A block at least this tall also has room for a location line under the
  // (possibly wrapped) title without the two crowding each other out.
  const LOCATION_MIN_H = $derived(Math.round(46 * fontScale));

  // All-day events span the (UTC) day columns they cover, clamped to the window,
  // and stack into rows so concurrent ones don't overlap.
  const allDayLayout = $derived.by(() => {
    // Combine consecutive-day repeats (same title on adjacent days) into one
    // continuous bar — the same merge the horizontal zooms apply — so the
    // all-day strip shows a single span instead of a staircase. Scoped to the
    // all-day surface; the timed grid keeps every day distinct.
    const allDayEvents = mergeConsecutiveDays(
      visibleEvents.filter((e) => e.allDay),
      config.timezone,
    );
    // The bar title renders at --fs-13 (config.fontSize * 13/14 px per em);
    // reserve its estimated width so a long label pushes the next event to a
    // lower lane instead of smearing over it — the same footprint reservation
    // assignLanes uses for the horizontal zooms.
    const fontEmPx = (config.fontSize * 13) / 14;
    const items: { from: number; span: number; ev: DisplayEvent; startMin: number; endMin: number }[] = [];
    for (const ev of allDayEvents) {
      const startIdx = utcColIndexOf(ev.start);
      const lastIdx = utcColIndexOf(new Date(Math.max(ev.start.getTime(), ev.end.getTime() - 1)));
      if (lastIdx < 0 || startIdx >= RENDERED_DAYS) continue;
      const from = Math.max(0, startIdx);
      const to = Math.min(RENDERED_DAYS - 1, lastIdx);
      const span = to - from + 1;
      // Columns the label needs, so packing reserves at least that much room.
      const labelPx = ev.displayTitle.trim().length * AVG_CHAR_EM * fontEmPx + BUTTON_PADDING_PX;
      const footprintCols = Math.max(span, Math.ceil(labelPx / dayW));
      items.push({ from, span, ev, startMin: from, endMin: from + footprintCols });
    }
    const { packed, laneCount } = packLanes(items);
    const rows = packed.map(({ item, lane }) => ({ ev: item.ev, from: item.from, span: item.span, lane }));
    return { rows, laneCount };
  });

  // Cap the all-day strip so a busy week can't grow it without bound and eat the
  // hour grid: show a couple of rows, then a "+N" chip per day that reveals the
  // rest. (Expansion lasts until the view is left.)
  const MAX_ALLDAY_LANES = 3;
  let allDayExpanded = $state(false);
  const allDayCapped = $derived(!allDayExpanded && allDayLayout.laneCount > MAX_ALLDAY_LANES);
  const shownAllDayRows = $derived(
    allDayCapped ? allDayLayout.rows.filter((r) => r.lane < MAX_ALLDAY_LANES - 1) : allDayLayout.rows,
  );
  const allDayOverflow = $derived.by<{ col: number; n: number }[]>(() => {
    if (!allDayCapped) return [];
    const counts = new Array<number>(RENDERED_DAYS).fill(0);
    for (const r of allDayLayout.rows) {
      if (r.lane < MAX_ALLDAY_LANES - 1) continue;
      for (let c = r.from; c < r.from + r.span && c < RENDERED_DAYS; c++) counts[c]!++;
    }
    const chips: { col: number; n: number }[] = [];
    for (let c = 0; c < RENDERED_DAYS; c++) if (counts[c]! > 0) chips.push({ col: c, n: counts[c]! });
    return chips;
  });
  const allDayOverflowTop = $derived((MAX_ALLDAY_LANES - 1) * ALLDAY_ROW_H + ALLDAY_PAD);
  const allDayHeight = $derived(
    (allDayCapped ? MAX_ALLDAY_LANES : Math.max(1, allDayLayout.laneCount)) * ALLDAY_ROW_H + ALLDAY_PAD,
  );

  // Columns occupied by a shown all-day bar, keyed `lane:col`. Used to decide
  // whether a bar's overflowing title would collide with a neighbour.
  const allDayOccupied = $derived.by(() => {
    const set = new Set<string>();
    for (const r of shownAllDayRows) {
      for (let c = r.from; c < r.from + r.span; c++) set.add(`${r.lane}:${c}`);
    }
    return set;
  });
  // Clip a bar's title only when the very next day in its lane holds another
  // bar — otherwise let the title overflow into the free space (matching the
  // other zooms' pills). The full title stays reachable via hover / modal.
  function allDayClipped(r: { from: number; span: number; lane: number }): boolean {
    return allDayOccupied.has(`${r.lane}:${r.from + r.span}`);
  }

  function allDayPlacement(r: { from: number; span: number; lane: number }): string {
    const left = (r.from / RENDERED_DAYS) * 100;
    const width = (r.span / RENDERED_DAYS) * 100;
    const top = r.lane * ALLDAY_ROW_H + ALLDAY_PAD;
    // -1px width for the same hairline right gap as timed blocks.
    return `top:${top}px; height:${ALLDAY_ROW_H - 1}px; left:${left}%; width:calc(${width}% - 1px);`;
  }

  const morningMin = $derived(dayLimitMinutes(config.morningLimit, 8.5 * 60));
  const eveningMin = $derived(dayLimitMinutes(config.eveningLimit, 20.5 * 60));
  const morningTop = $derived((morningMin / 60) * HOUR_H);
  const eveningTop = $derived((eveningMin / 60) * HOUR_H);

  // Per-gutter-column metadata: a 2-letter ISO country code (always shown), the
  // hour offset from the primary zone (for the hour labels), the current day/night
  // state, the live current time in that zone, and a full-name tooltip.
  // Wrap a minute-of-day into [0,1440) → its y on the primary axis.
  function topForMin(min: number): number {
    return ((((min % 1440) + 1440) % 1440) / 60) * HOUR_H;
  }
  // Stable per-zone geometry: UTC offset from the primary zone and the resulting
  // working-hours edges. A zone's offset only shifts at a DST boundary (≈twice a
  // year), so this is derived from `today` (day granular) — NOT clock.now — so the
  // day/night gradient it feeds (and all 91 column backgrounds) don't recompute
  // every minute for an unchanged value.
  const tzGeom = $derived.by(() => {
    const at = today;
    const primOff = offsetMinutes(tzTop, at, config.dst) ?? 0;
    return tzZones.map((tz) => {
      const off = offsetMinutes(tz, at, config.dst) ?? primOff;
      const offsetFromPrimary = off - primOff;
      return {
        tz,
        code: tzCountryCode(tz),
        title: formatTimezoneLabel(tz, config.dst),
        offsetFromPrimary,
        // This zone's working-hours edges, mapped onto the primary axis.
        morningTopP: topForMin(morningMin - offsetFromPrimary),
        eveningTopP: topForMin(eveningMin - offsetFromPrimary),
      };
    });
  });
  // Minute-granular gutter fields (live clock + day/night dot) layered over the
  // stable geometry. Only this recomputes on the clock tick — not the gradient.
  const tzCols = $derived.by(() => {
    const at = new Date(clock.now);
    return tzGeom.map((g) => ({
      ...g,
      isDay: isDaylight(g.tz, at, morningMin, eveningMin),
      // The primary (first) column carries the spanning "now" clock readout.
      isLocal: g.tz === tzTop,
      nowTime: formatTime(at, config.timeFormat, g.tz),
    }));
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
    `repeating-linear-gradient(to bottom, var(--weekend-bg) 0, var(--weekend-bg) var(--border-w), transparent var(--border-w), transparent ${HOUR_H}px)`,
  );
  // Day/night shade on the primary minute axis, generalized to however many gutter
  // zones are shown (1-3): paper (no tint) where every zone is within working
  // hours, darkening one --wg-night step per additional zone that's off.
  // Each zone's working window is [morning, evening) shifted by its offset from
  // the primary (Current) zone; the primary's own offset is 0.
  const zoneWindows = $derived(
    tzGeom.map((c) => {
      const off = c.offsetFromPrimary;
      return {
        a: (((morningMin - off) % 1440) + 1440) % 1440,
        b: (((eveningMin - off) % 1440) + 1440) % 1440,
      };
    }),
  );
  // How many of the shown zones are outside working hours at primary-axis minute m.
  const offCountAt = $derived.by(() => {
    const windows = zoneWindows;
    return (m: number): number => {
      let off = 0;
      for (const { a, b } of windows) {
        const working = a < b ? m >= a && m < b : m >= a || m < b;
        if (!working) off++;
      }
      return off;
    };
  });
  // Hour-label ink strength by how many zones are off: all-day = full ink, then a
  // step down per off zone (a pronounced day/night step, floored so 3+ stays legible).
  function hourInk(h: number): string {
    const n = offCountAt(h * 60 + 30);
    const pct = n <= 0 ? 100 : n === 1 ? 55 : n === 2 ? 30 : 20;
    return `color-mix(in srgb, var(--ink-color) ${pct}%, transparent)`;
  }
  // Night-tint tone for a zones-off count: paper (transparent) in the full-day
  // overlap, then one --wg-night level darker per off zone (capped at --wg-night-3).
  function nightColorFor(n: number): string {
    if (n <= 0) return 'transparent';
    if (n === 1) return 'var(--wg-night)';
    if (n === 2) return 'var(--wg-night-2)';
    return 'var(--wg-night-3)';
  }
  // Deepest tone for the current column count — used on weekends (every zone off).
  const weekendTone = $derived(nightColorFor(numTz));
  // The day/night shade tone at each vertical edge of the hour grid (midnight),
  // so weekday columns can carry it into the ±BODY_PAD gaps above/below the hours.
  const gapShadeTop = $derived(nightColorFor(offCountAt(0)));
  const gapShadeBot = $derived(nightColorFor(offCountAt(1439)));
  const nightShade = $derived.by(() => {
    const offCount = offCountAt;
    const colorFor = nightColorFor;
    // Segment the day at every zone's shifted morning/evening edge, then colour
    // each segment by how many zones are off in it.
    const edges = [0, 1440];
    for (const { a, b } of zoneWindows) edges.push(a, b);
    const bounds = [...new Set(edges)]
      .filter((x) => x >= 0 && x <= 1440)
      .sort((x, y) => x - y);
    const stops: string[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const lo = bounds[i]!;
      const hi = bounds[i + 1]!;
      if (hi <= lo) continue;
      const col = colorFor(offCount((lo + hi) / 2));
      stops.push(`${col} ${(lo / 1440) * bodyH}px`, `${col} ${(hi / 1440) * bodyH}px`);
    }
    return `linear-gradient(to bottom, ${stops.join(', ')})`;
  });
  // Weekdays show the multi-zone split; weekends are off in every zone, so the
  // whole column takes the deepest (all-off) tint.
  const weekdayBg = $derived(`${nightShade}, ${gridLines}`);
  const weekendBg = $derived(`linear-gradient(${weekendTone}, ${weekendTone}), ${gridLines}`);

  // Live now-line position, in primary-zone minutes. Shown only while today's
  // column is within the rendered window (it leaves when scrolled far away).
  const nowMin = $derived(zonedParts(new Date(clock.now), tzTop).minutes);
  const nowTop = $derived((nowMin / 60) * HOUR_H);
  const nowMs = $derived(clock.now);
  // The local zone's current clock reading, shown once across the whole gutter.
  const localNowTime = $derived(tzCols.find((c) => c.isLocal)?.nowTime ?? '');
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
  // today is day-offset 0; its rendered column index is -startOffset. Used to
  // paint the today/temp column tints into the all-day strip (item: all-day bg).
  const todayCol = $derived(-startOffset);
  const todayLineLeft = $derived(gutterW + todayCol * dayW);
  // "TODAY" marker shown centered over today's column on the Quarter lane.
  const todayLabel = $derived(config.locale === 'el' ? 'ΣΗΜΕΡΑ' : 'TODAY');

  // Header-band state for a band spanning columns [from, from+span): entirely
  // before today (past → faded), or containing the temp marker (→ accent), so the
  // quarter / month / week labels track today and the marker like the timeline.
  type BandLike = { from: number; span: number };
  function bandPast(b: BandLike): boolean {
    return startOffset + b.from + b.span - 1 < 0;
  }
  function bandTemp(b: BandLike): boolean {
    return markerCol != null && markerCol >= b.from && markerCol < b.from + b.span;
  }

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
  // Tracked horizontal scroll offset (px), updated once per frame from the scroll
  // handler below. Drives column virtualization (visibleColRange) so only the
  // day-columns near the viewport mount their WeekEvent subtrees — the rest of the
  // 91-column window keeps its (cheap) grid cell + background but skips the pills.
  let scrollLeftPx = $state(0);
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
      ui.markerFocus = 'today';
    };
    window.addEventListener('cal:jump-today', onJump);
    return () => window.removeEventListener('cal:jump-today', onJump);
  });
  // The Toolbar date button (when a marker is set) drives the today↔marker
  // scroll toggle here — replaces the old in-grid cycle button.
  $effect(() => {
    const onToggle = (): void => toggleTempMarker();
    window.addEventListener('cal:toggle-marker', onToggle);
    return () => window.removeEventListener('cal:toggle-marker', onToggle);
  });
  // Page the week horizontally by ~a screen (the n/p keys' cal:scroll-page event),
  // mirroring the timeline's own handler so paging works in whichever view is
  // mounted.
  $effect(() => {
    const onPage = (e: Event): void => {
      if (!scrollBody) return;
      const dir = (e as CustomEvent<{ dir: number }>).detail?.dir ?? 1;
      scrollBody.scrollBy({ left: dir * scrollBody.clientWidth * 0.9, behavior: smoothBehavior() });
    };
    window.addEventListener('cal:scroll-page', onPage);
    return () => window.removeEventListener('cal:scroll-page', onPage);
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
      ui.markerFocus = markerOffset != null ? 'marker' : 'today';
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
    // Keep the overlay clip flush with the sticky gutter's right edge (its content
    // x = scrollLeft + gutterW), so the today/temp column tint + marker lines never
    // paint over the gutter as their column scrolls under it. gw is referenced so
    // the effect re-bases when the gutter width changes (timezone columns toggle).
    const gw = gutterW;
    const setClip = (): void =>
      el.style.setProperty('--wg-gutter-clip', el.scrollLeft + gw + 'px');
    setClip();
    scrollLeftPx = el.scrollLeft;
    let raf = 0;
    const onScroll = (): void => {
      setClip();
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (viewW <= 0 || dayW <= 0) return;
        const areaW = RENDERED_DAYS * dayW;
        const viewDayW = el.clientWidth - gutterW;
        const buffer = 7 * dayW;
        // Slide the window toward the edge the user is nearing, but only while
        // the configured range still has days to reveal in that direction.
        if (el.scrollLeft + viewDayW > areaW - buffer && startOffset + RENDERED_DAYS - 1 < rangeMaxOffset) {
          startOffset += SHIFT_DAYS;
          el.scrollLeft -= SHIFT_DAYS * dayW;
        } else if (el.scrollLeft < buffer && startOffset > rangeMinOffset) {
          startOffset -= SHIFT_DAYS;
          el.scrollLeft += SHIFT_DAYS * dayW;
        }
        // Hard-clamp scroll to the past/future-months range so days beyond it
        // can't be reached.
        const minSL = Math.max(0, (rangeMinOffset - startOffset) * dayW);
        const maxSL = Math.max(minSL, (rangeMaxOffset + 1 - startOffset) * dayW - viewDayW);
        if (el.scrollLeft < minSL) el.scrollLeft = minSL;
        else if (el.scrollLeft > maxSL) el.scrollLeft = maxSL;
        // Publish the settled offset so the visible-column window tracks the
        // viewport (overscan absorbs the one-frame throttle lag).
        scrollLeftPx = el.scrollLeft;
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
    off = Math.max(rangeMinOffset, Math.min(rangeMaxOffset, off));
    if (off - startOffset < 0 || off - startOffset > RENDERED_DAYS - 1) {
      startOffset = off - INITIAL_PAST;
    }
    const col = off - startOffset;
    scrollBody.scrollTo({ left: Math.max(0, col * dayW), behavior: smoothBehavior() });
  }
  function toggleTempMarker(): void {
    if (markerOffset == null) return;
    const target = ui.markerFocus === 'today' ? markerOffset : 0;
    ui.markerFocus = ui.markerFocus === 'today' ? 'marker' : 'today';
    jumpToOffset(target);
  }
  // Header prev/next-week controls: slide the day area by one week.
  function scrollWeeks(dir: -1 | 1): void {
    if (!scrollBody) return;
    scrollBody.scrollBy({ left: dir * 7 * dayW, behavior: smoothBehavior() });
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

  // Smallest vertical zoom: the full 24h grid exactly fills the viewport below
  // the header and all-day strip. Derived from the live viewport height, so a
  // phone and a wall display each bottom out at "whole day visible" — hFit is
  // floored to whole px so HOUR_H rounds back to it and 24 rows never overflow.
  const minHourScale = $derived.by(() => {
    const avail = viewH - headerH - allDayHeight - 2 * BODY_PAD;
    if (avail <= 0) return 0.25;
    const hFit = Math.floor(avail / 24);
    return Math.min(1.9, Math.max(0.25, hFit / (22 * 1.2 * fontScale)));
  });

  // Vertical zoom: pinch (touch) or Ctrl/⌘+wheel (desktop) grows/shrinks the
  // hour rows, persisted in config.weekHourScale. Clamped between fit-24h and
  // a legible maximum.
  function bumpHourScale(delta: number): void {
    const next = Math.min(2, Math.max(minHourScale, Math.round((config.weekHourScale + delta) * 100) / 100));
    config.weekHourScale = next;
  }
  function onGridWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    bumpHourScale(e.deltaY < 0 ? 0.1 : -0.1);
  }

  // A single click on empty grid space moves the temp day marker to that column;
  // clicks on an event fall through to its own handler. (Double-click creates —
  // see onGridCreate.)
  function onGridClick(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (panMoved) { panMoved = false; return; } // trailing click of a drag-pan
    if ((e.target as HTMLElement).closest('.wg-event')) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / dayW);
    const d = days[col];
    if (!d) return;
    ui.tempMarkerMs = d.date.getTime();
  }

  // Double-clicking empty space in a day column opens the Add-event modal
  // prefilled to that day and the clicked time (snapped to 15 min). Clicks on an
  // event fall through to the event's own handler.
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

  // Map a viewport x to the day column under it (accounting for the sticky gutter
  // and horizontal scroll), so the temp-marker line can be dragged to any day.
  function dayFromClientX(clientX: number): (typeof days)[number] | null {
    if (!scrollBody || dayW <= 0) return null;
    const rect = scrollBody.getBoundingClientRect();
    const x = clientX - rect.left - gutterW + scrollBody.scrollLeft;
    const col = Math.max(0, Math.min(days.length - 1, Math.floor(x / dayW)));
    return days[col] ?? null;
  }

  let markerDragPid: number | null = null;
  function markerLinePointerDown(e: PointerEvent): void {
    if (isKiosk()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    markerDragPid = e.pointerId;
    e.stopPropagation();
  }
  function markerLinePointerMove(e: PointerEvent): void {
    if (markerDragPid !== e.pointerId) return;
    const d = dayFromClientX(e.clientX);
    if (d) ui.tempMarkerMs = d.date.getTime();
  }
  function markerLinePointerUp(e: PointerEvent): void {
    if (markerDragPid !== e.pointerId) return;
    markerDragPid = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
    }
  }

  // Mouse/pen click-drag to pan the grid horizontally (the horizontal scrollbar
  // is hidden). Touch keeps native swipe. Mirrors the timeline's pan: pointer
  // capture + a 4px threshold; the interactive-target guard keeps pill / header /
  // button / marker-line handlers working. panMoved suppresses the trailing
  // click so a drag doesn't also move the marker (onGridClick).
  let panDrag: { startX: number; startScrollLeft: number; pid: number } | null = $state(null);
  let panMoved = $state(false);
  function panPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!scrollBody) return;
    if ((e.target as HTMLElement).closest('button, a, article, .wg-day-line')) return;
    panMoved = false;
    // Capture is deferred to the first real move (below) so a plain click still
    // dispatches to the day area (single-click moves the marker).
    panDrag = { startX: e.clientX, startScrollLeft: scrollBody.scrollLeft, pid: e.pointerId };
  }
  function panPointerMove(e: PointerEvent): void {
    if (!panDrag || panDrag.pid !== e.pointerId || !scrollBody) return;
    const dx = e.clientX - panDrag.startX;
    if (!panMoved) {
      if (Math.abs(dx) < 4) return;
      panMoved = true;
      userInteracted = true;
      scrollBody.setPointerCapture(e.pointerId);
    }
    scrollBody.scrollLeft = panDrag.startScrollLeft - dx;
  }
  function panPointerUp(e: PointerEvent): void {
    if (!panDrag || panDrag.pid !== e.pointerId) return;
    panDrag = null;
    try {
      scrollBody?.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer capture may already be released */
    }
  }

  // Centre the grid on the current search match: scroll horizontally to its day
  // and vertically to its start time, mirroring the timeline centring matches.
  $effect(() => {
    const uid = currentMatchUid;
    if (!uid || !search.open) return;
    untrack(() => {
      const ev = visibleEvents.find((e) => e.uid === uid);
      if (!ev) return;
      jumpToOffset(dayIndexOf(ev.start));
      if (scrollBody) {
        const min = ev.allDay ? 0 : zonedParts(ev.start, tzTop).minutes;
        scrollBody.scrollTo({
          top: Math.max(0, (min / 60) * HOUR_H - HOUR_H),
          behavior: smoothBehavior(),
        });
      }
    });
  });

  // Keyboard focus model (week zoom only): a focused event uid navigated by the
  // arrow keys — Up/Down step through a day's events by time, Left/Right jump to
  // the nearest event in the adjacent day. Enter opens, Space selects, Escape
  // clears. A capture-phase listener intercepts before App's timeline handler so
  // the two views don't both consume the arrows.
  let focusedUid: string | null = $state(null);
  function dayItems(col: number): { uid: string; startMin: number }[] {
    return (timedByDay[col] ?? [])
      .map((b) => ({ uid: b.ev.uid, startMin: b.startMin }))
      .sort((a, b) => a.startMin - b.startMin);
  }
  function locateFocus(): { col: number; idx: number } | null {
    if (focusedUid == null) return null;
    for (let col = 0; col < RENDERED_DAYS; col++) {
      const idx = dayItems(col).findIndex((it) => it.uid === focusedUid);
      if (idx >= 0) return { col, idx };
    }
    return null;
  }
  function nearestDayWithEvents(from: number, dir: number): number {
    for (let col = from; col >= 0 && col < RENDERED_DAYS; col += dir) {
      if ((timedByDay[col] ?? []).length) return col;
    }
    return -1;
  }
  function focusAt(col: number, idx: number): void {
    const items = dayItems(col);
    if (!items.length) return;
    const it = items[Math.max(0, Math.min(items.length - 1, idx))]!;
    focusedUid = it.uid;
    scrollFocusIntoView(col, it.startMin);
  }
  function ensureFocus(): boolean {
    if (locateFocus()) return false;
    const todayCol = -startOffset; // dayIndexOf(today) === 0 → this column
    let col = nearestDayWithEvents(Math.max(0, todayCol), 1);
    if (col < 0) col = nearestDayWithEvents(Math.min(RENDERED_DAYS - 1, todayCol), -1);
    if (col < 0) return false;
    focusAt(col, 0);
    return true;
  }
  function moveWithinDay(delta: number): void {
    if (ensureFocus()) return;
    const loc = locateFocus();
    if (loc) focusAt(loc.col, loc.idx + delta);
  }
  function moveDay(delta: number): void {
    if (ensureFocus()) return;
    const loc = locateFocus();
    if (!loc) return;
    const col = nearestDayWithEvents(loc.col + delta, delta);
    if (col >= 0) focusAt(col, loc.idx);
  }
  function scrollFocusIntoView(col: number, startMin: number): void {
    if (!scrollBody) return;
    const left = col * dayW;
    const viewLeft = scrollBody.scrollLeft;
    const viewRight = viewLeft + (scrollBody.clientWidth - gutterW);
    if (left < viewLeft || left + dayW > viewRight) {
      scrollBody.scrollTo({ left: Math.max(0, left - dayW), behavior: smoothBehavior() });
    }
    const top = (startMin / 60) * HOUR_H;
    if (top < scrollBody.scrollTop || top > scrollBody.scrollTop + scrollBody.clientHeight - HOUR_H) {
      scrollBody.scrollTo({ top: Math.max(0, top - HOUR_H), behavior: smoothBehavior() });
    }
  }
  function openFocused(): boolean {
    if (focusedUid == null || !locateFocus()) return false;
    const ev = visibleEvents.find((e) => e.uid === focusedUid);
    if (!ev) return false;
    ui.modalEvent = ev;
    return true;
  }
  function selectFocused(): boolean {
    if (focusedUid == null || !locateFocus()) return false;
    toggleSelected(focusedUid);
    return true;
  }
  // '#' / Delete / Backspace on the week-focused event — local/Draft events only
  // (feed events can't be deleted); returns false otherwise so the key isn't
  // consumed here.
  function deleteWeekFocused(): boolean {
    if (isKiosk() || focusedUid == null) return false;
    const ev = visibleEvents.find((e) => e.uid === focusedUid);
    if (!ev || !ev.feedId.startsWith('scratchpad:')) return false;
    deleteLocalEvents([focusedUid]);
    focusedUid = null;
    return true;
  }
  $effect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (zoom.value !== 'week') return;
      // The event modal (opened from a week pill) owns the arrow keys while open —
      // don't swallow them here in the capture phase.
      if (ui.modalEvent) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // Shift+Enter selects the focused event (multi-select); handle it before
      // the plain-key path bails on modifiers.
      if (e.shiftKey && e.key === 'Enter') {
        if (selectFocused()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let handled = true;
      switch (e.key) {
        case 'ArrowUp': moveWithinDay(-1); break;
        case 'ArrowDown': moveWithinDay(1); break;
        case 'ArrowLeft': moveDay(-1); break;
        case 'ArrowRight': moveDay(1); break;
        case 'Enter': handled = openFocused(); break;
        case 'Delete':
        case 'Backspace':
        case '#': handled = deleteWeekFocused(); break;
        // Space is the global 1W-toggle / double-tap-today gesture — let it fall
        // through to App's window handler instead of selecting here.
        case 'Escape': handled = focusedUid != null; focusedUid = null; break;
        default: handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const dayCols = $derived(`repeat(${RENDERED_DAYS}, ${dayW}px)`);
  // The zone columns split the gutter evenly so their right edge lands on the
  // gutter's aligned right border (not a fixed GUTTER_W that would leave a gap).
  const tzGridCols = $derived(`repeat(${numTz}, 1fr)`);
</script>

<div
  class="week-grid"
  style="--wg-header-h: {headerH}px; --tier-q-h: {TIER_Q_H}px; --tier-m-h: {TIER_M_H}px; --tier-w-h: {TIER_W_H}px; --tier-d-h: {TIER_D_H}px; --wg-body-h: {bodyH}px; --wg-body-pad: {BODY_PAD}px; --wg-gutter-w: {gutterW}px; height: calc(100dvh - var(--toolbar-h) - var(--tray-bottom-h, var(--tray-header-h)) - {search.open
    ? 'var(--toolbar-h)'
    : '0px'});"
>
  <!-- Each row is a flex pair [frozen-left | scrolling day-area]; the frozen
       left is position:sticky;left:0 so its containing block is the full-width
       row and it stays pinned across the whole horizontal scroll. -->
  <!-- The pan handlers are a pointer-only affordance (mouse/pen drag to scroll);
       keyboard users navigate via events, the week controls and native vertical
       scroll, so the static-element interaction rule doesn't apply. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="wg-scroll"
    data-panning={panMoved ? 'true' : null}
    bind:this={scrollBody}
    bind:clientWidth={viewW}
    bind:clientHeight={viewH}
    onwheel={onGridWheel}
    onpointerdown={panPointerDown}
    onpointermove={panPointerMove}
    onpointerup={panPointerUp}
    onpointercancel={panPointerUp}
    use:pinchZoom={{ onZoomIn: () => bumpHourScale(0.15), onZoomOut: () => bumpHourScale(-0.15) }}
  >
    <!-- Single content wrapper (like the timeline's .scroll-content) so the
         full-height marker lines can be positioned children that scroll with the
         columns, spanning the sticky header + all-day + body without interruption. -->
    <div class="wg-inner" style="width: {contentW}px;">
    <!-- Tiered day headers (sticky top): Quarter+Year, Month, Date (1M style).
         The corner holds the prev/next-week controls, aligned to the week tier;
         the timezone codes moved down to the all-day corner. -->
    <div class="wg-header" style="width: {contentW}px;">
      <div class="wg-corner" style="width: {gutterW}px;">
        <div class="wg-weeknav">
          <button
            type="button"
            class="wg-weeknav-btn wg-weeknav-prev"
            aria-label="Previous week"
            title="Previous week"
            onclick={() => scrollWeeks(-1)}
          >
            <Icon name="chevron-down" size={13} />
          </button>
          <button
            type="button"
            class="wg-weeknav-btn wg-weeknav-next"
            aria-label="Next week"
            title="Next week"
            onclick={() => scrollWeeks(1)}
          >
            <Icon name="chevron-down" size={13} />
          </button>
        </div>
        <!-- Timezone codes sit on the date-header (day-tier) row, one per zone,
             each the width of its timezone column below. -->
        <div class="wg-corner-tz" style="grid-template-columns: {tzGridCols};">
          {#each tzCols as c (c.tz)}
            <span class="wg-tz" title={c.title} aria-label={c.title}>{c.code}</span>
          {/each}
        </div>
      </div>
      <div class="wg-header-tiers" style="width: {daysW}px;">
        <div class="wg-tier wg-tier-q">
          {#each quarterBands as b (b.key)}
            <div class="wg-band" data-past={bandPast(b) ? 'true' : null} data-temp={bandTemp(b) ? 'true' : null} style="width: {b.span * dayW}px;">
              <span class="wg-band-label" style="left: {gutterW}px;">{b.label}</span>
            </div>
          {/each}
          {#if todayInWindow}
            <!-- Accent "TODAY" tag, left-aligned from the current-day marker line
                 (today column's left edge) with trailing room so its paper halo
                 covers more of the lane. Mirrors the timeline's current-day labels. -->
            <span class="wg-today-tag" style="left: {todayCol * dayW}px;">{todayLabel}</span>
          {/if}
        </div>
        <div class="wg-tier wg-tier-m">
          {#each monthBands as b (b.key)}
            <div class="wg-band wg-band-month" data-past={bandPast(b) ? 'true' : null} data-temp={bandTemp(b) ? 'true' : null} style="width: {b.span * dayW}px;">
              <span class="wg-band-label" style="left: {gutterW}px;">{b.label}</span>
            </div>
          {/each}
        </div>
        <div class="wg-tier wg-tier-w">
          {#each weekBands as b (b.key)}
            <div class="wg-band" data-past={bandPast(b) ? 'true' : null} data-temp={bandTemp(b) ? 'true' : null} style="width: {b.span * dayW}px;">
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
              data-past={d.past ? 'true' : null}
              data-weekend={d.weekend ? 'true' : null}
              data-temp={markerMs != null && markerMs === d.date.getTime() ? 'true' : null}
              data-holiday={blk === 'thick' ? 'true' : null}
              data-observance={blk === 'thin' ? 'true' : null}
              title="Set or clear the day marker"
              onclick={() => toggleTempDay(d.date)}
            >
              <span class="wg-dl" data-full="true"
                >{isDesktop ? d.name : d.short}</span
              >
              <span class="wg-dn" data-mono>{d.num}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- All-day strip (sticky, below the headers); the corner shows each gutter
         zone's 2-letter ISO country code. -->
    <div class="wg-allday" style="width: {contentW}px; top: var(--wg-header-h);">
      <div class="wg-corner wg-allday-corner" style="width: {gutterW}px;"></div>
      <div class="wg-allday-area" style="width: {daysW}px; height: {allDayHeight}px;">
        {#each days as d, i (i)}
          {@const blk = dayBlock(d.date)}
          {#if blk}
            <i
              class="wg-allday-block"
              data-density={blk}
              style="left: {(i / RENDERED_DAYS) * 100}%; width: {(1 / RENDERED_DAYS) * 100}%;"
              aria-hidden="true"
            ></i>
          {/if}
        {/each}
        {#each shownAllDayRows as r (r.ev.uid)}
          <WeekEvent
            event={r.ev}
            tz={tzTop}
            feedColor={feedsById[r.ev.feedId]?.color}
            feedStyle={feedsById[r.ev.feedId]?.style}
            mode="bar"
            isMatch={matchUids.has(r.ev.uid)}
            isCurrent={currentMatchUid === r.ev.uid}
            isPast={r.ev.end.getTime() < nowMs}
            clip={allDayClipped(r)}
            placement={allDayPlacement(r)}
          />
        {/each}
        {#each allDayOverflow as o (o.col)}
          <button
            type="button"
            class="wg-allday-more"
            style="left: {(o.col / RENDERED_DAYS) * 100}%; width: {(1 / RENDERED_DAYS) * 100}%; top: {allDayOverflowTop}px; height: {ALLDAY_ROW_H - 1}px;"
            title="Show all all-day events"
            onclick={() => (allDayExpanded = true)}
          >+{o.n}</button>
        {/each}
      </div>
    </div>

    <!-- Scrollable hour grid -->
    <div class="wg-body" style="width: {contentW}px; min-height: {bodyH}px; margin-top: {BODY_PAD}px;">
      <!-- Timezone label columns (frozen left), one per shown zone -->
      <div class="wg-gutter-group" style="width: {gutterW}px; grid-template-columns: {tzGridCols};">
        {#if hoverMin != null}
          <span class="wg-hover-time" data-mono style="top: {hoverTop}px;" aria-hidden="true"
            >{hourLabel(hoverMin)}</span
          >
        {/if}
        <!-- Live current time (local zone), spanning the whole gutter so it can be
             larger than a single narrow column, centred on the now-line. -->
        {#if localNowTime}
          <span class="wg-now-time" data-mono style="top: {nowTop}px;">{localNowTime}</span>
        {/if}
        {#each tzCols as c, ci (c.tz)}
          <div class="wg-gutter" data-div={ci < numTz - 1 ? 'true' : null}>
            {#each hours as h (h)}
              <span class="wg-hour" data-mono style="top: {h * HOUR_H}px; color: {hourInk(h)};"
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
        onclick={onGridClick}
        ondblclick={onGridCreate}
      >
        {#each days as d, i (i)}
          {@const blk = columnBlock(d.date)}
          <div
            class="wg-daycol"
            data-current={d.isToday ? 'true' : null}
            style="background-image: {colVisible(i)
              ? d.weekend
                ? weekendBg
                : weekdayBg
              : 'none'}; --wg-gap-top: {d.weekend
              ? weekendTone
              : gapShadeTop}; --wg-gap-bot: {d.weekend ? weekendTone : gapShadeBot};"
          >
            {#if blk}
              <i class="wg-block" data-density={blk} aria-hidden="true"></i>
            {/if}
            {#if !d.weekend && colVisible(i)}
              <!-- Primary-zone working-hours edges, in the off-hours tone. -->
              <i class="wg-edge" style="top: {morningTop}px;" aria-hidden="true"></i>
              <i class="wg-edge" style="top: {eveningTop}px;" aria-hidden="true"></i>
              <!-- Each secondary zone's working-hours edges, in the page colour. -->
              {#each tzCols.slice(1) as c (c.tz)}
                <i class="wg-edge wg-edge-2" style="top: {c.morningTopP}px;" aria-hidden="true"></i>
                <i class="wg-edge wg-edge-2" style="top: {c.eveningTopP}px;" aria-hidden="true"></i>
              {/each}
            {/if}
            {#each colVisible(i) ? (timedByDay[i] ?? []) : [] as b (b.ev.uid)}
              <WeekEvent
                event={b.ev}
                tz={tzTop}
                feedColor={feedsById[b.ev.feedId]?.color}
                feedStyle={feedsById[b.ev.feedId]?.style}
                isMatch={matchUids.has(b.ev.uid)}
                isCurrent={currentMatchUid === b.ev.uid}
                isPast={b.ev.end.getTime() < nowMs}
                wrapTitle={blockHeightPx(b) >= WRAP_MIN_H}
                showLocation={blockHeightPx(b) >= LOCATION_MIN_H}
                feedTravel={feedsById[b.ev.feedId]?.travel}
                continuesEnd={b.continuesEnd}
                isFocused={focusedUid === b.ev.uid}
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

      <!-- Live now-line across the day area (only while today is in the window) -->
      {#if todayInWindow}
        <i class="wg-now-line" style="top: {nowTop}px; left: {gutterW}px;" aria-hidden="true"></i>
      {/if}
    </div>
    <!-- Full-height marker column tint + lines: children of the content wrapper so
         they scroll with the columns and run continuously over the sticky header,
         all-day strip and body. Clipped (via .wg-overlays) so they never paint over
         the sticky left gutter as a tinted/marked column scrolls under it — keeping
         the gutter opaque. The temp line is draggable (grab it anywhere along its
         height to move the marker); a dashed line marks today. -->
    <div class="wg-overlays">
    {#if todayInWindow}
      <i class="wg-today-col" style="left: {todayLineLeft}px; width: {dayW}px;" aria-hidden="true"></i>
    {/if}
    {#if markerInWindow}
      <i class="wg-temp-col" style="left: {markerLeft}px; width: {dayW}px;" aria-hidden="true"></i>
    {/if}
    {#if todayInWindow}
      <i class="wg-day-line" data-kind="today" style="left: {todayLineLeft}px;" aria-hidden="true"></i>
    {/if}
    {#if markerInWindow}
      <button
        type="button"
        class="wg-day-line"
        data-kind="temp"
        style="left: {markerLeft}px;"
        aria-label="Drag to move the day marker"
        onpointerdown={markerLinePointerDown}
        onpointermove={markerLinePointerMove}
        onpointerup={markerLinePointerUp}
        onpointercancel={markerLinePointerUp}
      ></button>
    {/if}
    </div>
    </div>
  </div>

</div>

<style>
  .week-grid {
    /* No bottom breathing gap: the scroll's bottom padding used to leave an
       interior strip that only a separate ::after tint covered — and when that
       tint was transparent (a working overlap at midnight) the strip showed
       through as paper, growing with the padding. Zero it so the day columns'
       own background/borders reach the status bar directly, with nothing to leak
       through. The top gap keeps its --wg-body-pad breathing room. */
    --wg-body-pad-bot: 0px;
    /* Off-hours tints: --wg-night where one of the two zones is off, --wg-night-2
       (darker) where both are off. Paper (no tint) marks the working overlap.
       Light scheme: a translucent wash of --ink-color (near-black) so it tracks the flavor. */
    --wg-night: color-mix(in srgb, var(--ink-color) 5%, transparent);
    --wg-night-2: color-mix(in srgb, var(--ink-color) 11%, transparent);
    --wg-night-3: color-mix(in srgb, var(--ink-color) 17%, transparent);
    /* Day-blocking hatch, shared by the date-header cells and the day columns:
       a dense 45° stripe for prominent blocks, a sparse one for observances. */
    --wg-hatch-thick: repeating-linear-gradient(
      45deg, transparent 0, transparent 4px, var(--holiday-stripe) 4.5px, transparent 5px);
    --wg-hatch-thin: repeating-linear-gradient(
      45deg, transparent 0, transparent 9px, var(--holiday-stripe) 9.5px, transparent 10px);
    display: flex;
    flex-direction: column;
    /* height is set inline so it can subtract the search toolbar when open. */
    /* A hairline top edge even under bold borders (the toolbar already has its
       own bottom border, so a 2px line here would read as a double rule). */
    border-top: 1px solid var(--ink-color);
    background: var(--paper-color);
    box-sizing: border-box;
    overflow: hidden;
  }
  :global([data-scheme='dark']) .week-grid {
    /* Off-hours must darken in both schemes, but here --ink-color is near-white — an ink wash
       would lighten. So keep a deliberate dark overlay (a fixed near-black), stronger than the
       light wash since a dark page needs more contrast to read the tint. */
    --wg-night: color-mix(in srgb, #0a0a0a 22%, transparent);
    --wg-night-2: color-mix(in srgb, #0a0a0a 40%, transparent);
    --wg-night-3: color-mix(in srgb, #0a0a0a 55%, transparent);
  }
  .wg-scroll {
    flex: 1;
    /* Scrolls both axes: vertically through the hours, horizontally through the
       days. The hour gutters pin left, the day headers / all-day strip pin top. */
    overflow: auto;
    overscroll-behavior: contain;
    /* Firefox: theme-derived vertical thumb over a transparent track (matching
       the timeline). Firefox can't hide a single axis, so it keeps a thin one. */
    scrollbar-color: var(--ink-muted) transparent;
    /* Scrollable bottom gap so the last hour row clears the edge with the same
       breathing room as the top margin (a flex child's bottom margin isn't
       counted in the scroll area, so the padding lives on the scroller). The
       deeper bottom pad gives the day-column shading room to reach the bar. */
    padding-bottom: var(--wg-body-pad-bot, 21px);
  }
  /* Vertical scrollbar matches the timeline's (transparent track, theme thumb);
     the horizontal scrollbar is hidden — pan horizontally by dragging or with the
     week controls. */
  .wg-scroll::-webkit-scrollbar {
    width: 10px;
    height: 10px;
    background: transparent;
  }
  .wg-scroll::-webkit-scrollbar:horizontal {
    display: none;
  }
  .wg-scroll::-webkit-scrollbar-track,
  .wg-scroll::-webkit-scrollbar-corner {
    background: transparent;
  }
  .wg-scroll::-webkit-scrollbar-thumb {
    background: var(--ink-muted);
    border: 3px solid transparent;
    background-clip: padding-box;
    border-radius: 6px;
  }
  .wg-scroll::-webkit-scrollbar-thumb:hover {
    background: var(--ink-color);
    background-clip: padding-box;
  }
  /* Grab affordance for pointer devices only (touch has native swipe). */
  @media (hover: hover) and (pointer: fine) {
    .wg-scroll {
      cursor: grab;
    }
    .wg-scroll[data-panning='true'] {
      cursor: grabbing;
    }
  }
  /* The scrolled content wrapper (mirrors the timeline's .scroll-content): its
     positioned children scroll with the columns; min-height keeps the marker
     lines full-viewport-tall even when the day content is short. */
  .wg-inner {
    position: relative;
    min-height: 100%;
    /* Column flow so the body can grow to fill any slack below the hour grid —
       at the minimum vertical zoom HOUR_H is floored, leaving a few px between
       the last hour and the viewport bottom. Growing the body there lets the day
       columns' separators + night/weekend shading reach the bottom edge instead
       of leaving a paper strip. */
    display: flex;
    flex-direction: column;
  }
  /* Mobile (touch): hide the scrollbars entirely — swipe still scrolls. */
  @media (pointer: coarse) {
    .wg-scroll {
      scrollbar-width: none;
    }
    .wg-scroll::-webkit-scrollbar {
      display: none;
    }
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
    /* Don't shrink in the flex-column inner (the body grows instead). */
    flex: 0 0 auto;
    height: var(--wg-header-h);
    background: var(--paper-color);
    border-bottom: var(--border-w) solid var(--ink-color);
  }
  .wg-corner {
    position: sticky;
    left: 0;
    /* Above the header tiers so date cells slide out of sight behind it when
       the grid is scrolled horizontally (opaque paper background). */
    z-index: 3;
    flex: 0 0 auto;
    display: grid;
    /* Codes align to the top (Quarter) band rather than centring over the whole
       header, so they line up with the Q/Year tier's label. */
    align-items: start;
    box-sizing: border-box;
    background: var(--paper-color);
    border-right: var(--border-w) solid var(--ink-color);
  }
  .wg-tz {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    font-size: var(--fs-10);
    line-height: 1;
    color: var(--ink-color);
    white-space: nowrap;
    overflow: hidden;
  }
  .wg-tz:not(:first-child) {
    border-left: var(--border-w) solid var(--ink-color);
  }
  /* Prev/next-week controls in the header corner, aligned to the week tier row. */
  .wg-weeknav {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(var(--tier-q-h, 21px) + var(--tier-m-h, 18px));
    height: var(--tier-w-h, 18px);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
  }
  .wg-weeknav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ink-color);
    cursor: pointer;
  }
  /* Reuse the thin chevron-down glyph rotated into < and > (angle brackets),
     rather than the shared solid-triangle chevron-left/right icons. */
  .wg-weeknav-prev :global(.icon) {
    transform: rotate(90deg);
  }
  .wg-weeknav-next :global(.icon) {
    transform: rotate(-90deg);
  }
  /* Timezone codes on the date-header (day-tier) row, gridded so each aligns
     with — and matches the width of — its hour-label column below. A top border
     separates them from the week-nav row above, matching the date cells' tier. */
  .wg-corner-tz {
    position: absolute;
    left: 0;
    right: 0;
    /* Bottom-anchored to the header's bottom edge — the same edge the day-name row
       (.wg-tier-d) ends on — so the two rows line up. The height is --tier-d-h
       PLUS one border-width: the date row's top rule is the week tier's
       border-bottom (rendered just ABOVE the day-name box), so extending this box
       up by that border puts our own border-top on the same pixel row instead of
       1px below it. */
    bottom: 0;
    height: calc(var(--tier-d-h, 28px) + var(--border-w));
    display: grid;
    border-top: var(--border-w) solid var(--ink-color);
  }

  .wg-header-tiers {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
  }
  .wg-tier {
    display: flex;
    /* border-box so each tier's border-bottom sits inside its --tier-*-h height;
       otherwise the borders accumulate and the date row drifts below the tz-code
       row (which is positioned from those tokens). */
    box-sizing: border-box;
  }
  .wg-tier-q {
    height: var(--tier-q-h, 21px);
    /* Positioning context for the absolutely-placed "TODAY" tag. */
    position: relative;
  }
  /* Accent day marker on the Quarter lane, centered over today's column. Same
     look as the timeline's current-day labels: accent ink + a paper halo. */
  .wg-today-tag {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    /* Left-aligned from the marker line: a small gap off the line, then ~1em of
       trailing room so the paper halo obscures more of the lane behind it. */
    padding: 0 1em 0 0.35em;
    font-size: var(--fs-12);
    line-height: 1;
    letter-spacing: 0.04em;
    color: var(--accent-color);
    filter: var(--clock-halo);
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
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
    border-bottom: var(--border-w) solid var(--ink-color);
  }
  .wg-tier-d {
    display: grid;
    /* Explicit height (matching --tier-d-h, the value baked into headerH) instead
       of flex-grow, so it can't round apart from the tz-code row (.wg-corner-tz). */
    flex: 0 0 auto;
    height: var(--tier-d-h, 28px);
  }
  .wg-band {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    border-left: var(--border-w) solid var(--ink-color);
    font-size: var(--fs-11);
    line-height: 1;
    color: var(--ink-color);
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
    font-size: var(--fs-12);
  }
  .wg-band-month .wg-band-label {
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  /* Past periods fade (like the timeline header); the temp marker's period reads
     accent. Past first so a marker on a past week/month/quarter still shows accent. */
  .wg-band[data-past='true'] .wg-band-label {
    color: var(--ink-faint);
  }
  .wg-band[data-temp='true'] .wg-band-label {
    color: var(--accent-color);
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
    border-left: var(--border-w) solid var(--ink-color);
    border-radius: 0;
    padding: 0;
    margin: 0;
    /* Opaque so day columns don't show through the sticky header while scrolling. */
    background: var(--paper-color);
    color: var(--ink-color);
    font: inherit;
    cursor: pointer;
  }
  .wg-datecell:focus-visible {
    outline: calc(var(--border-w) * 2) solid var(--accent-color);
    outline-offset: -2px;
  }
  .wg-datecell[data-weekend='true'] {
    background: var(--weekend-bg);
  }
  /* A set day marker faintly tints its date cell — no outline (the body band is
     the primary indicator). */
  .wg-datecell[data-temp='true'] {
    background: color-mix(in srgb, var(--accent-color) 12%, transparent);
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
    background-image: var(--wg-hatch-thick);
  }
  .wg-datecell[data-observance='true']::before {
    background-image: var(--wg-hatch-thin);
  }
  .wg-datecell > * {
    position: relative;
    z-index: 1;
  }
  .wg-dl,
  .wg-dn {
    /* Match the other header tiers' band labels (fs-11); name and number share
       the one size. */
    font-size: var(--fs-11);
    line-height: 1;
    color: var(--ink-color);
  }
  /* Desktop: the full weekday name, uppercased (matches the month-band caps). */
  .wg-dl[data-full='true'] {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wg-datecell[data-weekend='true'] .wg-dl,
  .wg-datecell[data-weekend='true'] .wg-dn {
    color: var(--ink-muted);
  }
  /* Past days fade (after weekend so a past weekend fades too); current/temp
     below still win since they come later. */
  .wg-datecell[data-past='true'] .wg-dl,
  .wg-datecell[data-past='true'] .wg-dn {
    color: var(--ink-faint);
  }
  /* Today reads as bold accent; the temp-marker day reads as accent — a day that
     is both shows bold accent. */
  .wg-datecell[data-current='true'] .wg-dl,
  .wg-datecell[data-current='true'] .wg-dn {
    color: var(--accent-color);
    font-weight: 700;
  }
  .wg-datecell[data-temp='true'] .wg-dl,
  .wg-datecell[data-temp='true'] .wg-dn {
    color: var(--accent-color);
  }

  .wg-allday {
    position: sticky;
    z-index: 6;
    display: flex;
    /* Don't shrink in the flex-column inner (the body grows instead). */
    flex: 0 0 auto;
    background: var(--paper-color);
    border-bottom: var(--border-w) solid var(--ink-color);
  }
  .wg-allday-corner {
    z-index: 1;
    /* No vertical gutter edge across the all-day lane — the line is kept in the
       header corner above and the body gutter below, but deliberately broken
       here so the all-day strip reads as one continuous band. */
    border-right: none;
    /* Timezone codes fill the strip height and centre their text. */
    align-items: stretch;
  }
  .wg-allday-area {
    position: relative;
    flex: 0 0 auto;
    min-height: 100%;
  }
  /* "+N" overflow chip for a day with more all-day events than the cap shows. */
  /* Text-only "+N" overflow indicator — no border or fill, just the count in the
     same positioned clickable box. Text tint (accent hover / --link-color focus)
     comes from the global button rules. */
  .wg-allday-more {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin-right: 1px;
    border: none;
    background: transparent;
    color: var(--ink-muted);
    font-size: var(--fs-10);
    line-height: 1;
    cursor: pointer;
  }

  .wg-body {
    position: relative;
    display: flex;
    /* Grow past the 24h grid (min-height) to fill the inner, so the day columns
       stretch and their separators/shading reach the bottom (see .wg-inner). */
    flex: 1 1 auto;
  }
  .wg-gutter-group {
    position: sticky;
    left: 0;
    z-index: 4;
    flex: 0 0 auto;
    display: grid;
    box-sizing: border-box;
    background: var(--paper-color);
  }
  /* Opaque paper covering the gutter's x-range through the top & bottom body
     gaps (BODY_PAD), so day columns scrolling under the sticky gutter don't
     peek through there. Absolute → out of the grid flow (like ::after); z0
     keeps it behind the tz columns and the z3 border/divider strips. */
  .wg-gutter-group::before {
    content: '';
    position: absolute;
    top: calc(-1 * var(--wg-body-pad, 7px));
    bottom: calc(-1 * var(--wg-body-pad-bot, 21px));
    left: 0;
    right: 0;
    background: var(--paper-color);
    pointer-events: none;
    z-index: 0;
  }
  /* The ink right border is drawn as an overlay strip rather than a box
     border-right: the opaque tz columns (grid summing to the full gutter width)
     otherwise paint over a box border and hide it. The strip runs the full body
     height plus the top & bottom gaps so it reads as tall as the day columns. */
  .wg-gutter-group::after {
    content: '';
    position: absolute;
    top: calc(-1 * var(--wg-body-pad, 7px));
    bottom: calc(-1 * var(--wg-body-pad-bot, 21px));
    right: 0;
    width: var(--border-w);
    background: var(--ink-color);
    pointer-events: none;
    z-index: 3;
  }
  .wg-gutter {
    position: relative;
    /* Opaque so day columns don't show through while scrolling horizontally. */
    background: var(--paper-color);
  }
  /* The divider between timezone columns runs the full body height (plus the top
     & bottom gaps), like the gutter's right border — an overlay strip so the
     opaque columns can't paint over it. It lives only in the body columns, not
     the header corner. */
  .wg-gutter[data-div='true']::after {
    content: '';
    position: absolute;
    top: calc(-1 * var(--wg-body-pad, 7px));
    bottom: calc(-1 * var(--wg-body-pad-bot, 21px));
    right: 0;
    width: var(--border-w);
    background: var(--ink-color);
    pointer-events: none;
    z-index: 3;
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
  /* Live current time on the hour axis, in accent, centred on the now-line and
     spanning the whole gutter so it reads at a legible size. Treated like the
     timeline's current-time / marker labels: a paper halo (--clock-halo) instead
     of a solid background, so it floats above the gridlines and dividers. */
  .wg-now-time {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 4;
    text-align: center;
    transform: translateY(-50%);
    font-size: var(--fs-11);
    letter-spacing: -0.2px;
    line-height: 1;
    color: var(--accent-color);
    filter: var(--clock-halo);
    white-space: nowrap;
    pointer-events: none;
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
    position: relative;
    /* Stretch the (single) implicit row so the day columns fill the body's grown
       height — their separators + shading then reach the viewport bottom. */
    align-content: stretch;
  }
  /* The hour gridlines paint at the TOP of each hour row, which leaves the
     23:00 row open-ended — close the grid with a matching line at 24:00. Pinned
     to the real grid bottom (--wg-body-h) rather than the box bottom, which now
     extends past the hours when the body grows to fill the viewport. */
  .wg-days::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: var(--wg-body-h);
    border-top: var(--border-w) solid var(--weekend-bg);
    pointer-events: none;
  }
  .wg-daycol {
    position: relative;
    border-left: var(--border-w) solid var(--weekend-bg);
    background-repeat: repeat;
    /* Isolate each day-column's layout so a change in one column's events can't
       reflow its 90 neighbours. Layout-only (not paint) so nothing is clipped. */
    contain: layout;
  }
  /* Extend each day-column into the top & bottom margin gaps: the dashed
     separator line continues (border-left) and the column's edge day/night tone
     fills the gap (--wg-gap-top/-bot), so the shade stays connected past the
     hour grid instead of leaving a paper break. */
  .wg-daycol::before,
  .wg-daycol::after {
    content: '';
    position: absolute;
    left: calc(-1 * var(--border-w));
    right: 0;
    border-left: var(--border-w) dashed var(--weekend-bg);
    pointer-events: none;
  }
  .wg-daycol::before {
    height: var(--wg-body-pad, 7px);
    top: calc(-1 * var(--wg-body-pad, 7px));
    background: var(--wg-gap-top, transparent);
  }
  .wg-daycol::after {
    height: var(--wg-body-pad-bot, 21px);
    bottom: calc(-1 * var(--wg-body-pad-bot, 21px));
    background: var(--wg-gap-bot, transparent);
  }
  /* Day-blocking hatch over the whole day column (global or local block); a
     fixed pattern extended into the ±BODY_PAD gaps so the hatch runs unbroken
     past the hour grid. */
  .wg-block {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(-1 * var(--wg-body-pad, 7px));
    bottom: calc(-1 * var(--wg-body-pad-bot, 21px));
    background-attachment: fixed;
    opacity: 0.6;
    pointer-events: none;
    z-index: 0;
  }
  .wg-block[data-density='thick'] {
    background-image: var(--wg-hatch-thick);
  }
  .wg-block[data-density='thin'] {
    background-image: var(--wg-hatch-thin);
  }
  /* Same day-blocking hatch behind the all-day lane, one strip per blocked day
     column. Sits under the bars (z-index 0 vs the pills' 1); the fixed pattern
     lines its stripes up with the day-column hatch in the grid below. */
  .wg-allday-block {
    position: absolute;
    top: 0;
    bottom: 0;
    background-attachment: fixed;
    opacity: 0.6;
    pointer-events: none;
    z-index: 0;
  }
  .wg-allday-block[data-density='thick'] {
    background-image: var(--wg-hatch-thick);
  }
  .wg-allday-block[data-density='thin'] {
    background-image: var(--wg-hatch-thin);
  }
  /* Dashed working-hours edges for both zones — kept at the stronger --ink-faint
     (not the softer separator tone) so the day/night overlap boundaries stay
     legible, matching the darker hour text the timezone columns show there.
     Primary marks the top zone's morning/evening, secondary the bottom zone's
     (mapped onto the primary axis). */
  .wg-edge {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: var(--border-w) dashed var(--ink-faint);
    pointer-events: none;
    z-index: 0;
  }
  .wg-edge-2 {
    border-top-color: var(--ink-faint);
  }

  /* Overlay layer for the column tints + marker lines. Sits above the sticky
     header/all-day/body (z8) so the tints/lines run over them in the day area,
     but is clipped to start at the sticky gutter's right edge so nothing paints
     over the opaque left gutter as a tinted/marked column scrolls under it. */
  .wg-overlays {
    position: absolute;
    inset: 0;
    z-index: 8;
    pointer-events: none;
    /* Clip only the left (gutter) edge; extend the other sides so the tints/lines
       keep reaching into the ±BODY_PAD gaps (never clipped top/right/bottom). */
    clip-path: inset(-100px -100px -100px var(--wg-gutter-clip, 0px));
  }
  /* Full-height column tints, spanning the header + all-day + body (above the
     sticky header at z7) and reaching into the ±BODY_PAD gaps so they follow the
     line flush with the day columns. Today reads as a faint accent wash; the temp
     marker is a stronger band drawn after it so it wins when a day is both. */
  .wg-today-col,
  .wg-temp-col {
    position: absolute;
    top: 0;
    bottom: calc(-1 * var(--wg-body-pad-bot, 21px));
    pointer-events: none;
    z-index: 7;
  }
  .wg-today-col {
    background-color: color-mix(in srgb, var(--accent-color) 5%, transparent);
  }
  .wg-temp-col {
    background: var(--accent-color);
    opacity: 0.18;
  }
  /* Full-height marker lines over the sticky header + all-day + body (z-index
     above the header at z7), reaching into the ±BODY_PAD gaps. Solid for the temp
     marker, dashed for today — matching the horizontal timeline. */
  .wg-day-line {
    position: absolute;
    top: 0;
    bottom: calc(-1 * var(--wg-body-pad-bot, 21px));
    width: 1.5px;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: none;
    pointer-events: none;
    z-index: 8;
  }
  /* The temp line is a drag handle: grab it anywhere along its full height to
     move the marker. A widened transparent hit area makes it easy to catch. */
  .wg-day-line[data-kind='temp'] {
    background: var(--accent-color);
    pointer-events: auto;
    cursor: ew-resize;
    touch-action: none;
  }
  .wg-day-line[data-kind='temp']::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: calc(-1 * var(--wg-body-pad-bot, 21px));
    left: -10px;
    right: -10px;
  }
  .wg-day-line[data-kind='today'] {
    width: 0;
    border-left: 1.5px dashed var(--accent-color);
  }
  .wg-now-line {
    position: absolute;
    right: 0;
    height: 0;
    border-top: 1.5px dashed var(--accent-color);
    pointer-events: none;
    z-index: 3;
  }

  /* Hover crosshair: an accent line across the day area, with the exact time in
     the gutter at the same row — given the same treatment as the current-time
     marker (accent + paper halo) so it reads as a "point in time" cursor. */
  .wg-hover-line {
    position: absolute;
    right: 0;
    height: 0;
    border-top: var(--border-w) solid var(--accent-color);
    pointer-events: none;
    z-index: 2;
  }
  .wg-hover-time {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    transform: translateY(-50%);
    font-size: var(--fs-11);
    letter-spacing: -0.2px;
    line-height: 1;
    color: var(--accent-color);
    filter: var(--clock-halo);
    white-space: nowrap;
    pointer-events: none;
    z-index: 5;
  }
</style>
