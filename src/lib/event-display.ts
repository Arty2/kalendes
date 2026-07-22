// Shared, config-agnostic display helpers used by both the full event modal
// (EventModal.svelte) and the lightweight hover preview (EventHoverCard.svelte),
// plus exact-duplicate collapsing for the timeline pills. Kept pure (no rune /
// config imports) so they stay trivially testable.
import type { DateFormat, DisplayEvent, Locale, TimeFormat, Timezone } from './types';
import { formatRange, formatTime, formatWeekday, endDayInclusive, zonedParts, zonedDateProxy } from './format';
import { MS_PER_DAY } from './time';

export type EventDateInfo = {
  date: string;
  time: string;
  duration: string;
  // Localized weekday name(s): a single day (e.g. "Monday") or, for a multi-day
  // event, the inclusive start–end pair (e.g. "Monday — Thursday"). multiDay
  // mirrors formatRange's same-day test so the weekday tracks the numeric date.
  weekday: string;
  multiDay: boolean;
};

/**
 * The "HH:MM — HH:MM" line for a timed event. For a merged consecutive-day run
 * whose members differ in start (or end) time, the varying side renders as a
 * "earliest/latest" range, e.g. `10:00/10:30 — 15:00/16:00`; sides that don't
 * vary (and every non-merged event) show a single time. Empty for all-day.
 */
export function formatEventTimeLabel(
  ev: Pick<DisplayEvent, 'start' | 'end' | 'allDay' | 'spanStartRange' | 'spanEndRange'>,
  timeFormat: TimeFormat,
  timezone: string,
): string {
  if (ev.allDay) return '';
  const side = (single: Date, range: [Date, Date] | undefined): string => {
    if (!range) return formatTime(single, timeFormat, timezone);
    const lo = formatTime(range[0], timeFormat, timezone);
    const hi = formatTime(range[1], timeFormat, timezone);
    return lo === hi ? lo : `${lo}/${hi}`;
  };
  return `${side(ev.start, ev.spanStartRange)} — ${side(ev.end, ev.spanEndRange)}`;
}

