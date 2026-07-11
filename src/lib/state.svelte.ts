import type {
  AppConfig,
  CalendarFeed,
  DateFormat,
  DisplayEvent,
  FeedValidators,
  FindReplaceRule,
  Locale,
  ParsedEvent,
  Theme,
  Zoom,
} from './types';
import { SCRATCHPAD_FEED_ID } from './types';
import { loadConfig } from './storage';
import { applyRules } from './rules';
import { dtf } from './format';
import { MS_PER_DAY } from './time';
import { mergeConsecutiveDays } from './event-display';
import {
  loadScratchpad,
  saveScratchpad,
  clearScratchpad,
  makeScratchpadEvent,
  type ScratchpadInput,
} from './scratchpad';

export const config = $state<AppConfig>(loadConfig());

export const events = $state<{
  byFeed: Record<string, ParsedEvent[]>;
  tzByFeed: Record<string, string>;
  // The raw feed text of the last successful fetch, session-only, for the
  // event modal's on-demand source view (one string per feed — much lighter
  // than the per-occurrence VEVENT copies this replaced).
  rawTextByFeed: Record<string, string>;
  lastSuccessAt: Record<string, number>;
  // Per-feed ETag/Last-Modified, so refreshes can revalidate instead of
  // re-downloading and re-parsing an unchanged feed.
  validators: Record<string, FeedValidators>;
}>({ byFeed: loadLocalLanes(), tzByFeed: {}, rawTextByFeed: {}, lastSuccessAt: {}, validators: {} });

// The lane id stored inside a scratchpad FeedSource, derived from its feed id.
function laneIdOf(feedId: string): string {
  return feedId.startsWith('scratchpad:') ? feedId.slice('scratchpad:'.length) : 'default';
}

// Hydrate every local lane (the Draft plus any imported .ics) from localStorage.
function loadLocalLanes(): Record<string, ParsedEvent[]> {
  const out: Record<string, ParsedEvent[]> = {};
  for (const f of config.feeds) {
    if (f.source.kind === 'scratchpad') out[f.id] = loadScratchpad(f.source.id ?? 'default');
  }
  if (!out[SCRATCHPAD_FEED_ID]) out[SCRATCHPAD_FEED_ID] = loadScratchpad();
  return out;
}

// Find which local lane currently holds an event, so edits/deletes route to it.
function laneFeedIdOf(uid: string): string {
  for (const f of config.feeds) {
    if (f.source.kind !== 'scratchpad') continue;
    if ((events.byFeed[f.id] ?? []).some((e) => e.uid === uid)) return f.id;
  }
  return SCRATCHPAD_FEED_ID;
}

export function addScratchpadEvent(
  input: ScratchpadInput,
  feedId: string = SCRATCHPAD_FEED_ID,
): ParsedEvent {
  const ev = makeScratchpadEvent(input);
  ev.feedId = feedId;
  const prev = events.byFeed[feedId] ?? [];
  events.byFeed[feedId] = [...prev, ev].sort((a, b) => a.start.getTime() - b.start.getTime());
  saveScratchpad(events.byFeed[feedId], laneIdOf(feedId));
  return ev;
}

export function updateScratchpadEvent(uid: string, input: ScratchpadInput): void {
  const feedId = laneFeedIdOf(uid);
  const prev = events.byFeed[feedId] ?? [];
  const next = makeScratchpadEvent(input);
  next.uid = uid;
  next.feedId = feedId;
  events.byFeed[feedId] = prev
    .map((e) => (e.uid === uid ? next : e))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  saveScratchpad(events.byFeed[feedId], laneIdOf(feedId));
}

export function deleteScratchpadEvent(uid: string): void {
  const feedId = laneFeedIdOf(uid);
  const prev = events.byFeed[feedId] ?? [];
  events.byFeed[feedId] = prev.filter((e) => e.uid !== uid);
  saveScratchpad(events.byFeed[feedId], laneIdOf(feedId));
  if (selection.uids.has(uid)) {
    const next = new Set(selection.uids);
    next.delete(uid);
    selection.uids = next;
    if (next.size === 0) selection.mode = false;
  }
  if (ui.modalEvent?.uid === uid) ui.modalEvent = null;
}

