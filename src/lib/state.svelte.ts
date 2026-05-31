import type {
  AppConfig,
  CalendarFeed,
  DateFormat,
  DisplayEvent,
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
  rawByUid: Record<string, string>;
  lastSuccessAt: Record<string, number>;
}>({ byFeed: loadLocalLanes(), tzByFeed: {}, rawByUid: {}, lastSuccessAt: {} });

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

// Move an event between local lanes, keeping its uid. URL/secret feeds are
// network-fetched and overwritten on refresh, so only scratchpad lanes are
// valid targets. Both affected lanes are re-sorted and persisted.
export function moveEventToLane(uid: string, destFeedId: string): void {
  const srcFeedId = laneFeedIdOf(uid);
  if (srcFeedId === destFeedId) return;
  if (!destFeedId.startsWith('scratchpad:')) return;
  const ev = (events.byFeed[srcFeedId] ?? []).find((e) => e.uid === uid);
  if (!ev) return;
  events.byFeed[srcFeedId] = (events.byFeed[srcFeedId] ?? []).filter((e) => e.uid !== uid);
  const moved = { ...ev, feedId: destFeedId };
  events.byFeed[destFeedId] = [...(events.byFeed[destFeedId] ?? []), moved].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  saveScratchpad(events.byFeed[srcFeedId], laneIdOf(srcFeedId));
  saveScratchpad(events.byFeed[destFeedId], laneIdOf(destFeedId));
  if (ui.modalEvent?.uid === uid) ui.modalEvent = { ...ui.modalEvent, feedId: destFeedId };
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

// Developer/test helper: populate the Draft lane with a spread of events around
// today and add an extra imported lane, so the local-lane UI can be exercised
// without manual data entry. Reused by the long-press Reset shortcut.
export function seedTestData(): void {
  const DAY = 86_400_000;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const at = (offsetDays: number, hh = 0, mm = 0): Date =>
    new Date(midnight.getTime() + offsetDays * DAY + hh * 3_600_000 + mm * 60_000);

  const draft: ParsedEvent[] = [
    makeScratchpadEvent({
      title: 'Past conference', start: at(-42), end: at(-39), allDay: true,
      location: 'Berlin', description: 'Three-day event well before today.', category: 'events',
    }),
    makeScratchpadEvent({
      title: 'Dentist', start: at(-14, 9, 0), end: at(-14, 10, 0), allDay: false,
      location: 'Clinic', category: 'none',
    }),
    makeScratchpadEvent({
      title: 'Project deadline', start: at(-3), end: at(-2), allDay: true, category: 'announcements',
    }),
    makeScratchpadEvent({
      title: 'Standup', start: at(-1, 9, 30), end: at(-1, 10, 0), allDay: false, category: 'none',
    }),
    makeScratchpadEvent({
      title: 'Today all-day', start: at(0), end: at(1), allDay: true, category: 'observances',
    }),
    makeScratchpadEvent({
      title: 'Lunch with Alex', start: at(0, 12, 0), end: at(0, 13, 0), allDay: false,
      location: 'Cafe', description: 'Overlaps the morning block.', category: 'guests',
    }),
    makeScratchpadEvent({
      title: 'Morning workshop', start: at(0, 11, 30), end: at(0, 12, 30), allDay: false,
      description: 'Overlaps lunch on purpose to test lane stacking.', category: 'events',
    }),
    makeScratchpadEvent({
      title: 'Trip abroad', start: at(5), end: at(9), allDay: true,
      location: 'Lisbon', category: 'events',
    }),
    makeScratchpadEvent({
      title: 'Quarterly review', start: at(30, 14, 0), end: at(30, 15, 30), allDay: false,
      category: 'announcements',
    }),
  ];
  const sortedDraft = draft.sort((a, b) => a.start.getTime() - b.start.getTime());
  events.byFeed[SCRATCHPAD_FEED_ID] = sortedDraft;
  saveScratchpad(sortedDraft);

  const imported: ParsedEvent[] = [
    makeScratchpadEvent({ title: 'Imported: kickoff', start: at(-7), end: at(-6), allDay: true }),
    makeScratchpadEvent({
      title: 'Imported: call', start: at(-1, 16, 0), end: at(-1, 16, 30), allDay: false,
    }),
    makeScratchpadEvent({ title: 'Imported: release', start: at(2), end: at(3), allDay: true }),
    makeScratchpadEvent({
      title: 'Imported: retro', start: at(12, 10, 0), end: at(12, 11, 0), allDay: false,
    }),
  ];
  createImportedLane('Imported (test)', imported);
}

export const zoom = $state<{ value: Zoom }>({ value: 'month' });

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
  addEventOpen: boolean;
  addEventEditUid: string | null;
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
  addEventOpen: false,
  addEventEditUid: null,
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
        if (!ev.allDay && !ev.hidden) {
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

// Move keyboard/visual focus to an event by uid, finding its feed and the
// index within that feed's rendered (visible, start-sorted) list — matching
// the indexing Row uses for both expanded pills and collapsed dots.
export function focusEventByUid(uid: string): void {
  for (const feed of config.feeds) {
    const arr = _displayByFeed[feed.id] ?? [];
    const visible = arr
      .filter((e) => !e.hidden || e.styleVariant === 'hidden')
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const idx = visible.findIndex((e) => e.uid === uid);
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