/** Human date / time / duration lines for an event, in the given formats. */
export function formatEventDateInfo(
  ev: Pick<DisplayEvent, 'start' | 'end' | 'allDay' | 'spanDays' | 'spanStartRange' | 'spanEndRange'>,
  dateFormat: DateFormat,
  locale: Locale,
  timeFormat: TimeFormat,
  timezone: string,
): EventDateInfo {
  // Timed events show their date in the display timezone (so it matches the time);
  // all-day events keep their timezone-agnostic UTC date.
  const sD = ev.allDay ? ev.start : zonedDateProxy(ev.start, timezone);
  const eD = ev.allDay ? ev.end : zonedDateProxy(ev.end, timezone);
  const date = formatRange(sD, eD, dateFormat, locale);
  const last = endDayInclusive(sD, eD);
  const multiDay =
    sD.getUTCFullYear() !== last.getUTCFullYear() ||
    sD.getUTCMonth() !== last.getUTCMonth() ||
    sD.getUTCDate() !== last.getUTCDate();
  const weekday = multiDay
    ? `${formatWeekday(sD, locale)} — ${formatWeekday(last, locale)}`
    : formatWeekday(sD, locale);
  if (ev.allDay) {
    const days = Math.round((ev.end.getTime() - ev.start.getTime()) / 86_400_000);
    return { date, time: '', duration: days > 1 ? `${days} days` : '', weekday, multiDay };
  }
  const time = formatEventTimeLabel(ev, timeFormat, timezone);
  // A merged consecutive-day run keeps its shared daily time above, but its
  // raw start→end span is many days, so report the day count instead of an
  // (enormous) hour total.
  if (ev.spanDays && ev.spanDays > 1) {
    return { date, time, duration: `${ev.spanDays} days`, weekday, multiDay };
  }
  const totalMins = Math.round((ev.end.getTime() - ev.start.getTime()) / 60_000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  let duration = '';
  if (h > 0 && m > 0) duration = `${h}h ${m}m`;
  else if (h > 0) duration = `${h}h`;
  else if (m > 0) duration = `${m}m`;
  return { date, time, duration, weekday, multiDay };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Shorten a URL for display where it isn't clickable (the hover preview): keep
 * the scheme + host (through the TLD/port) and only a few characters of the
 * path/query/hash, then an ellipsis. A bare domain or short tail is left as-is.
 */
export function abbreviateUrl(url: string, tail = 5): string {
  const m = /^(https?:\/\/[^/?#]+)(.*)$/.exec(url);
  if (!m) return url;
  const base = m[1]!;
  const rest = m[2]!;
  if (rest.length <= tail + 1) return url;
  return base + rest.slice(0, tail) + '…';
}

/**
 * Escape text and turn bare http(s) URLs into anchors (opens in a new tab). With
 * `abbreviate`, the anchor's visible text is shortened (`abbreviateUrl`) while
 * the href stays the full URL — for the non-interactive hover card.
 */
export function linkifyText(text: string, opts?: { abbreviate?: boolean }): string {
  const URL_RE = /https?:\/\/[^\s<>"]+/g;
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    result += escapeHtml(text.slice(last, m.index));
    const url = m[0].replace(/[.,;:!?)\]'"]+$/, '');
    const shown = opts?.abbreviate ? abbreviateUrl(url) : url;
    result += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener nofollow">${escapeHtml(shown)}</a>`;
    last = m.index + url.length;
  }
  result += escapeHtml(text.slice(last));
  return result;
}

/**
 * Collapse exact-duplicate events — same displayTitle and identical start/end —
 * into a single representative carrying `dupCount` (the group size) and, when
 * collapsed, `dupMembers` (every copy, representative first) so the modal can
 * page between them. Order is preserved by first occurrence; distinct instances
 * (different day/time) are untouched. Used to stop repeating / re-imported
 * events piling into an unreadable stack of pills.
 */
export function dedupeDisplayEvents(events: DisplayEvent[]): DisplayEvent[] {
  const byKey = new Map<string, DisplayEvent>();
  const out: DisplayEvent[] = [];
  for (const ev of events) {
    const key = `${ev.displayTitle}\u0000${ev.start.getTime()}\u0000${ev.end.getTime()}`;
    const rep = byKey.get(key);
    if (rep) {
      rep.dupCount = (rep.dupCount ?? 1) + 1;
      // Keep every collapsed copy (e.g. the same event carried by another feed)
      // so the modal can page between them. The representative is member 0.
      (rep.dupMembers ??= [rep]).push(ev);
      continue;
    }
    // Fresh copy so we never mutate dupCount onto the caller's event object.
    const copy: DisplayEvent = { ...ev, dupCount: 1 };
    byKey.set(key, copy);
    out.push(copy);
  }
  return out;
}

// Two daily instances count as "the same" for merging if their start and end
// clock times land within this many minutes of the run's anchor.
const MERGE_TOLERANCE_MIN = 60;

type MergeInfo = {
  ev: DisplayEvent;
  idx: number; // original position, for stable first-occurrence output order
  day: number; // calendar-day ordinal (UTC for all-day, zoned for timed)
  startMin: number; // minute-of-day (unused for all-day)
  endMin: number;
};

type MergeRun = {
  anchor: MergeInfo;
  lastDay: number;
  dayCount: number;
  members: DisplayEvent[]; // the individual per-day events, in encounter order
  endMs: number; // latest member end, as epoch ms
  endDate: Date; // the Date behind endMs
  // Clock-time extremes across members (min/max minute-of-day) plus the member
  // Date behind each, so a merged pill can show a "10:00/10:30 — …" range.
  startLoMin: number;
  startHiMin: number;
  startLoDate: Date;
  startHiDate: Date;
  endLoMin: number;
  endHiMin: number;
  endLoDate: Date;
  endHiDate: Date;
};

/**
 * Collapse runs of the *same* event repeating on consecutive calendar days into
 * a single representative spanning the run — used to draw one continuous bar
 * instead of a staircase of per-day pills on the horizontal zooms (1W renders
 * through WeekGrid and is intentionally left untouched).
 *
 * "The same" means identical `displayTitle` and — for timed events — start and
 * end clock times within ±1 hour of the run's anchor; all-day repeats match
 * on title alone. Days must be strictly consecutive (a gap starts a new run),
 * and same-title instances at different times of day stay in separate runs.
 *
 * The merged representative is a fresh copy of the run's first day carrying
 * `spanDays` (the number of days) and an `end` extended to the run's last day,
 * so downstream layout (`durationDays * pxPerDay`) sizes it as one wide bar.
 * Single-day instances pass through untouched. Input is never mutated. The
 * result is deterministically start-sorted so the lane layout and every
 * focus/keyboard-nav list index the same events in the same order.
 */
export function mergeConsecutiveDays(
  events: DisplayEvent[],
  timezone: Timezone,
): DisplayEvent[] {
  if (events.length <= 1) return events;

  const infoOf = (ev: DisplayEvent, idx: number): MergeInfo => {
    if (ev.allDay) {
      // All-day values are stored on UTC midnights; the UTC day ordinal is the
      // stable calendar day (matching the all-day-is-UTC convention elsewhere).
      return { ev, idx, day: Math.floor(ev.start.getTime() / MS_PER_DAY), startMin: 0, endMin: 0 };
    }
    const sp = zonedParts(ev.start, timezone);
    const ep = zonedParts(ev.end, timezone);
    return {
      ev,
      idx,
      day: Date.UTC(sp.y, sp.m - 1, sp.d) / MS_PER_DAY,
      startMin: sp.minutes,
      endMin: ep.minutes,
    };
  };

  // Group by title + all-day flag; each group is split into consecutive-day runs
  // whose clock times match the run anchor within tolerance.
  const groups = new Map<string, MergeInfo[]>();
  events.forEach((ev, idx) => {
    const key = `${ev.displayTitle}\u0000${ev.allDay ? 1 : 0}`;
    const arr = groups.get(key);
    if (arr) arr.push(infoOf(ev, idx));
    else groups.set(key, [infoOf(ev, idx)]);
  });

  const out: { ev: DisplayEvent; idx: number }[] = [];
  for (const infos of groups.values()) {
    infos.sort((a, b) => a.day - b.day || a.idx - b.idx);
    const runs: MergeRun[] = [];
    for (const info of infos) {
      // Find an open run this instance extends (next day) or duplicates (same
      // day) whose anchor clock times are within tolerance.
      let matched: MergeRun | undefined;
      for (const run of runs) {
        if (info.day !== run.lastDay && info.day !== run.lastDay + 1) continue;
        const timeMatch =
          info.ev.allDay ||
          (Math.abs(info.startMin - run.anchor.startMin) <= MERGE_TOLERANCE_MIN &&
            Math.abs(info.endMin - run.anchor.endMin) <= MERGE_TOLERANCE_MIN);
        if (!timeMatch) continue;
        matched = run;
        break;
      }
      if (matched) {
        if (info.day === matched.lastDay + 1) matched.dayCount += 1;
        matched.lastDay = info.day;
        matched.members.push(info.ev);
        const endMs = info.ev.end.getTime();
        if (endMs > matched.endMs) {
          matched.endMs = endMs;
          matched.endDate = info.ev.end;
        }
        if (info.startMin < matched.startLoMin) {
          matched.startLoMin = info.startMin;
          matched.startLoDate = info.ev.start;
        }
        if (info.startMin > matched.startHiMin) {
          matched.startHiMin = info.startMin;
          matched.startHiDate = info.ev.start;
        }
        if (info.endMin < matched.endLoMin) {
          matched.endLoMin = info.endMin;
          matched.endLoDate = info.ev.end;
        }
        if (info.endMin > matched.endHiMin) {
          matched.endHiMin = info.endMin;
          matched.endHiDate = info.ev.end;
        }
      } else {
        runs.push({
          anchor: info,
          lastDay: info.day,
          dayCount: 1,
          members: [info.ev],
          endMs: info.ev.end.getTime(),
          endDate: info.ev.end,
          startLoMin: info.startMin,
          startHiMin: info.startMin,
          startLoDate: info.ev.start,
          startHiDate: info.ev.start,
          endLoMin: info.endMin,
          endHiMin: info.endMin,
          endLoDate: info.ev.end,
          endHiDate: info.ev.end,
        });
      }
    }
    for (const run of runs) {
      if (run.dayCount <= 1) {
        out.push({ ev: run.anchor.ev, idx: run.anchor.idx });
      } else {
        const merged: DisplayEvent = {
          ...run.anchor.ev,
          end: run.endDate,
          spanDays: run.dayCount,
          spanMembers: run.members,
        };
        // Surface a start/end clock-time range only on the side(s) that vary.
        if (run.startLoMin !== run.startHiMin) merged.spanStartRange = [run.startLoDate, run.startHiDate];
        if (run.endLoMin !== run.endHiMin) merged.spanEndRange = [run.endLoDate, run.endHiDate];
        out.push({ ev: merged, idx: run.anchor.idx });
      }
    }
  }

  // Return in a deterministic start-then-uid order, independent of input order,
  // so every caller (the lane layout and every focus/keyboard-nav list) agrees
  // on the same ordering — including ties at the same instant.
  out.sort(
    (a, b) =>
      a.ev.start.getTime() - b.ev.start.getTime() ||
      (a.ev.uid < b.ev.uid ? -1 : a.ev.uid > b.ev.uid ? 1 : 0),
  );
  return out.map((o) => o.ev);
}