// Move one or more events between local lanes, keeping their uids. URL/secret
// feeds are network-fetched and overwritten on refresh, so only scratchpad lanes
// are valid targets. Every touched lane is re-sorted and persisted once.
// Returns a uid→original-lane map of the events it actually moved, so callers can
// reverse the move (e.g. an undo affordance) by moving each back to its source.
export function moveEventsToLane(uids: Iterable<string>, destFeedId: string): Map<string, string> {
  const moved = new Map<string, string>();
  if (!destFeedId.startsWith('scratchpad:')) return moved;
  const touched = new Set<string>([destFeedId]);
  for (const uid of uids) {
    const srcFeedId = laneFeedIdOf(uid);
    if (srcFeedId === destFeedId) continue;
    const ev = (events.byFeed[srcFeedId] ?? []).find((e) => e.uid === uid);
    if (!ev) continue;
    events.byFeed[srcFeedId] = (events.byFeed[srcFeedId] ?? []).filter((e) => e.uid !== uid);
    events.byFeed[destFeedId] = [...(events.byFeed[destFeedId] ?? []), { ...ev, feedId: destFeedId }];
    touched.add(srcFeedId);
    moved.set(uid, srcFeedId);
    if (ui.modalEvent?.uid === uid) ui.modalEvent = { ...ui.modalEvent, feedId: destFeedId };
  }
  for (const feedId of touched) {
    events.byFeed[feedId] = (events.byFeed[feedId] ?? []).sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    saveScratchpad(events.byFeed[feedId], laneIdOf(feedId));
  }
  return moved;
}

// Move a single event — thin wrapper over the batch move.
export function moveEventToLane(uid: string, destFeedId: string): void {
  moveEventsToLane([uid], destFeedId);
}

// Delete only the local-lane events among the given uids; URL/secret-feed events
// are left alone (they re-fetch). Each touched lane is persisted once.
export function deleteLocalEvents(uids: Iterable<string>): void {
  const drop = new Set(uids);
  const touched: string[] = [];
  for (const f of config.feeds) {
    if (f.source.kind !== 'scratchpad') continue;
    const list = events.byFeed[f.id] ?? [];
    const next = list.filter((e) => !drop.has(e.uid));
    if (next.length !== list.length) {
      events.byFeed[f.id] = next;
      touched.push(f.id);
    }
  }
  for (const id of touched) saveScratchpad(events.byFeed[id], laneIdOf(id));
}

// Copy the given events (found in any lane/feed) into a local lane as fresh
// scratchpad events (new uids). Used for URL-only selections where move isn't
// possible. Originals are left intact.
// Returns the uids of the freshly created copies, so callers can reverse the copy
// (e.g. an undo affordance) by deleting them.
export function copyEventsToLane(uids: Iterable<string>, destFeedId: string): string[] {
  if (!destFeedId.startsWith('scratchpad:')) return [];
  const want = new Set(uids);
  const copies: ParsedEvent[] = [];
  for (const list of Object.values(events.byFeed)) {
    for (const e of list) {
      if (!want.has(e.uid)) continue;
      const c = makeScratchpadEvent({
        title: e.title, start: e.start, end: e.end, allDay: e.allDay,
        location: e.location, description: e.description, category: e.category,
        travel: e.travel,
      });
      c.feedId = destFeedId;
      copies.push(c);
    }
  }
  if (copies.length === 0) return [];
  events.byFeed[destFeedId] = [...(events.byFeed[destFeedId] ?? []), ...copies].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  saveScratchpad(events.byFeed[destFeedId], laneIdOf(destFeedId));
  return copies.map((c) => c.uid);
}

