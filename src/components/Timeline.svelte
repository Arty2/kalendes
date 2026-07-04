<script lang="ts">
  import IconButton from './IconButton.svelte';
  import TimeHeader from './TimeHeader.svelte';
  import Row from './Row.svelte';
  import WeekGrid from './WeekGrid.svelte';
  import { zoom, search, config, focus, ui, displayEventsFor, effectiveFeedTz, timelineEventsFor } from '../lib/state.svelte';
  import { getMatches, getMatchUids, getCurrentMatchUid } from '../lib/search-state.svelte';
  import { computePxPerDay, dateToPx, msToPx, pxToDate, LANE_HEIGHT, ROW_PADDING_PX, assignLanes } from '../lib/layout';
  import { mergeConsecutiveDays } from '../lib/event-display';
  import type { CalendarFeed, DisplayEvent, LaneEvent, Zoom } from '../lib/types';
  import { MS_PER_DAY, ticksBetween, addDays } from '../lib/time';
  import { isWeekend, tzOffsetMinutesVsDisplay } from '../lib/format';
  import { effectiveBlock, hatchDensity, dayKeyOf, eventDayKeys } from '../lib/blocking';
  import { pinchZoom } from '../lib/pinch';
  import { wheelZoom } from '../lib/wheel-zoom';
  import { clock } from '../lib/clock.svelte';
  import { untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import {
    activeLanesAt,
    sweptLanes,
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
    type Crossing,
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

  // Collapse runs of the same event on consecutive days into one continuous bar
  // (see mergeConsecutiveDays). Keyed on visibleByFeed identity + timezone, so it
  // recomputes only when events/tz change — not on every zoom — keeping the
  // sortedFor cache warm. Only read on the horizontal-lane path below (the week
  // view renders WeekGrid off displayEventsFor and is intentionally unmerged).
  const mergedByFeed = $derived.by<Record<string, DisplayEvent[]>>(() => {
    const out: Record<string, DisplayEvent[]> = {};
    for (const feed of config.feeds) {
      const arr = visibleByFeed[feed.id];
      if (!arr) continue;
      out[feed.id] = mergeConsecutiveDays(arr, effectiveFeedTz(feed.id) ?? config.timezone);
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

  // Hatch classification for the time header and per-feed row bodies. Two axes
  // combine: the event's Block (effectiveBlock) decides the scope, its effective
  // style decides the density (see hatchDensity):
  //   thick  = prominent (none/bold/inverted)
  //   thin   = tentative (dashed/muted)
  //   none   = struck/hidden -> no hatch
  // Global-block thick events span the full timeline as a band; their thin events
  // also tint the header and their row. Local-block events are confined to their
  // own row (thick or thin) and never touch the header. A matching rule's block
  // can promote any event to global/local, so every feed is scanned.
  const dayHatch = $derived.by(() => {
    const thickHeader = new Set<string>();
    const thinHeader = new Set<string>();
    const bandKeys = new Set<string>();
    const thickByFeed: Record<string, Set<string>> = {};
    const thinByFeed: Record<string, Set<string>> = {};
    for (const feed of config.feeds) {
      if (feed.hidden) continue;
      const events = displayByFeed[feed.id] ?? [];
      for (const ev of events) {
        const block = effectiveBlock(ev, feed);
        if (block === 'none') continue;
        const density = hatchDensity(ev, feed);
        if (density === 'none') continue;
        const isGlobal = block === 'global';
        const days = eventDayKeys(ev);
        if (density === 'thick') {
          if (isGlobal) {
            for (const d of days) {
              thickHeader.add(d);
              bandKeys.add(d);
            }
          } else {
            for (const d of days) (thickByFeed[feed.id] ??= new Set()).add(d);
          }
        } else {
          if (isGlobal) for (const d of days) thinHeader.add(d);
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
      const arr = mergedByFeed[feed.id] ?? [];
      const sorted = sortedFor(feed.id, arr);
      // fontEmPx: the h3 title renders at config.fontSize * 13/14 px per em —
      // pass it so long labels reserve their footprint and stop overlapping.
      // nowMs: keep current/future events on the top row(s), past below.
      const { laneEvents, laneCount } = assignLanes(
        sorted, pxPerDay, rangeStart, undefined, true, (config.fontSize * 13) / 14,
        todayDate.getTime(),
      );
      result[feed.id] = {
        height: Math.max(laneH, laneCount * laneH) + rowPad * 2,
        laneEvents,
      };
    }
    return result;
  });

  const feedsById = $derived(
    Object.fromEntries(config.feeds.map((f) => [f.id, f])) as Record<string, CalendarFeed>,
  );

  let scrollEl: HTMLElement | undefined = $state();
  let didCenter = false;
  // Reactive sibling of didCenter: drives the first-paint reveal. The scroll
  // content is held invisible until the first centre lands, so Firefox Android
  // (which paints before measuring the viewport width) doesn't show a left→centre
  // jump as the centering effect snaps scrollLeft on the next frame.
  let centered = $state(false);

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
          feedId: feed.id,
          startMs: ev.start.getTime(),
          endMs: ev.end.getTime(),
          lane: voiceStep(row, ev.lane),
          subLane: ev.lane,
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
  // Wider zooms sweep slower (a screenful spans more time, so a leisurely pace
  // reads better): month is the 1× baseline, year is 2.5× slower, the rest ramp
  // between. Multiplies MS_PER_VIEWPORT for the active zoom.
  const SWEEP_PACE_BY_ZOOM: Record<Zoom, number> = {
    week: 0.6,
    month: 1,
    quarter: 1.5,
    'half-year': 2,
    year: 2.5,
    '2-year': 3,
  };
  // Keep audio alive past a bell's tail (~1.1s) when disabling, so the final
  // beat of the reversed countdown rings out instead of being cut by suspend().
  const BELL_TAIL_MS = 1300;

  // Strike a batch of crossings as one polyphonic chord: every distinct pitch
  // plays at the same instant (no throttle, nothing dropped). Identical pitches
  // are merged — stacking the same note only adds loudness, not harmony. The
  // per-note level is normalized so a fat chord doesn't get louder with density,
  // using exponent 0.6 (a touch fuller than equal-power's 0.5 so the polyphony
  // stays rich) with a floor so huge chords don't shrink each voice to nothing.
  // The per-note onset jitter + detune in playBell keeps the stacked attacks
  // from summing into a click.
  function ringChord(batch: Crossing[], play: (freq: number, level: number) => void): void {
    const voices = uniqueVoices(batch, Infinity);
    if (voices.length === 0) return;
    const level = Math.max(0.28, 1 / Math.pow(voices.length, 0.6));
    for (const v of voices) play(laneToFrequency(v), level);
  }

  let sweepRaf = 0;
  let sweepRunning = false;
  // Marker visibility is reactive; its position is set imperatively each frame
  // (see startSweep) so it stays glued to the natively-scrolling content with no
  // reactive-flush lag that would otherwise make it jitter.
  let sweepActive = $state(false);
  let sweepMarkerEl = $state<HTMLDivElement | undefined>(undefined);
  let sweepPathEl = $state<SVGPathElement | undefined>(undefined);
  // The straight line is drawn at this x inside the SVG's user space; the SVG box
  // is offset left by the same amount so on-screen position is unchanged. This
  // leaves room to the left for the leftward bend.
  const SWEEP_SVG_LEFT = 50;
  // How far left (px) a single event plucks the string at its touch point, and
  // the spring that pulls each pluck back to zero — under-damped so it overshoots
  // and twangs before settling.
  const BEND_AMP_PX = 12;
  const BEND_STIFFNESS = 520;
  const BEND_DAMPING = 24;
  // How long (s) a row stays pulled out after the playhead sweeps past one of
  // its events, so a fast single-frame pass still yields a full visible pluck
  // before the spring releases and twangs back.
  const BEND_HOLD_S = 0.09;
  // Per-row pluck amplitude + velocity + remaining hold, indexed parallel to
  // rowBands; integrated each frame toward a target (BEND_AMP_PX while held).
  let bendPos: number[] = [];
  let bendVel: number[] = [];
  let bendHold: number[] = [];
  // The y the pluck bows toward for each row: the vertical centre of the pill the
  // playhead last crossed in that row (updated on each pluck), so the bow's peak
  // sits on the event rather than at the row's geometric middle.
  let bendLaneY: number[] = [];
  let ambientSet = new Map<string, number>();
  let ambientSeeded = false;
  let ambientNow = -1;
  // End-of-sweep flourish: a 1s fade to black begins FADE_MS before the seeker
  // reaches the end (so it's fully black right as it arrives); at full black the
  // view snaps to today, then a 1s fade back in reveals it already centred. The
  // fade is driven by Svelte's `transition:fade` on the overlay, which reliably
  // animates the mount/unmount — hand-rolled opacity toggling raced the reactive
  // scheduler and never painted the start state, so it cut instead of faded.
  const FADE_MS = 1000;
  let showBlackout = $state(false);
  // Fade-to-black duration, set per sweep to the time the seeker takes to cross
  // the trailing pad (date end → true end). The fade-back-in keeps FADE_MS.
  let fadeOutMs = $state(FADE_MS);
  // Once-guard so the loop fires the fade exactly once per sweep (reset per run).
  let fadeStarted = false;

  // Advance each row's pluck spring by dt seconds (pulled out while the row is
  // active, back to zero otherwise) and return an SVG path for the whole line as
  // one continuous elastic string spanning the full height. Each active event
  // pulls the string to the LEFT with its peak at the row it touches, the rest of
  // the string dragged along and pinned only at the very top and bottom. Multiple
  // plucks superimpose; the line is sampled densely so it reads as a single smooth
  // curve. Springs overshoot (under-damped) so the string twangs back with a bounce.
  function sweepBendPath(swept: Map<string, number>, dt: number): string {
    const bands = rowBands;
    const H = contentHeight;
    const X = SWEEP_SVG_LEFT; // x of the tight line in the SVG's user space
    if (bands.length === 0) return `M ${X} 0 L ${X} ${H}`;
    if (bendPos.length !== bands.length) {
      bendPos = new Array(bands.length).fill(0);
      bendVel = new Array(bands.length).fill(0);
      bendHold = new Array(bands.length).fill(0);
      // Default each row's pluck point to its body centre until a pill is crossed.
      bendLaneY = bands.map((b) => b.bodyTop + (b.top + b.height - b.bodyTop) / 2);
    }
    // Integrate per-row springs and record each row's pluck point (the centre of
    // the crossed event's pill) and current amplitude.
    const peaks: { y: number; amp: number }[] = [];
    let maxAbs = 0;
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i]!;
      // Refresh the hold each frame the playhead is sweeping across this row's
      // events; the spring is pulled out while any hold remains, then releases.
      const sweptLane = swept.get(band.feedId);
      if (sweptLane !== undefined) {
        bendHold[i] = BEND_HOLD_S;
        // Bow toward the crossed pill's vertical centre: pills are laid out at
        // `lane * laneH + rowPad` inside the row-body and are laneH tall.
        bendLaneY[i] = band.bodyTop + sweptLane * laneH + rowPad + laneH / 2;
      }
      const held = bendHold[i]! > 0;
      if (held) bendHold[i]! = Math.max(0, bendHold[i]! - dt);
      const target = held ? BEND_AMP_PX : 0;
      // Hooke + viscous damping, semi-implicit Euler (stable at variable deltas).
      const accel = (target - bendPos[i]!) * BEND_STIFFNESS - bendVel[i]! * BEND_DAMPING;
      bendVel[i]! += accel * dt;
      bendPos[i]! += bendVel[i]! * dt;
      peaks.push({ y: bendLaneY[i]!, amp: bendPos[i]! });
      maxAbs = Math.max(maxAbs, Math.abs(bendPos[i]!));
    }
    if (maxAbs < 0.4) return `M ${X} 0 L ${X} ${H}`; // settled: a tight straight line
    // The line is ONE plucked string spanning the WHOLE height: pinned (zero
    // deflection) at the very top (y=0) and bottom (y=H) of the content, bowing
    // as a single smooth curve in between. Each row's spring amplitude contributes
    // a basis that is 1 at the crossed pill's centre and falls to 0 at the two
    // ends, so the bow's peak sits on whichever event the playhead is crossing
    // while the rest of the string is dragged along; concurrent rows superimpose
    // into one continuous bow. Deflection is leftward (X - …).
    const deflectAt = (y: number): number => {
      let x = 0;
      for (const p of peaks) {
        if (p.amp === 0) continue;
        // Half-cosine ramps: 0 at y=0, 1 at the pill centre, 0 at y=H — so every
        // pluck stretches the entire string rather than a local band.
        const u =
          y <= p.y
            ? y / Math.max(1, p.y)
            : (H - y) / Math.max(1, H - p.y);
        x += p.amp * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u))));
      }
      return X - x;
    };
    // Sample the bow densely down the full height. Join the samples with
    // Catmull-Rom → cubic Bézier so the bow is a single smooth curve.
    const STEP = Math.max(8, H / 48);
    const ys: number[] = [0];
    for (let y = STEP; y < H; y += STEP) ys.push(y);
    ys.push(H);
    const pts = ys.map((y) => ({ x: deflectAt(y), y }));
    let d = `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[i + 2 < pts.length ? i + 2 : pts.length - 1]!;
      // Catmull-Rom → cubic Bézier control points for a smooth interpolation.
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    return d;
  }

  // Cancel any in-flight fade and clear the overlay. Called when the sweep is
  // interrupted or the egg is toggled so a black screen can't get stuck — setting
  // showBlackout false reverses an in-progress fade-to-black back out (≤1s).
  function clearFade(): void {
    showBlackout = false;
    fadeStarted = false;
  }

  // Fires when the overlay has finished fading to full black (transition:fade
  // introend). The single, definitive end of the flourish: cancel the sweep loop
  // (so no stray frame overwrites the jump), recenter on today INSTANTLY while
  // black, then drop the overlay to fade back in already centred.
  function finishBlackout(): void {
    cancelAnimationFrame(sweepRaf);
    sweepRunning = false;
    sweepActive = false;
    ui.musicSweeping = false;
    ambientSeeded = false;
    if (scrollEl) scrollEl.scrollLeft = Math.max(0, todayPx - scrollEl.clientWidth / 2);
    showBlackout = false; // fade back in from black over FADE_MS
  }

  // One accelerated pass of a virtual playhead, starting at the current left
  // edge and travelling all the way to the end of the timeline, ringing a bell
  // on each event it enters and a whistle as it leaves. The viewport follows the
  // marker (kept centered on screen). When the sweep reaches the end the screen
  // fades to black and returns to today. Seeded with whatever's already under the
  // start so we only sound events the playhead actively crosses into.
  function startSweep(): void {
    cancelAnimationFrame(sweepRaf);
    if (!scrollEl) {
      sweepRunning = false;
      return;
    }
    const vw = scrollEl.clientWidth;
    const startLeft = scrollEl.scrollLeft;
    const startMs = pxToDate(startLeft, rangeStart, pxPerDay).getTime();
    // Sweep all the way to the true right edge of the scroll content — the
    // RIGHT_PAD_PX trailing pad included — not just the last dated pixel.
    const endPx = totalWidth + RIGHT_PAD_PX;
    const endMs = pxToDate(endPx, rangeStart, pxPerDay).getTime();
    const paceMs = MS_PER_VIEWPORT * SWEEP_PACE_BY_ZOOM[zoom.value];
    const durationMs = sweepDurationMs(endPx - startLeft, vw, paceMs);
    // Timeline-ms advanced per real-ms; the playhead is integrated by this rate
    // each frame (below) rather than from absolute elapsed time.
    const speed = durationMs > 0 ? (endMs - startMs) / durationMs : endMs - startMs;
    // The fade to black begins when the seeker reaches the END OF THE DATED
    // timeline (totalWidth) and lasts exactly as long as the seeker takes to
    // cross the trailing RIGHT_PAD_PX — so it's fully black right as the seeker
    // hits the true right edge (endPx). fadeStartMs is clamped to the start in
    // case the view is already inside the pad when the sweep is armed.
    const dateEndMs = pxToDate(totalWidth, rangeStart, pxPerDay).getTime();
    const fadeStartMs = Math.max(dateEndMs, startMs);
    fadeOutMs = speed > 0 ? Math.max(150, (endMs - fadeStartMs) / speed) : FADE_MS;
    const spans = timedLaneSpans;
    let prev = activeLanesAt(startMs, spans);
    let ph = startMs;
    let tPrev = performance.now();
    // Reset the bend springs so the line starts tight.
    bendPos = [];
    bendVel = [];
    bendHold = [];
    bendLaneY = [];
    fadeStarted = false;
    sweepRunning = true;
    sweepActive = true;
    ui.musicSweeping = true;
    const step = (tNow: number): void => {
      // Pause entirely while the tab is backgrounded: don't advance the playhead
      // or sound anything, just keep the RAF alive so it resumes on return. (Some
      // browsers still tick RAF at ~1Hz when hidden, which would otherwise creep
      // the sweep — and could even finish it, firing the fade — out of view.)
      if (typeof document !== 'undefined' && document.hidden) {
        tPrev = tNow;
        sweepRaf = requestAnimationFrame(step);
        return;
      }
      // Integrate the playhead with a clamped per-frame delta: a delayed or
      // background-throttled frame just slows the sweep instead of jumping the
      // centred line forward to "catch up".
      const dtMs = Math.min(tNow - tPrev, 48);
      tPrev = tNow;
      const phPrev = ph;
      ph = Math.min(endMs, ph + speed * dtMs);
      // Begin the fade to black when the seeker reaches the dated timeline's end;
      // it lasts fadeOutMs (the pad-crossing time) so it's fully black right as
      // the seeker hits the true edge. The seeker keeps running (and sounding)
      // underneath. finishBlackout (the fade's introend) owns the rest.
      if (!fadeStarted && ph >= fadeStartMs) {
        fadeStarted = true;
        showBlackout = true;
      }
      // Pluck every row the playhead swept across THIS frame (interval overlap),
      // not just rows it's sitting inside at this instant — the sweep covers days
      // per frame, so short events would otherwise be missed entirely.
      const swept = sweptLanes(phPrev, ph, spans);
      // Sound every frame as a chord: all events crossed on this frame strike
      // together (no throttle, nothing dropped), gain-normalized so density
      // doesn't increase loudness.
      const next = activeLanesAt(ph, spans);
      const { entered, exited } = crossings(prev, next);
      ringChord(entered, playBell);
      ringChord(exited, playWhistle);
      prev = next;
      const px = msToPx(ph, rangeStart, pxPerDay);
      // Only the timeline scrolls; the line is sticky-pinned to the scrollport
      // (CSS) and merely translated to its on-screen position. It ramps from the
      // left edge to centre over the first half-viewport (the content can't
      // scroll back past the start), then holds dead-centre — immobile — while
      // the timeline scrolls beneath it.
      const scroll = Math.max(startLeft, px - vw / 2);
      if (scrollEl) scrollEl.scrollLeft = scroll;
      if (sweepMarkerEl) sweepMarkerEl.style.transform = `translateX(${px - scroll}px)`;
      // Pluck the line at the rows it swept across; springs twang it back tight.
      if (sweepPathEl) sweepPathEl.setAttribute('d', sweepBendPath(swept, dtMs / 1000));
      if (ph < endMs) {
        sweepRaf = requestAnimationFrame(step);
      } else {
        // Reached the end. The fade-to-black is already in progress (started
        // FADE_MS ago); finishBlackout() does the snap + fade-back when it turns
        // fully black, so just stop the loop here. (If for some reason the fade
        // never armed — e.g. no events at all — fall back to finishing now.)
        sweepRunning = false;
        sweepActive = false;
        ui.musicSweeping = false;
        ambientSeeded = false; // hand off to the ambient effect's next tick
        if (!fadeStarted) finishBlackout();
      }
    };
    sweepRaf = requestAnimationFrame(step);
  }

  // Stop the sweep but keep the egg on: cancel the animation, drop the marker,
  // and hand off to ambient mode (reseed silently so it doesn't chime everything
  // already under the playhead). Used when a nav button is tapped mid-sweep.
  function stopSweep(): void {
    clearFade(); // an interrupt mid-fade must not leave the screen black
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
      clearFade();
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
    ringChord(entered, playBell);
    ringChord(exited, playWhistle);
    ambientSet = next;
    ambientNow = now;
  });

  // The current-time marker is an SVG dashed path that bends per row so it
  // marks the current local time of each row's timezone on the shared date
  // grid. Row vertical extents are measured from the DOM (row height isn't
  // reliably derivable from constants), then the bend math runs reactively.
  // `top`/`height` span the whole row section (sticky header included); `bodyTop`
  // is the absolute top of the inner `.row-body`, where event pills are laid out,
  // so the pluck can land on a pill's centre rather than the section's centre.
  let rowBands = $state<{ feedId: string; top: number; height: number; bodyTop: number }[]>([]);
  let contentHeight = $state(0);

  $effect(() => {
    // Re-measure whenever layout-affecting state changes.
    void orderedFeeds;
    void rowLanes;
    void zoom.value;
    void pxPerDay;
    void viewportWidth;
    void clock.now;
    if (!scrollEl) return;
    const el = scrollEl;
    // A single post-update frame is not enough: row heights can still settle
    // for a few frames after a zoom switch or the initial reveal (re-centering,
    // late reflow), and a one-shot measurement freezes the marker bend at a
    // row boundary that no longer exists until the next minute tick. Sample
    // every frame until the layout holds still, updating the bands live.
    let raf = 0;
    let lastSig = '';
    let stableFrames = 0;
    const startedAt = performance.now();
    const measure = (): void => {
      const rowsEl = el.querySelector<HTMLElement>('.rows');
      if (!rowsEl) {
        rowBands = [];
        contentHeight = el.scrollHeight;
        return;
      }
      const base = rowsEl.offsetTop;
      const sections = rowsEl.querySelectorAll<HTMLElement>(':scope > section.row');
      const bands: { feedId: string; top: number; height: number; bodyTop: number }[] = [];
      for (const s of sections) {
        const feedId = s.dataset.feedId;
        if (!feedId) continue;
        const top = base + s.offsetTop;
        // The row-body sits below the sticky row header; pills are positioned
        // relative to it. (Collapsed rows have no body — fall back to the section.)
        const body = s.querySelector<HTMLElement>(':scope > .row-body');
        bands.push({ feedId, top, height: s.offsetHeight, bodyTop: body ? top + body.offsetTop : top });
      }
      // Height of the actual flow content (header + rows), NOT scrollHeight — the
      // absolutely-positioned .today-line SVG is sized to contentHeight, so
      // reading scrollHeight would feed back into itself and ratchet the height
      // up (collapsing feeds could never shrink it, leaving dead scroll space).
      // Clamp to the viewport so the now-line and global block band always span
      // the full height even when the collapsed content is short.
      const ch = Math.max(rowsEl.offsetTop + rowsEl.offsetHeight, el.clientHeight);
      const sig =
        ch + '|' + bands.map((b) => `${b.feedId}:${b.top}:${b.height}:${b.bodyTop}`).join('|');
      if (sig !== lastSig) {
        lastSig = sig;
        stableFrames = 0;
        rowBands = bands;
        contentHeight = ch;
      } else {
        stableFrames++;
      }
      if (stableFrames < 3 && performance.now() - startedAt < 1000) raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  });

  function markerOffsetPx(feedId: string): number {
    const tz = effectiveFeedTz(feedId);
    if (!tz) return 0;
    const mins = tzOffsetMinutesVsDisplay(tz, config.timezone, new Date(clock.now), config.dst);
    return (mins / 1440) * pxPerDay;
  }

  const markerPath = $derived.by(() => {
    // Explicit deps so the bend SHAPE always rescales on zoom / orientation /
    // clock / timezone change — not just when some row happens to have a tz
    // offset (markerOffsetPx early-returns before reading these for rows that
    // share the display tz, which would otherwise leave them untracked and the
    // bends stale after a zoom or rotation).
    void pxPerDay;
    void viewportWidth;
    void clock.now;
    void config.timezone;
    const x0 = todayPx;
    // Timezone offsets are a fraction of a day, so the jog is only legible at
    // 1M/3M; at wider zooms it's a couple of px and reads as a broken line —
    // draw the marker straight there.
    const bendable = zoom.value === 'month' || zoom.value === 'quarter';
    if (!bendable || rowBands.length === 0) return `M ${x0} 0 L ${x0} ${contentHeight}`;
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
    const newWidth = scrollEl.clientWidth;
    // A width change with no scroll is a viewport resize / device rotation. Once
    // the user has interacted (so load-centering no longer owns the scroll),
    // preserve whatever date was at screen centre across the resize, rescaled to
    // the new width — otherwise the fixed scrollLeft would drift to a different
    // date. Captured with the CURRENT pxPerDay before viewportWidth changes it.
    const resized = newWidth !== viewportWidth && viewportWidth > 0;
    const centerDate =
      resized && centered && lastInteractionMs !== 0
        ? pxToDate(scrollEl.scrollLeft + viewportWidth / 2, rangeStart, pxPerDay)
        : null;
    viewportWidth = newWidth;
    scrollLeft = scrollEl.scrollLeft;
    scheduleReveal();
    if (centerDate) {
      queueMicrotask(() => {
        if (!scrollEl) return;
        const npd = computePxPerDay(zoom.value, scrollEl.clientWidth) * fontScale;
        const px = dateToPx(centerDate, rangeStart, npd);
        scrollEl.scrollLeft = Math.max(0, px - scrollEl.clientWidth / 2);
      });
    }
  }

  // Firefox Android reflows the viewport several times right after first paint
  // (address-bar collapse, late layout), and each width change flows through
  // pxPerDay -> assignLanes -> row heights, resizing rows vertically. The
  // centering effect re-asserts the centre on every such change, but if we
  // revealed on the first width those later resizes would be seen as a vertical
  // jump. So keep the content hidden until the width has stayed put for a beat,
  // letting all the row-height settling finish while invisible; then reveal
  // instantly (no fade — the fade itself read as slowness).
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleReveal(): void {
    if (centered) return;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      centered = true;
    }, 120);
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
    // Don't mark interaction here: this fires for our own programmatic centering
    // scrolls too, which would prematurely disengage the load-centering gate.
    // Genuine user input is tracked by the window pointer/touch/wheel/key effect.
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
    // Belt-and-braces: never leave the content hidden if the width never settles
    // (e.g. a browser that keeps nudging it). scheduleReveal() normally reveals
    // ~120ms after the last width change, well before this.
    const revealGuard = setTimeout(() => {
      centered = true;
    }, 600);
    return () => {
      clearTimeout(revealGuard);
      clearTimeout(revealTimer);
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
    if (!scrollEl) return;
    // Wait for the real viewport width: until it's measured, pxPerDay (and so
    // todayPx) use the static fallback scale, which for fit-whole-span zooms
    // lands today far to the left. The effect re-runs once width is known.
    if (viewportWidth <= 0 || totalWidth <= 0) return;
    // Open on today unless a temporary marker (e.g. a shared #d= fragment)
    // remembers a previous position. Reading these reactively makes this effect
    // re-run on every width/today change.
    const targetPx =
      ui.tempMarkerMs != null
        ? dateToPx(new Date(ui.tempMarkerMs), rangeStart, pxPerDay)
        : todayPx;
    // Firefox Android reflows the viewport several times after first paint
    // (address-bar collapse, late content layout); each reflow changes
    // viewportWidth -> pxPerDay -> todayPx, so a one-shot centre that latches on
    // the first settle ends up off-centre once a later reflow moves the today
    // line under a fixed scroll. So re-assert the centre on EVERY width/today
    // change until the user first interacts with the timeline — never trusting a
    // single "settled" moment. lastInteractionMs is 0 until a real
    // pointer/touch/wheel/key gesture (programmatic scrollLeft doesn't set it).
    if (lastInteractionMs !== 0) return;
    scrollEl.scrollLeft = Math.max(0, targetPx - scrollEl.clientWidth / 2);
    // Mark the initial centre as done so the month-zoom drift recenter can engage.
    didCenter = true;
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
    // The 1W week view replaces the horizontal timeline with WeekGrid, so there
    // is no scroll math to preserve: remember the zoom we're leaving (so toggling
    // 1W off returns there) and switch. The grid does its own working-hours
    // auto-scroll on mount.
    if (next === 'week') {
      if (zoom.value !== 'week') zoom.lastNonWeek = zoom.value;
      zoom.value = next;
      return;
    }
    // Leaving 1W: the horizontal <main> isn't mounted yet (scrollEl undefined),
    // so re-arm the open-centering effect — it scrolls to ui.tempMarkerMs (set in
    // 1W) when present, else today — to run once the timeline remounts.
    const leavingWeek = zoom.value === 'week';
    if (!scrollEl) {
      zoom.value = next;
      if (leavingWeek) {
        lastInteractionMs = 0;
        didCenter = false;
      }
      return;
    }
    const center = scrollEl.scrollLeft + scrollEl.clientWidth / 2;
    const centerDate = pxToDate(center, rangeStart, pxPerDay);
    // If today's marker is already near screen centre, recentre on today after
    // the zoom so the current-day line stays put; otherwise keep whatever date
    // was centred (the user has scrolled elsewhere).
    const todayCentered = Math.abs(center - todayPx) <= scrollEl.clientWidth * 0.25;
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
      const anchorDate = todayCentered
        ? next === 'month'
          ? new Date(clock.now)
          : todayDate
        : centerDate;
      const targetPx = dateToPx(anchorDate, rangeStart, newPxPerDay);
      scrollEl.scrollLeft = Math.max(0, targetPx - scrollEl.clientWidth / 2);
    });
  }

  function shiftZoom(dir: -1 | 1): void {
    // In the 1W week view the horizontal <main> isn't rendered, so scrollEl is
    // undefined and the pinch/wheel effects never bind — shiftZoom can't be
    // reached from week mode, and ZOOM_ORDER intentionally omits 'week'.
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
    // Index the same merged, start-sorted list the pills and nav use.
    const ev = timelineEventsFor(target.id)[focus.eventIndex];
    if (!ev) return;
    const px = dateToPx(ev.start, rangeStart, pxPerDay);
    scrollEl.scrollTo({ left: Math.max(0, px - scrollEl.clientWidth / 2), behavior: 'smooth' });
  });
</script>

{#if zoom.value === 'week'}
  <WeekGrid today={todayDate} {feedsById} />
{:else}
<main
  id="timeline"
  bind:this={scrollEl}
  data-zoom={zoom.value}
  data-search-active={searchActive ? 'true' : null}
  style="height: calc(100dvh - var(--toolbar-h) - {search.open ? 'var(--toolbar-h)' : '0px'});"
>
  <div class="scroll-content" class:is-centered={centered} style="width: {totalWidth + RIGHT_PAD_PX}px;">
    {#if sweepActive}
      <!-- Zero-size sticky anchor pinned to the scrollport's left edge; the sweep
           loop translateX()es it to the play line's on-screen position. Its inner
           bar is absolutely positioned, so the anchor adds no layout. -->
      <div class="music-sweep" bind:this={sweepMarkerEl} aria-hidden="true">
        <svg class="music-sweep-svg" width="80" height={contentHeight} aria-hidden="true">
          <path bind:this={sweepPathEl} d="M {SWEEP_SVG_LEFT} 0 L {SWEEP_SVG_LEFT} {contentHeight}" fill="none" />
        </svg>
      </div>
    {/if}
    <header id="time-header" role="presentation" ondblclick={onHeaderDblClick} onpointerup={onHeaderPointerUp}>
      <TimeHeader {rangeStart} {rangeEnd} {pxPerDay} {scrollEl} {thickDayKeys} {thinDayKeys} />
      {#if ui.tempMarkerMs != null}
        <div class="toggle-marker-wrap" style="top: calc(var(--toolbar-h) + {search.open ? 'var(--toolbar-h)' : '0px'})">
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
      <i
        class="holiday-band"
        style="left: {h.left}px; width: {h.width}px; height: calc({contentHeight}px - var(--time-header-h));"
      ></i>
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
        stroke-width="1.5"
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
{/if}

{#if showBlackout}
  <div
    class="sweep-fade"
    in:fade={{ duration: fadeOutMs }}
    out:fade={{ duration: FADE_MS }}
    onintroend={finishBlackout}
    aria-hidden="true"
  ></div>
{/if}

<style>
  #timeline {
    overflow: auto;
    background: var(--paper);
    overscroll-behavior: contain;
    touch-action: pan-x pan-y;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    /* Firefox's scroll anchoring otherwise shifts our programmatic load-centering
       as rows/.scroll-content lay out, landing the view right of today. */
    overflow-anchor: none;
  }
  .scroll-content {
    position: relative;
    min-width: 100%;
    min-height: 100%;
    overflow-anchor: none;
    /* Hidden until the viewport width settles and the first centre lands, so
       Firefox Android (which reflows the width several times after first paint)
       does all its row-height/centre settling while invisible instead of as a
       visible jump. Revealed instantly — a fade here read as load slowness.
       opacity (not display) keeps the element laid out so clientWidth/scrollWidth
       stay measurable for the centering + lane math while hidden. */
    opacity: 0;
  }
  .scroll-content.is-centered {
    opacity: 1;
  }
  #time-header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--paper);
    border-bottom: var(--border-w) solid var(--ink);
    height: var(--time-header-h);
  }
  .rows {
    position: relative;
    display: flex;
    flex-direction: column;
    padding-bottom: 16px;
  }
  .holiday-band {
    position: absolute;
    top: var(--time-header-h);
    /* Height is set inline to contentHeight − header (clamped to the viewport),
       so the global block band spans the full viewport even when collapsed
       content is short — matching the full-height now-line. */
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
    /* No will-change: transform — on Firefox Android it promotes this to a
       composited layer that re-composites with the per-frame translateX but
       reuses the cached raster, so the path's bend (updated via setAttribute d)
       never repaints and the seek line stays straight. */
  }
  .music-sweep-svg {
    position: absolute;
    /* Offset left by SWEEP_SVG_LEFT (50) so the line, drawn at user-x=50, still
       lands exactly at the playhead, leaving room to its left for the bend.
       overflow:visible lets the bow extend past the box. */
    left: -50px;
    top: 0;
    width: 80px;
    overflow: visible;
    opacity: 0.85;
  }
  .music-sweep-svg path {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  /* Full-screen blackout for the end-of-sweep flourish. Base opacity 0; 'out'
     ramps to black, then switching back to 'in' (base 0) fades it away. */
  .sweep-fade {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: #000;
    pointer-events: none;
    /* opacity is animated by Svelte's transition:fade (mount = fade to black,
       unmount = fade back in), so no static opacity/transition here. */
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
    /* The button fills the date tier (height = --time-header-date-h), so centre
       it horizontally under the toolbar's 32px search button: that button's
       centre is at --time-header-pad-x + 16px from the right edge. */
    right: calc(var(--time-header-pad-x) + (32px - var(--time-header-date-h)) / 2);
    z-index: 11;
    pointer-events: auto;
  }
  .toggle-marker-wrap :global(.icon-button) {
    /* Square, sized to the date tier so it fits the header row; the icon stays
       size 18 (set on the component). */
    width: var(--time-header-date-h);
    height: var(--time-header-date-h);
  }
  .toggle-marker-wrap :global(.icon-button):hover {
    background: transparent;
  }
  /* The halo must sit on the (unmasked) button wrapper: Icon renders as a CSS
     mask, which clips a drop-shadow applied to the icon itself — so the filter
     would otherwise be invisible. This mirrors the marker labels' halo. */
  .toggle-marker-wrap :global(.icon-button) {
    filter: var(--clock-halo);
  }
  .toggle-marker-wrap :global(.icon-button) :global(.icon) {
    color: var(--accent);
    transition: none;
  }
</style>
