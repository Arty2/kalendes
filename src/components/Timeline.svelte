<script lang="ts">
  import IconButton from './IconButton.svelte';
  import TimeHeader from './TimeHeader.svelte';
  import Row from './Row.svelte';
  import { zoom, search, config, focus, ui, displayEventsFor, effectiveFeedTz } from '../lib/state.svelte';
  import { getMatches, getMatchUids, getCurrentMatchUid } from '../lib/search-state.svelte';
  import { computePxPerDay, dateToPx, msToPx, pxToDate, LANE_HEIGHT, ROW_PADDING_PX, assignLanes } from '../lib/layout';
  import type { CalendarFeed, DisplayEvent, LaneEvent, StyleVariant, Zoom } from '../lib/types';
  import { MS_PER_DAY, ticksBetween, addDays } from '../lib/time';
  import { isWeekend, tzOffsetMinutesVsDisplay } from '../lib/format';
  import { pinchZoom } from '../lib/pinch';
  import { wheelZoom } from '../lib/wheel-zoom';
  import { clock } from '../lib/clock.svelte';
  import { untrack } from 'svelte';
  import {
    activeLanesAt,
    crossings,
    uniqueVoices,
    sweepDurationMs,
    laneToFrequency,
    voiceStep,
    playBell,
    playWhistle,
    primeTimelineAudio,
    suspendTimelineAudio,
    type LaneSpan,
  } from '../lib/timeline-music';

  const RIGHT_PAD_PX = 280;

  type Props = { rangeStart: Date; rangeEnd: Date; today: Date };
  const { rangeStart, rangeEnd, today: todayDate }: Props = $props();

  let viewportWidth = $state(0);
  // Font-size scale also widens day/week columns so the header labels (and pill
  // text) keep their proportions as the font grows.
  const fontScale = $derived(config.fontSize / 14);
  const pxPerDay = $derived(computePxPerDay(zoom.value, viewportWidth) * fontScale);
  const totalWidth = $derived(((rangeEnd.getTime() - rangeStart.getTime()) / MS_PER_DAY) * pxPerDay);
  const nowDateForLine = $derived(zoom.value === 'month' ? new Date(clock.now) : todayDate);
  const todayPx = $derived(dateToPx(nowDateForLine, rangeStart, pxPerDay));
  const searchActive = $derived(search.query.trim().length > 0);

  const orderedFeeds = $derived(
    [...config.feeds].filter((f) => !f.hidden).sort((a, b) => a.order - b.order),
  );
  const expandedRowIndex = $derived.by<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    let i = 0;
    for (const f of orderedFeeds) {
      if (!f.collapsed) {
        out[f.id] = i;
        i++;
      }
    }
    return out;
  });

  const displayByFeed = $derived.by<Record<string, DisplayEvent[]>>(() => {
    const out: Record<string, DisplayEvent[]> = {};
    for (const feed of config.feeds) out[feed.id] = displayEventsFor(feed.id);
    return out;
  });

  const visibleByFeed = $derived.by<Record<string, DisplayEvent[]>>(() => {
    const out: Record<string, DisplayEvent[]> = {};
    for (const feed of config.feeds) {
      if (feed.collapsed) continue;
      // Time-limit-hidden events are omitted, but Hidden-style events still
      // render (as a faint, label-less placeholder pill).
      out[feed.id] = (displayByFeed[feed.id] ?? []).filter(
        (e) => !e.hidden || e.styleVariant === 'hidden',
      );
    }
    return out;
  });

  const matches = $derived(getMatches());
  const matchUids = $derived(getMatchUids());
  const currentMatchUid = $derived(getCurrentMatchUid());

  const monthStartsPx = $derived.by(() => {
    const todayMs = todayDate.getTime();
    return ticksBetween(addDays(rangeStart, 1), rangeEnd, 'month').map((d) => ({
      px: dateToPx(d, rangeStart, pxPerDay),
      past: d.getTime() < todayMs,
    }));
  });

  const allDays = $derived(ticksBetween(rangeStart, rangeEnd, 'day'));

  const weekendStrips = $derived.by(() => {
    const out: { left: number; width: number; past: boolean }[] = [];
    const todayMs = todayDate.getTime();
    for (const d of allDays) {
      if (isWeekend(d)) {
        out.push({
          left: dateToPx(d, rangeStart, pxPerDay),
          width: pxPerDay,
          past: d.getTime() < todayMs,
        });
      }
    }
    return out;
  });

  const dayTicksPx = $derived.by(() => {
    if (pxPerDay < 30) return [] as { px: number; past: boolean }[];
    const todayMs = todayDate.getTime();
    return allDays.map((d) => ({
      px: dateToPx(d, rangeStart, pxPerDay),
      past: d.getTime() < todayMs,
    }));
  });

  // Resolve an event's effective style the same way EventPill does, so the
  // row/header hatch matches what each pill renders as.
  function effectiveStyle(ev: DisplayEvent, feed: CalendarFeed): StyleVariant {
    if (ev.styleVariant !== 'none') return ev.styleVariant;
    if (feed.style) return feed.style;
    if (feed.category === 'holidays') return 'bold';
    return 'none';
  }

  // Hatch density by effective style: prominent styles get the heavy hatch,
  // tentative ones the discreet hatch, and struck/hidden contribute nothing.
  function hatchDensity(ev: DisplayEvent, feed: CalendarFeed): 'thick' | 'thin' | 'none' {
    const s = effectiveStyle(ev, feed);
    if (s === 'striked' || s === 'hidden') return 'none';
    if (s === 'dashed' || s === 'muted') return 'thin';
    return 'thick';
  }

  function dayKeyOf(d: Date): string {
    return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
  }

  function eventDayKeys(ev: DisplayEvent): string[] {
    const keys: string[] = [];
    const start = ev.start;
    const lastMs = ev.allDay ? Math.max(start.getTime(), ev.end.getTime() - 1) : ev.end.getTime();
    let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const last = Date.UTC(
      new Date(lastMs).getUTCFullYear(),
      new Date(lastMs).getUTCMonth(),
      new Date(lastMs).getUTCDate(),
    );
    while (cursor <= last) {
      keys.push(dayKeyOf(new Date(cursor)));
      cursor += MS_PER_DAY;
    }
    return keys;
  }

  // Hatch classification for the time header and per-feed row bodies, driven
  // by each event's effective style (see hatchDensity):
  //   thick  = prominent (none/bold/inverted)
  //   thin   = tentative (dashed/muted)
  //   none   = struck/hidden -> no hatch
  // Holiday-category thick events span the full timeline as a band; their thin
  // events are confined to the row. Observance-category events are confined to
  // their own row (thick or thin) and never touch the header. The header only
  // reflects holiday-category days.
  const dayHatch = $derived.by(() => {
    const thickHeader = new Set<string>();
    const thinHeader = new Set<string>();
    const bandKeys = new Set<string>();
    const thickByFeed: Record<string, Set<string>> = {};
    const thinByFeed: Record<string, Set<string>> = {};
    for (const feed of config.feeds) {
      if (feed.hidden) continue;
      if (feed.category !== 'holidays' && feed.category !== 'observances') continue;
      const isHoliday = feed.category === 'holidays';
      const events = displayByFeed[feed.id] ?? [];
      for (const ev of events) {
        const density = hatchDensity(ev, feed);
        if (density === 'none') continue;
        const days = eventDayKeys(ev);
        if (density === 'thick') {
          if (isHoliday) {
            for (const d of days) {
              thickHeader.add(d);
              bandKeys.add(d);
            }
          } else {
            for (const d of days) (thickByFeed[feed.id] ??= new Set()).add(d);
          }
        } else {
          if (isHoliday) for (const d of days) thinHeader.add(d);
          for (const d of days) (thinByFeed[feed.id] ??= new Set()).add(d);
        }
      }
    }
    return { thickHeader, thinHeader, bandKeys, thickByFeed, thinByFeed };
  });

  const thickDayKeys = $derived(dayHatch.thickHeader);
  const thinDayKeys = $derived(dayHatch.thinHeader);

  // Day-key strings depend only on the date range (allDays), not zoom, so
  // precompute them once. stripsForKeys then only does cheap px arithmetic per
  // zoom instead of rebuilding a key string for every day.
  const allDayKeys = $derived(allDays.map(dayKeyOf));

  function stripsForKeys(dayKeys: Set<string>): { left: number; width: number }[] {
    if (dayKeys.size === 0) return [];
    const out: { left: number; width: number }[] = [];
    for (let i = 0; i < allDays.length; i++) {
      if (dayKeys.has(allDayKeys[i]!)) {
        out.push({ left: dateToPx(allDays[i]!, rangeStart, pxPerDay), width: pxPerDay });
      }
    }
    return out;
  }

  function stripsByFeed(
    byFeed: Record<string, Set<string>>,
  ): Record<string, { left: number; width: number }[]> {
    const out: Record<string, { left: number; width: number }[]> = {};
    for (const [feedId, dayKeys] of Object.entries(byFeed)) {
      out[feedId] = stripsForKeys(dayKeys);
    }
    return out;
  }

  const holidayStrips = $derived(stripsForKeys(dayHatch.bandKeys));
  const vHolidayStrips = $derived(
    holidayStrips.filter(
      (h) =>
        !(visibleRight > visibleLeft) ||
        (h.left <= visibleRight && h.left + h.width >= visibleLeft),
    ),
  );
  const thickStripsByFeed = $derived(stripsByFeed(dayHatch.thickByFeed));
  const thinStripsByFeed = $derived(stripsByFeed(dayHatch.thinByFeed));

  // Cache the per-feed start-sorted event array keyed by array identity.
  // visibleByFeed arrays keep their reference across zoom (pxPerDay isn't one
  // of their dependencies), so this skips the O(n log n) sort on every zoom.
  const sortedCache = new Map<string, { ref: DisplayEvent[]; sorted: DisplayEvent[] }>();
  function sortedFor(feedId: string, arr: DisplayEvent[]): DisplayEvent[] {
    const cached = sortedCache.get(feedId);
    if (cached && cached.ref === arr) return cached.sorted;
    const sorted = [...arr].sort((a, b) => a.start.getTime() - b.start.getTime());
    sortedCache.set(feedId, { ref: arr, sorted });
    return sorted;
  }

  // Lane metrics scale with the font-size setting so taller text fits; must
  // match EventPill's top-offset math.
  const laneH = $derived(Math.round(LANE_HEIGHT * fontScale));
  const rowPad = $derived(Math.round(ROW_PADDING_PX * fontScale));

  const rowLanes = $derived.by(() => {
    const result: Record<string, { height: number; laneEvents: LaneEvent[] }> = {};
    for (const feed of orderedFeeds) {
      if (feed.collapsed) {
        result[feed.id] = { height: laneH + rowPad * 2, laneEvents: [] };
        continue;
      }
      const arr = visibleByFeed[feed.id] ?? [];
      const sorted = sortedFor(feed.id, arr);
      const { laneEvents, laneCount } = assignLanes(sorted, pxPerDay, rangeStart, undefined, true);
      result[feed.id] = {
        height: Math.max(laneH, laneCount * laneH) + rowPad * 2,
        laneEvents,
      };
    }
    return result;
  });

  let scrollEl: HTMLElement | undefined = $state();
  let didCenter = false;

  // --- Timeline music Easter egg (armed by the 5s hold on the date button) ---
  // Events in expanded rows become notes: each row gets its own base pitch (by
  // its display order) and the collision sub-lane steps up from there, so every
  // row sounds distinct. All-day events sound too (holiday calendars are
  // entirely all-day). Collapsed rows carry no laneEvents, so they stay silent.
  // Returns early while the egg is off so it never subscribes to layout state
  // (orderedFeeds/rowLanes) and never recomputes on zoom/scroll/refresh.
  const NO_SPANS: LaneSpan[] = [];
  const timedLaneSpans = $derived.by<LaneSpan[]>(() => {
    if (!ui.timelineMusic) return NO_SPANS;
    const spans: LaneSpan[] = [];
    let row = 0;
    for (const feed of orderedFeeds) {
      for (const ev of rowLanes[feed.id]?.laneEvents ?? []) {
        spans.push({
          key: feed.id + ':' + ev.uid + ':' + ev.start.getTime(),
          startMs: ev.start.getTime(),
          endMs: ev.end.getTime(),
          lane: voiceStep(row, ev.lane),
        });
      }
      row++;
    }
    return spans;
  });

  const SWEEP_MS = 5333;
  const SWEEP_VIEWPORTS = 3;
  // Constant pace: one screenful every MS_PER_VIEWPORT, so the sweep keeps the
  // same feel whether it covers three screens or the whole multi-year timeline.
  const MS_PER_VIEWPORT = SWEEP_MS / SWEEP_VIEWPORTS;
  // Most distinct bells/whistles to fire in a single sound batch — a dense
  // holiday stretch would otherwise stack into static.
  const MAX_VOICES_PER_STEP = 4;
  // Sounds are emitted on this real-time grid, not every frame: rapidly-entered
  // voices collapse into one deduped batch, which keeps the fast sweep from
  // stacking thousands of oscillators into a screech.
  const SWEEP_SOUND_GAP_MS = 80;
  // Keep audio alive past a bell's tail (~1.1s) when disabling, so the final
  // beat of the reversed countdown rings out instead of being cut by suspend().
  const BELL_TAIL_MS = 1300;
  let sweepRaf = 0;
  let sweepRunning = false;
  // Marker visibility is reactive; its position is set imperatively each frame
  // (see startSweep) so it stays glued to the natively-scrolling content with no
  // reactive-flush lag that would otherwise make it jitter.
  let sweepActive = $state(false);
  let sweepMarkerEl = $state<HTMLDivElement | undefined>(undefined);
  let ambientSet = new Map<string, number>();
  let ambientSeeded = false;
  let ambientNow = -1;

  // One accelerated pass of a virtual playhead, starting at the current left
  // edge and travelling all the way to the end of the timeline, ringing a bell
  // on each event it enters and a whistle as it leaves. The viewport follows the
  // marker (kept centered on screen). When the sweep reaches the end it glides
  // back to the current date. Seeded with whatever's already under the start so
  // we only sound events the playhead actively crosses into.
  function startSweep(): void {
    cancelAnimationFrame(sweepRaf);
    if (!scrollEl) {
      sweepRunning = false;
      return;
    }
    const vw = scrollEl.clientWidth;
    const startLeft = scrollEl.scrollLeft;
    const startMs = pxToDate(startLeft, rangeStart, pxPerDay).getTime();
    const endMs = pxToDate(totalWidth, rangeStart, pxPerDay).getTime();
    const durationMs = sweepDurationMs(totalWidth - startLeft, vw, MS_PER_VIEWPORT);
    // Timeline-ms advanced per real-ms; the playhead is integrated by this rate
    // each frame (below) rather than from absolute elapsed time.
    const speed = durationMs > 0 ? (endMs - startMs) / durationMs : endMs - startMs;
    const spans = timedLaneSpans;
    let prev = activeLanesAt(startMs, spans);
    let ph = startMs;
    let tPrev = performance.now();
    let lastSoundT = tPrev;
    sweepRunning = true;
    sweepActive = true;
    ui.musicSweeping = true;
    const step = (tNow: number): void => {
      // Integrate the playhead with a clamped per-frame delta: a delayed or
      // background-throttled frame just slows the sweep instead of jumping the
      // centred line forward to "catch up".
      const dt = Math.min(tNow - tPrev, 48);
      tPrev = tNow;
      ph = Math.min(endMs, ph + speed * dt);
      // Emit sounds on a real-time grid, advancing `prev` only when we sound, so
      // voices entered between grid points collapse into one deduped batch
      // instead of firing every frame and stacking into static. The O(n) active
      // scan only runs on the grid (~12/s), not every frame.
      if (tNow - lastSoundT >= SWEEP_SOUND_GAP_MS) {
        const next = activeLanesAt(ph, spans);
        const { entered, exited } = crossings(prev, next);
        for (const v of uniqueVoices(entered, MAX_VOICES_PER_STEP)) playBell(laneToFrequency(v));
        for (const v of uniqueVoices(exited, MAX_VOICES_PER_STEP)) playWhistle(laneToFrequency(v));
        prev = next;
        lastSoundT = tNow;
      }
      const px = msToPx(ph, rangeStart, pxPerDay);
      // Only the timeline scrolls; the line is sticky-pinned to the scrollport
      // (CSS) and merely translated to its on-screen position. It ramps from the
      // left edge to centre over the first half-viewport (the content can't
      // scroll back past the start), then holds dead-centre — immobile — while
      // the timeline scrolls beneath it.
      const scroll = Math.max(startLeft, px - vw / 2);
      if (scrollEl) scrollEl.scrollLeft = scroll;
      if (sweepMarkerEl) sweepMarkerEl.style.transform = `translateX(${px - scroll}px)`;
      if (ph < endMs) {
        sweepRaf = requestAnimationFrame(step);
      } else {
        sweepRunning = false;
        sweepActive = false;
        ui.musicSweeping = false;
        ambientSeeded = false; // hand off to the ambient effect's next tick
        jumpToToday(); // glide back to the current date
      }
    };
    sweepRaf = requestAnimationFrame(step);
  }

  // Stop the sweep but keep the egg on: cancel the animation, drop the marker,
  // and hand off to ambient mode (reseed silently so it doesn't chime everything
  // already under the playhead). Used when a nav button is tapped mid-sweep.
  function stopSweep(): void {
    if (!sweepRunning && !sweepActive) return;
    cancelAnimationFrame(sweepRaf);
    sweepRunning = false;
    sweepActive = false;
    ui.musicSweeping = false;
    ambientSeeded = false;
  }

  // Activate/deactivate. untrack keeps the sweep's reads of zoom/scroll state
  // from making this effect restart the sweep whenever the view changes.
  $effect(() => {
    if (!ui.timelineMusic) return;
    primeTimelineAudio();
    untrack(() => startSweep());
    return () => {
      cancelAnimationFrame(sweepRaf);
      sweepRunning = false;
      sweepActive = false;
      ui.musicSweeping = false;
      ambientSet = new Map();
      ambientSeeded = false;
      ambientNow = -1;
      suspendTimelineAudio(BELL_TAIL_MS);
    };
  });

  // Ambient mode after the sweep: real wall-clock time (ticks each minute)
  // sounds events as it crosses them. Reseeds silently on data reloads so only
  // genuine time advances chime.
  $effect(() => {
    if (!ui.timelineMusic) return;
    const now = clock.now;
    const spans = timedLaneSpans;
    if (sweepRunning) return;
    const next = activeLanesAt(now, spans);
    if (!ambientSeeded || now === ambientNow) {
      ambientSet = next;
      ambientSeeded = true;
      ambientNow = now;
      return;
    }
    const { entered, exited } = crossings(ambientSet, next);
    for (const v of uniqueVoices(entered, MAX_VOICES_PER_STEP)) playBell(laneToFrequency(v));
    for (const v of uniqueVoices(exited, MAX_VOICES_PER_STEP)) playWhistle(laneToFrequency(v));
    ambientSet = next;
    ambientNow = now;
  });

  // The current-time marker is an SVG dashed path that bends per row so it
  // marks the current local time of each row's timezone on the shared date
  // grid. Row vertical extents are measured from the DOM (row height isn't
  // reliably derivable from constants), then the bend math runs reactively.
  let rowBands = $state<{ feedId: string; top: number; height: number }[]>([]);
  let contentHeight = $state(0);

  $effect(() => {
    // Re-measure whenever layout-affecting state changes.
    void orderedFeeds;
    void rowLanes;
    void pxPerDay;
    void viewportWidth;
    void clock.now;
    if (!scrollEl) return;
    const el = scrollEl;
    const raf = requestAnimationFrame(() => {
      const rowsEl = el.querySelector<HTMLElement>('.rows');
      contentHeight = el.scrollHeight;
      if (!rowsEl) {
        rowBands = [];
        return;
      }
      const base = rowsEl.offsetTop;
      const sections = rowsEl.querySelectorAll<HTMLElement>(':scope > section.row');
      const bands: { feedId: string; top: number; height: number }[] = [];
      for (const s of sections) {
        const feedId = s.dataset.feedId;
        if (!feedId) continue;
        bands.push({ feedId, top: base + s.offsetTop, height: s.offsetHeight });
      }
      rowBands = bands;
    });
    return () => cancelAnimationFrame(raf);
  });

  function markerOffsetPx(feedId: string): number {
    const tz = effectiveFeedTz(feedId);
    if (!tz) return 0;
    const mins = tzOffsetMinutesVsDisplay(tz, config.timezone, new Date(clock.now));
    return (mins / 1440) * pxPerDay;
  }

  const markerPath = $derived.by(() => {
    const x0 = todayPx;
    if (rowBands.length === 0) return `M ${x0} 0 L ${x0} ${contentHeight}`;
    const segs = [`M ${x0} 0`, `L ${x0} ${rowBands[0]!.top}`];
    for (const band of rowBands) {
      const x = x0 + markerOffsetPx(band.feedId);
      segs.push(`L ${x} ${band.top}`);
      segs.push(`L ${x} ${band.top + band.height}`);
    }
    const last = rowBands[rowBands.length - 1]!;
    segs.push(`L ${x0} ${last.top + last.height}`);
    segs.push(`L ${x0} ${contentHeight}`);
    return segs.join(' ');
  });

  let scrollLeft = $state(0);
  // Track scroll/viewport for the virtualization window below. Kept to plain
  // state reads — no CSS custom properties: writing an inherited custom prop on
  // the scroll container each frame would invalidate the whole pill/row subtree's
  // style and stutter the scroll in Chrome.
  function updateViewportVars(): void {
    if (!scrollEl) return;
    viewportWidth = scrollEl.clientWidth;
    scrollLeft = scrollEl.scrollLeft;
  }

  // Horizontal window (in content px) of what's rendered, with one viewport of
  // overscan on each side so normal scrolling never reveals un-rendered area.
  // Rows clip pills and background strips to this window; off-screen nodes
  // (which can number in the thousands across a 1-2 year range) are skipped.
  const visibleLeft = $derived(viewportWidth > 0 ? scrollLeft - viewportWidth : 0);
  const visibleRight = $derived(viewportWidth > 0 ? scrollLeft + 2 * viewportWidth : 0);

  let rafScheduled = false;
  let lastInteractionMs = $state(0);
  function markInteraction(): void {
    lastInteractionMs = Date.now();
  }
  function onScroll(): void {
    markInteraction();
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      updateViewportVars();
    });
  }

  $effect(() => {
    if (!scrollEl) return;
    updateViewportVars();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(updateViewportVars);
    ro.observe(scrollEl);
    return () => {
      scrollEl?.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  });

  // Track explicit user input (separate from passive scroll) so the
  // 5-minute idle gate below can tell "user actively interacting" from
  // "user idle while the wall clock ticks."
  $effect(() => {
    if (typeof window === 'undefined') return;
    const events = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'];
    for (const e of events) window.addEventListener(e, markInteraction, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, markInteraction);
    };
  });

  function jumpToToday(): void {
    if (!scrollEl) return;
    scrollEl.scrollTo({ left: Math.max(0, todayPx - scrollEl.clientWidth / 2), behavior: 'smooth' });
  }

  $effect(() => {
    if (!scrollEl || didCenter) return;
    // Wait for the real viewport width: until it's measured, pxPerDay (and so
    // todayPx) use the static fallback scale, which for fit-whole-span zooms
    // lands today far to the left. The effect re-runs once width is known.
    if (viewportWidth <= 0 || totalWidth <= 0) return;
    // Open on today unless a temporary marker (e.g. from a shared #d= fragment)
    // remembers a previous position.
    const targetPx =
      ui.tempMarkerMs != null
        ? dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay)
        : todayPx;
    const el = scrollEl;
    const want = Math.max(0, targetPx - el.clientWidth / 2);
    // Firefox Android applies the .scroll-content width after this effect runs,
    // so a synchronous scrollLeft is clamped to 0 and lost. Apply across a few
    // frames and only latch once it sticks (or the content is wide enough to
    // honour it), so the first paint lands on today on every browser.
    let tries = 0;
    const apply = (): void => {
      el.scrollLeft = want;
      const landed = Math.abs(el.scrollLeft - want) <= 1;
      if (landed || el.scrollWidth - el.clientWidth >= want || tries++ >= 10) {
        didCenter = true;
        return;
      }
      requestAnimationFrame(apply);
    };
    apply();
  });

  // Month zoom: nudge the viewport so the today line stays centered as
  // it drifts during the day. Only re-center when the user has been
  // idle for 5 minutes so panning is never overridden mid-interaction.
  // The today line itself keeps ticking via nowDateForLine -> todayPx.
  const RECENTER_IDLE_MS = 5 * 60 * 1000;
  let lastCenteredPx = -1;
  $effect(() => {
    if (!scrollEl) return;
    if (zoom.value !== 'month') return;
    // depend on clock.now
    void clock.now;
    if (!didCenter) return;
    if (Date.now() - lastInteractionMs < RECENTER_IDLE_MS) return;
    const cur = scrollEl.scrollLeft + scrollEl.clientWidth / 2;
    const drift = Math.abs(cur - todayPx);
    if (drift > scrollEl.clientWidth / 2) return;
    if (lastCenteredPx === todayPx) return;
    lastCenteredPx = todayPx;
    scrollEl.scrollLeft = Math.max(0, todayPx - scrollEl.clientWidth / 2);
  });

  // Jump-to-today requests from the toolbar's date/zoom buttons. Tapping these
  // mid-sweep stops the sweep (egg stays on) before recentering on today.
  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (): void => {
      stopSweep();
      jumpToToday();
    };
    window.addEventListener('cal:jump-today', handler);
    return () => window.removeEventListener('cal:jump-today', handler);
  });

  // Recenter on the current date when the tab returns from the background after
  // an inactivity period. clock.now / today.value are refreshed by their own
  // visibility listeners; defer one frame so todayPx reflects them.
  const BACKGROUND_RECENTER_MS = 60_000;
  let hiddenAt = 0;
  $effect(() => {
    if (typeof document === 'undefined') return;
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > BACKGROUND_RECENTER_MS) {
        stopSweep();
        requestAnimationFrame(() => jumpToToday());
      }
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event): void => {
      if (!scrollEl) return;
      const detail = (e as CustomEvent<{ dir: number }>).detail;
      const dir = detail?.dir ?? 1;
      scrollEl.scrollBy({ left: dir * scrollEl.clientWidth * 0.9, behavior: 'smooth' });
    };
    window.addEventListener('cal:scroll-page', handler);
    return () => window.removeEventListener('cal:scroll-page', handler);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event): void => {
      if (!scrollEl) return;
      const detail = (e as CustomEvent<{ date: Date }>).detail;
      if (!detail) return;
      const px = dateToPx(detail.date, rangeStart, pxPerDay);
      scrollEl.scrollTo({ left: Math.max(0, px - scrollEl.clientWidth / 2), behavior: 'smooth' });
    };
    window.addEventListener('cal:scroll-to-date', handler as EventListener);
    return () => window.removeEventListener('cal:scroll-to-date', handler as EventListener);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ date: Date }>).detail;
      if (!detail) return;
      ui.tempMarkerMs = detail.date.getTime();
    };
    window.addEventListener('cal:set-temp-marker', handler as EventListener);
    return () => window.removeEventListener('cal:set-temp-marker', handler as EventListener);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (): void => {
      ui.tempMarkerMs = null;
    };
    window.addEventListener('cal:clear-temp-marker', handler);
    return () => window.removeEventListener('cal:clear-temp-marker', handler);
  });

  let tempDrag: { startX: number; moved: boolean; pid: number } | null = $state(null);
  let tempLastTapMs = 0;
  let headerTapMs = 0;
  const DOUBLE_TAP_MS = 1200;

  function tempPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    tempDrag = { startX: e.clientX, moved: false, pid: e.pointerId };
    e.stopPropagation();
  }

  function tempPointerMove(e: PointerEvent): void {
    if (!tempDrag || tempDrag.pid !== e.pointerId || !scrollEl) return;
    const dx = e.clientX - tempDrag.startX;
    if (!tempDrag.moved) {
      if (Math.abs(dx) < 4) return;
      tempDrag.moved = true;
    }
    const rect = scrollEl.getBoundingClientRect();
    const xInTimeline = e.clientX - rect.left + scrollEl.scrollLeft;
    const newDate = pxToDate(xInTimeline, rangeStart, pxPerDay);
    ui.tempMarkerMs = Date.UTC(
      newDate.getUTCFullYear(),
      newDate.getUTCMonth(),
      newDate.getUTCDate(),
    );
  }

  function tempPointerUp(e: PointerEvent): void {
    if (!tempDrag || tempDrag.pid !== e.pointerId) return;
    const moved = tempDrag.moved;
    tempDrag = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer capture may already be released */
    }
    if (!moved) {
      const now = Date.now();
      if (now - tempLastTapMs < DOUBLE_TAP_MS) {
        ui.tempMarkerMs = null;
        tempLastTapMs = 0;
      } else {
        tempLastTapMs = now;
      }
    }
  }

  let toggleLast: 'today' | 'temp' = $state('today');
  function toggleTodayTempMarker(): void {
    if (!scrollEl || ui.tempMarkerMs == null) return;
    markInteraction();
    const tempPx = dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay);
    const targetPx = toggleLast === 'today' ? tempPx : todayPx;
    toggleLast = toggleLast === 'today' ? 'temp' : 'today';
    scrollEl.scrollTo({ left: Math.max(0, targetPx - scrollEl.clientWidth / 2), behavior: 'smooth' });
  }

  function onHeaderPointerUp(e: PointerEvent): void {
    if (ui.tempMarkerMs == null || !scrollEl) return;
    const scrollRect = scrollEl.getBoundingClientRect();
    const xInTimeline = e.clientX - scrollRect.left + scrollEl.scrollLeft;
    const markerPx = dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay);
    const headerEl = e.currentTarget as HTMLElement;
    const headerRect = headerEl.getBoundingClientRect();
    const isYearRow = (e.clientY - headerRect.top) < 27;
    const threshold = isYearRow ? Math.max(44, pxPerDay * 2) : Math.max(20, pxPerDay);
    if (Math.abs(xInTimeline - markerPx) > threshold) { headerTapMs = 0; return; }
    const now = Date.now();
    if (now - headerTapMs < DOUBLE_TAP_MS) {
      ui.tempMarkerMs = null;
      headerTapMs = 0;
      tempLastTapMs = 0;
    } else {
      headerTapMs = now;
    }
  }

  function onHeaderDblClick(e: MouseEvent): void {
    if (ui.tempMarkerMs == null || !scrollEl) return;
    const scrollRect = scrollEl.getBoundingClientRect();
    const xInTimeline = e.clientX - scrollRect.left + scrollEl.scrollLeft;
    const markerPx = dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay);
    const headerEl = e.currentTarget as HTMLElement;
    const headerRect = headerEl.getBoundingClientRect();
    // Year/month row is ~27px tall (top tier); use wider threshold there
    const isYearRow = (e.clientY - headerRect.top) < 27;
    const threshold = isYearRow ? Math.max(44, pxPerDay * 2) : Math.max(20, pxPerDay);
    if (Math.abs(xInTimeline - markerPx) <= threshold) {
      ui.tempMarkerMs = null;
      tempLastTapMs = 0;
    }
  }

  const ZOOM_ORDER: Zoom[] = ['month', 'quarter', 'half-year', 'year', '2-year'];

  function setZoomPreservingCenter(next: Zoom, jumpToday = false): void {
    if (!scrollEl) {
      zoom.value = next;
      return;
    }
    const center = scrollEl.scrollLeft + scrollEl.clientWidth / 2;
    const centerDate = pxToDate(center, rangeStart, pxPerDay);
    zoom.value = next;
    queueMicrotask(() => {
      if (!scrollEl) return;
      // Jump-to-today reuses the same path as the toolbar date icon, which
      // reads the reactive todayPx (correctly scaled by the font size) and so
      // stays accurate at non-default font sizes.
      if (jumpToday) {
        jumpToToday();
        return;
      }
      const newPxPerDay = computePxPerDay(next, scrollEl.clientWidth) * fontScale;
      const targetPx = dateToPx(centerDate, rangeStart, newPxPerDay);
      scrollEl.scrollLeft = Math.max(0, targetPx - scrollEl.clientWidth / 2);
    });
  }

  function shiftZoom(dir: -1 | 1): void {
    const i = ZOOM_ORDER.indexOf(zoom.value);
    const next = i + dir;
    if (next >= 0 && next < ZOOM_ORDER.length) setZoomPreservingCenter(ZOOM_ORDER[next]!);
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ zoom: Zoom; jumpToday?: boolean }>).detail;
      if (!detail) return;
      setZoomPreservingCenter(detail.zoom, detail.jumpToday);
    };
    window.addEventListener('cal:set-zoom', handler as EventListener);
    return () => window.removeEventListener('cal:set-zoom', handler as EventListener);
  });

  $effect(() => {
    if (!scrollEl) return;
    const handle = pinchZoom(scrollEl, {
      onZoomIn: () => shiftZoom(-1),
      onZoomOut: () => shiftZoom(1),
    });
    return () => handle.destroy();
  });

  $effect(() => {
    if (!scrollEl) return;
    const handle = wheelZoom(scrollEl, {
      onZoomIn: () => shiftZoom(-1),
      onZoomOut: () => shiftZoom(1),
    });
    return () => handle.destroy();
  });

  $effect(() => {
    if (!scrollEl || !currentMatchUid) return;
    const ev = matches[search.currentIndex]?.event;
    if (!ev) return;
    const px = dateToPx(ev.start, rangeStart, pxPerDay);
    scrollEl.scrollLeft = Math.max(0, px - scrollEl.clientWidth / 2);
  });

  // Scroll to the focused event only when the focus itself changes — not when
  // unrelated state (e.g. expanding/collapsing another row) re-runs the effect.
  let lastScrolledFocus = '';
  $effect(() => {
    if (!scrollEl) return;
    const key = focus.feedId + ':' + focus.eventIndex;
    if (key === lastScrolledFocus) return;
    // Consume the key on any focus change — even when the target row is
    // collapsed — so later expanding that row doesn't trigger a jump-scroll.
    lastScrolledFocus = key;
    const target = orderedFeeds.find((f) => !f.collapsed && f.id === focus.feedId);
    if (!target) return;
    const arr = visibleByFeed[target.id] ?? [];
    const ev = arr[focus.eventIndex];
    if (!ev) return;
    const px = dateToPx(ev.start, rangeStart, pxPerDay);
    scrollEl.scrollTo({ left: Math.max(0, px - scrollEl.clientWidth / 2), behavior: 'smooth' });
  });