function newLaneId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Create a new local lane (behaving like the Draft) from imported .ics events.
export function createImportedLane(name: string, evts: ParsedEvent[]): CalendarFeed {
  const id = newLaneId();
  const feedId = 'scratchpad:' + id;
  const order = config.feeds.reduce((m, f) => Math.max(m, f.order), -1) + 1;
  const feed: CalendarFeed = {
    id: feedId,
    source: { kind: 'scratchpad', id },
    name,
    collapsed: false,
    order,
    kind: 'events',
    category: 'none',
  };
  const laneEvents = evts
    .map((e) => ({ ...e, feedId }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  config.feeds = [...config.feeds, feed];
  events.byFeed[feedId] = laneEvents;
  saveScratchpad(laneEvents, id);
  return feed;
}

// Purge a local lane's stored events (the caller removes it from config.feeds).
export function removeLocalLane(feedId: string): void {
  clearScratchpad(laneIdOf(feedId));
  delete events.byFeed[feedId];
}

// Empty the Draft lane (in memory + storage). The Draft feed itself stays in the
// default config; only its events are dropped. Used by the dev-mode reset so
// seeded test data doesn't survive into a "clean" reset.
export function clearDraftLane(): void {
  clearScratchpad();
  events.byFeed[SCRATCHPAD_FEED_ID] = [];
}

// Developer/test helper: populate the Draft lane with a spread of events around
// today and add an extra imported lane, so the local-lane UI can be exercised
// without manual data entry. Reused by the long-press Reset shortcut.
export function seedTestData(): void {
  const DAY = 86_400_000;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const at = (offsetDays: number, hh = 0, mm = 0): Date =>
    new Date(midnight.getTime() + offsetDays * DAY + hh * 3_600_000 + mm * 60_000);
  // All-day events are anchored to UTC midnight (matching AddEventModal / ICS import),
  // so the UTC-based date formatter renders a single-day span as one date, not two.
  const today = new Date();
  const atDay = (offsetDays: number): Date =>
    new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays));

  const draft: ParsedEvent[] = [
    makeScratchpadEvent({
      title: 'Past conference', start: atDay(-42), end: atDay(-39), allDay: true,
      location: 'Berlin', description: 'Three-day event well before today.', category: 'events',
    }),
    makeScratchpadEvent({
      title: 'Spring break', start: atDay(-10), end: atDay(-3), allDay: true,
      location: 'Crete', description: 'Week-long multi-day all-day span.', category: 'holidays',
    }),
    makeScratchpadEvent({
      title: 'Dentist', start: at(-14, 9, 0), end: at(-14, 10, 0), allDay: false,
      location: 'Clinic', category: 'none',
    }),
    makeScratchpadEvent({
      title: 'Project deadline', start: atDay(-3), end: atDay(-2), allDay: true,
      location: 'Remote', category: 'announcements',
    }),
    makeScratchpadEvent({
      title: 'Standup', start: at(-1, 9, 30), end: at(-1, 10, 0), allDay: false,
      location: 'Office', category: 'none',
    }),
    makeScratchpadEvent({
      title: 'Today all-day', start: atDay(0), end: atDay(1), allDay: true,
      location: 'Town hall', category: 'observances',
    }),
    makeScratchpadEvent({
      title: 'Lunch with Alex', start: at(0, 12, 0), end: at(0, 13, 0), allDay: false,
      location: 'Cafe', description: 'Overlaps the morning block.', category: 'guests',
    }),
    makeScratchpadEvent({
      title: 'Morning workshop', start: at(0, 11, 30), end: at(0, 12, 30), allDay: false,
      location: 'Room 2', description: 'Overlaps lunch on purpose to test lane stacking.',
      category: 'events',
    }),
    makeScratchpadEvent({
      title: 'Public holiday', start: atDay(3), end: atDay(4), allDay: true,
      category: 'holidays',
    }),
    makeScratchpadEvent({
      title: 'Trip abroad', start: atDay(5), end: atDay(9), allDay: true,
      location: 'Lisbon', category: 'events',
    }),
    makeScratchpadEvent({
      title: 'Company offsite', start: atDay(15), end: atDay(20), allDay: true,
      location: 'Porto', description: 'Five-day multi-day event for lane testing.',
      category: 'announcements',
    }),
    makeScratchpadEvent({
      title: 'Quarterly review', start: at(30, 14, 0), end: at(30, 15, 30), allDay: false,
      location: 'Boardroom', category: 'announcements',
    }),
  ];
  const sortedDraft = draft.sort((a, b) => a.start.getTime() - b.start.getTime());
  events.byFeed[SCRATCHPAD_FEED_ID] = sortedDraft;
  saveScratchpad(sortedDraft);
  // The Draft lane defaults to hidden; reveal it so the seeded events are visible.
  const draftFeed = config.feeds.find((f) => f.id === SCRATCHPAD_FEED_ID);
  if (draftFeed) delete draftFeed.hidden;

  const imported: ParsedEvent[] = [
    makeScratchpadEvent({
      title: 'Imported: kickoff', start: atDay(-7), end: atDay(-6), allDay: true,
      location: 'HQ', category: 'events',
    }),
    makeScratchpadEvent({
      title: 'Imported: call', start: at(-1, 16, 0), end: at(-1, 16, 30), allDay: false,
      location: 'Zoom',
    }),
    makeScratchpadEvent({
      title: 'Imported: release', start: atDay(2), end: atDay(4), allDay: true,
      category: 'announcements',
    }),
    makeScratchpadEvent({
      title: 'Imported: retro', start: at(12, 10, 0), end: at(12, 11, 0), allDay: false,
      location: 'Room 5',
    }),
    // A run of the same event on consecutive days — should collapse into one
    // continuous bar with a ×N count on every zoom except 1W. Day 7 starts 30m
    // late and day 8 ends 30m early — within the ±1-hour merge tolerance — so
    // the merged pill shows a "10:00/10:30 — 19:30/20:00" time range.
    makeScratchpadEvent({ title: 'Imported: rehearsal', start: at(5, 10, 0), end: at(5, 20, 0), allDay: false, location: 'Stage' }),
    makeScratchpadEvent({ title: 'Imported: rehearsal', start: at(6, 10, 0), end: at(6, 20, 0), allDay: false, location: 'Stage' }),
    makeScratchpadEvent({ title: 'Imported: rehearsal', start: at(7, 10, 30), end: at(7, 20, 0), allDay: false, location: 'Stage' }),
    makeScratchpadEvent({ title: 'Imported: rehearsal', start: at(8, 10, 0), end: at(8, 19, 30), allDay: false, location: 'Stage' }),
    makeScratchpadEvent({ title: 'Imported: rehearsal', start: at(9, 10, 0), end: at(9, 20, 0), allDay: false, location: 'Stage' }),
    makeScratchpadEvent({ title: 'Imported: rehearsal', start: at(10, 10, 0), end: at(10, 20, 0), allDay: false, location: 'Stage' }),
    // Day 11 is skipped: the gap must split the run into a second, separate bar.
    makeScratchpadEvent({ title: 'Imported: rehearsal', start: at(13, 10, 0), end: at(13, 20, 0), allDay: false, location: 'Stage' }),
    makeScratchpadEvent({ title: 'Imported: rehearsal', start: at(14, 10, 0), end: at(14, 20, 0), allDay: false, location: 'Stage' }),
  ];
  createImportedLane('Imported (test)', imported);
}

// `lastNonWeek` remembers the zoom to return to when the 1W view is toggled off
// (the week view sits outside the normal zoom progression).
export const zoom = $state<{ value: Zoom; lastNonWeek: Zoom }>({
  value: 'month',
  lastNonWeek: 'month',
});

export const search = $state<{
  query: string;
  currentIndex: number;
  open: boolean;
  includesPast: boolean;
}>({
  query: '',
  currentIndex: 0,
  open: false,
  includesPast: false,
});

export const focus = $state<{ feedId: string | null; eventIndex: number }>({
  feedId: null,
  eventIndex: -1,
});

export const selection = $state<{ mode: boolean; uids: Set<string> }>({
  mode: false,
  uids: new Set(),
});

export function toggleSelected(uid: string): void {
  const next = new Set(selection.uids);
  if (next.has(uid)) next.delete(uid);
  else next.add(uid);
  selection.uids = next;
  if (next.size === 0) selection.mode = false;
}

export function addToSelection(uid: string): void {
  if (selection.uids.has(uid)) return;
  selection.uids = new Set(selection.uids).add(uid);
}

export function clearSelection(): void {
  selection.uids = new Set();
  selection.mode = false;
}

export type ShareImportView = {
  zoom?: Zoom;
  locale?: Locale;
  dateFormat?: DateFormat;
  theme?: Theme;
};

export type LogEntry = {
  id: string;
  ts: number;
  message: string;
  kind: 'info' | 'warn' | 'error';
};