</script>

<main
  id="timeline"
  bind:this={scrollEl}
  data-zoom={zoom.value}
  data-search-active={searchActive ? 'true' : null}
  style="height: calc(100dvh - {50 + (search.open ? 44 : 0)}px);"
>
  <div class="scroll-content" style="width: {totalWidth + RIGHT_PAD_PX}px;">
    {#if sweepActive}
      <!-- Zero-size sticky anchor pinned to the scrollport's left edge; the sweep
           loop translateX()es it to the play line's on-screen position. Its inner
           bar is absolutely positioned, so the anchor adds no layout. -->
      <div class="music-sweep" bind:this={sweepMarkerEl} aria-hidden="true">
        <i style="height: {contentHeight}px"></i>
      </div>
    {/if}
    <header id="time-header" role="presentation" ondblclick={onHeaderDblClick} onpointerup={onHeaderPointerUp}>
      <TimeHeader {rangeStart} {rangeEnd} {pxPerDay} {scrollEl} {thickDayKeys} {thinDayKeys} />
      {#if ui.tempMarkerMs != null}
        <div class="toggle-marker-wrap" style="top: {50 + (search.open ? 44 : 0) + 1}px">
          <IconButton
            icon="arrows-horizontal"
            label="Toggle between today and temporary marker"
            variant="ghost"
            size={18}
            onclick={toggleTodayTempMarker}
          />
        </div>
      {/if}
    </header>
    {#each vHolidayStrips as h (h.left)}
      <i class="holiday-band" style="left: {h.left}px; width: {h.width}px"></i>
    {/each}
    <div class="rows">
      {#each orderedFeeds as feed (feed.id)}
        <Row
          {feed}
          events={displayByFeed[feed.id] ?? []}
          laneEvents={rowLanes[feed.id]?.laneEvents ?? []}
          {rangeStart}
          {pxPerDay}
          bodyHeight={rowLanes[feed.id]?.height ?? laneH + rowPad * 2}
          {matchUids}
          {currentMatchUid}
          {scrollEl}
          {monthStartsPx}
          {weekendStrips}
          {dayTicksPx}
          thickStrips={thickStripsByFeed[feed.id] ?? []}
          thinStrips={thinStripsByFeed[feed.id] ?? []}
          rowIndex={expandedRowIndex[feed.id] ?? -1}
          {visibleLeft}
          {visibleRight}
        />
      {/each}
    </div>
    <svg
      class="today-line"
      width={totalWidth + RIGHT_PAD_PX}
      height={contentHeight}
      aria-hidden="true"
    >
      <path
        d={markerPath}
        fill="none"
        stroke="var(--accent)"
        stroke-width="1"
        stroke-dasharray="4 4"
      />
    </svg>
    {#if ui.tempMarkerMs != null}
      <button
        type="button"
        class="temp-line"
        style="left: {dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay)}px; width: {Math.max(2, pxPerDay)}px"
        aria-label="Drag to move or double-tap to clear temporary marker"
        onpointerdown={tempPointerDown}
        onpointermove={tempPointerMove}
        onpointerup={tempPointerUp}
        onpointercancel={tempPointerUp}
      ></button>
    {/if}
  </div>
</main>

<style>
  #timeline {
    overflow: auto;
    background: var(--paper);
    overscroll-behavior: contain;
    touch-action: pan-x pan-y;
  }
  .scroll-content {
    position: relative;
    min-width: 100%;
    min-height: 100%;
  }
  #time-header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--paper);
    border-bottom: 1px solid var(--ink);
    height: 80px;
  }
  .rows {
    position: relative;
    display: flex;
    flex-direction: column;
    padding-bottom: 16px;
  }
  .holiday-band {
    position: absolute;
    top: 80px;
    bottom: 0;
    pointer-events: none;
    z-index: 1;
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 4px,
      var(--holiday-stripe) 4px,
      var(--holiday-stripe) 5px
    );
    background-attachment: fixed;
    opacity: 0.6;
  }
  .today-line {
    position: absolute;
    top: 0;
    left: 0;
    overflow: visible;
    z-index: 6;
    pointer-events: none;
  }
  .music-sweep {
    /* Sticky-pinned to the scrollport's left edge so it stays put while the
       timeline scrolls; the sweep loop translateX()es it to its on-screen
       position (and holds it dead-centre once reached). Zero-size so it adds no
       layout; the visible bar inside is absolutely positioned. */
    position: sticky;
    left: 0;
    width: 0;
    height: 0;
    z-index: 8;
    pointer-events: none;
    will-change: transform;
  }
  .music-sweep > i {
    position: absolute;
    left: 0;
    top: 0;
    width: 2px;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
    opacity: 0.85;
  }
  .temp-line {
    position: absolute;
    top: 0;
    bottom: 0;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--accent);
    opacity: 0.4;
    z-index: 7;
    cursor: ew-resize;
    touch-action: none;
  }
  .temp-line:hover,
  .temp-line:focus-visible {
    opacity: 0.6;
  }
  .toggle-marker-wrap {
    position: fixed;
    right: calc(0.75em + 1px);
    z-index: 11;
    pointer-events: auto;
  }
  .toggle-marker-wrap :global(.icon-button) {
    width: 24px;
    height: 24px;
  }
  .toggle-marker-wrap :global(.icon-button):hover {
    background: transparent;
  }
  .toggle-marker-wrap :global(.icon-button) :global(.icon) {
    color: var(--accent);
    filter: var(--clock-halo);
    transition: none;
  }
</style>