export const ui = $state<{
  modalEvent: DisplayEvent | null;
  // Lightweight hover preview (mouse only): the event under the pointer and the
  // hovered pill's viewport rect used to anchor the popover. Distinct from
  // modalEvent (the full, click-opened dialog) so the two never fight.
  hoverEvent: DisplayEvent | null;
  hoverAnchor: DOMRect | null;
  addEventOpen: boolean;
  addEventEditUid: string | null;
  // A local wall-clock instant to prefill the Add-event modal with (set by
  // clicking an empty 1W slot); opens a timed event at that day + time.
  addEventPrefillStartMs: number | null;
  settingsOpen: boolean;
  settingsScrollToFeedId: string | null;
  settingsAutoEditFeedId: string | null;
  settingsScrollToRuleId: string | null;
  settingsAutoEditRuleId: string | null;
  loading: boolean;
  error: string | null;
  errorModal: { feedName: string; message: string } | null;
  log: LogEntry[];
  statusExpanded: boolean;
  feedErrors: Record<string, string>;
  shareImport: { feeds: CalendarFeed[]; rules: FindReplaceRule[]; view: ShareImportView | null; kioskPin: string | null } | null;
  rawEventUid: string | null;
  tempMarkerMs: number | null;
  kioskPinModal: 'set' | 'unlock' | null;
  timelineMusic: boolean;
  musicSweeping: boolean;
}>({
  modalEvent: null,
  hoverEvent: null,
  hoverAnchor: null,
  addEventOpen: false,
  addEventEditUid: null,
  addEventPrefillStartMs: null,
  settingsOpen: false,
  settingsScrollToFeedId: null,
  settingsAutoEditFeedId: null,
  settingsScrollToRuleId: null,
  settingsAutoEditRuleId: null,
  loading: false,
  error: null,
  errorModal: null,
  log: [],
  statusExpanded: false,
  feedErrors: {},
  shareImport: null,
  rawEventUid: null,
  tempMarkerMs: null,
  kioskPinModal: null,
  timelineMusic: false,
  musicSweeping: false,
});

// Kiosk mode is active iff a PIN exists. Reading the reactive config field keeps
// callers (templates, deriveds, effects) updated when the PIN is set/cleared.
export function isKiosk(): boolean {
  return config.kioskPin != null;
}

// --- Lightweight hover preview (mouse-only) ---------------------------------
// Debounced open/close intent so skimming the mouse across dense pills doesn't
// flash the preview. The card stays mounted while it swaps between events, so
// moving from one pill to the next never closes and reopens it.
const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 90;
let hoverOpenTimer: ReturnType<typeof setTimeout> | null = null;
let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;

function clearHoverOpen(): void {
  if (hoverOpenTimer != null) { clearTimeout(hoverOpenTimer); hoverOpenTimer = null; }
}
function clearHoverClose(): void {
  if (hoverCloseTimer != null) { clearTimeout(hoverCloseTimer); hoverCloseTimer = null; }
}

/** Open (or, if already open, swap to) the hover preview for `event`. */
export function openHoverPreview(event: DisplayEvent, anchor: DOMRect): void {
  // Never compete with the full click-opened modal or bulk-selection mode.
  if (ui.modalEvent || selection.mode) return;
  clearHoverClose();
  // Already visible → swap content instantly (no close→reopen flash).
  if (ui.hoverEvent) {
    ui.hoverEvent = event;
    ui.hoverAnchor = anchor;
    return;
  }
  clearHoverOpen();
  hoverOpenTimer = setTimeout(() => {
    hoverOpenTimer = null;
    if (ui.modalEvent || selection.mode) return;
    ui.hoverEvent = event;
    ui.hoverAnchor = anchor;
  }, HOVER_OPEN_MS);
}

/** Close the preview after a short grace period (cancelled if a pill re-opens). */
export function closeHoverPreviewSoon(): void {
  clearHoverOpen();
  clearHoverClose();
  hoverCloseTimer = setTimeout(() => {
    hoverCloseTimer = null;
    ui.hoverEvent = null;
    ui.hoverAnchor = null;
  }, HOVER_CLOSE_MS);
}

/** Close the preview immediately (e.g. when a click opens the full modal). */
export function cancelHoverPreview(): void {
  clearHoverOpen();
  clearHoverClose();
  ui.hoverEvent = null;
  ui.hoverAnchor = null;
}

const MAX_LOG_ENTRIES = 50;

export function pushLog(message: string, kind: LogEntry['kind'] = 'info'): void {
  const entry: LogEntry = {
    id: Math.random().toString(36).slice(2, 10) + ts(),
    ts: Date.now(),
    message,
    kind,
  };
  ui.log = [entry, ...ui.log].slice(0, MAX_LOG_ENTRIES);
}

function ts(): string {
  return Date.now().toString(36);
}

function parseHHMM(hhmm: string): number | null {
  if (!hhmm) return null;
  const ps = hhmm.split(':');
  const h = parseInt(ps[0] ?? '0', 10);
  const m = parseInt(ps[1] ?? '0', 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function timeMinutes(d: Date, tz: string): number {
  const tzStr = tz === 'local' ? undefined : tz;
  try {
    const parts = dtf('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tzStr,
    }).formatToParts(d);
    const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    return h * 60 + m;
  } catch { return 0; }
}

const _displayByFeed = $derived.by<Record<string, DisplayEvent[]>>(() => {
  const out: Record<string, DisplayEvent[]> = {};
  const morningMins = parseHHMM(config.morningLimit);
  const eveningMins = parseHHMM(config.eveningLimit);
  for (const feed of config.feeds) {
    const evts = applyRules(events.byFeed[feed.id] ?? [], config.rules);
    if (morningMins !== null || eveningMins !== null) {
      for (const ev of evts) {
        // The limits hide short off-hours noise by its start clock time; a
        // timed event lasting a day or more (a multi-day conference or trip)
        // isn't noise, no matter when it starts — leave it visible.
        const multiDay = ev.end.getTime() - ev.start.getTime() >= MS_PER_DAY;
        if (!ev.allDay && !ev.hidden && !multiDay) {
          const startMins = timeMinutes(ev.start, config.timezone);
          if (morningMins !== null && startMins < morningMins) ev.hidden = true;
          else if (eveningMins !== null && startMins >= eveningMins) ev.hidden = true;
        }
      }
    }
    out[feed.id] = evts;
  }
  return out;
});

export function displayEventsFor(feedId: string): DisplayEvent[] {
  return _displayByFeed[feedId] ?? [];
}

export function getDisplayByFeed(): Record<string, DisplayEvent[]> {
  return _displayByFeed;
}

// Per-feed events exactly as the horizontal timeline renders them: visible
// (time-limit-hidden dropped, Hidden-style kept), start-sorted, with runs of
// the same event on consecutive days merged into one continuous bar. The 1W
// week view renders per-day (via WeekGrid), so it skips the merge. This is the
// single source of truth for focus/keyboard-nav indexing so every list — the
// lane pills, arrow-key navigation, the header prev/next, and focus-by-uid —
// agrees on the same events in the same order.
export function timelineEventsFor(feedId: string): DisplayEvent[] {
  const visible = (_displayByFeed[feedId] ?? []).filter(
    (e) => !e.hidden || e.styleVariant === 'hidden',
  );
  if (zoom.value === 'week') {
    return [...visible].sort((a, b) => a.start.getTime() - b.start.getTime());
  }
  // mergeConsecutiveDays returns a deterministic start-sorted result.
  return mergeConsecutiveDays(visible, effectiveFeedTz(feedId) ?? config.timezone);
}

// Move keyboard/visual focus to an event by uid, finding its feed and the
// index within that feed's rendered list (via timelineEventsFor) — matching
// the indexing Row uses for both expanded pills and collapsed dots.
export function focusEventByUid(uid: string): void {
  for (const feed of config.feeds) {
    const idx = timelineEventsFor(feed.id).findIndex((e) => e.uid === uid);
    if (idx >= 0) {
      focus.feedId = feed.id;
      focus.eventIndex = idx;
      return;
    }
  }
}

export function effectiveFeedTz(feedId: string): string | null {
  const feed = config.feeds.find((f) => f.id === feedId);
  if (feed?.timezone && feed.timezone.length > 0) return feed.timezone;
  return events.tzByFeed[feedId] ?? null;
}
