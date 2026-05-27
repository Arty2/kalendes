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
import { loadScratchpad, saveScratchpad, makeScratchpadEvent, type ScratchpadInput } from './scratchpad';

export const config = $state<AppConfig>(loadConfig());

export const events = $state<{
  byFeed: Record<string, ParsedEvent[]>;
  tzByFeed: Record<string, string>;
  rawByUid: Record<string, string>;
  lastSuccessAt: Record<string, number>;
}>({ byFeed: { [SCRATCHPAD_FEED_ID]: loadScratchpad() }, tzByFeed: {}, rawByUid: {}, lastSuccessAt: {} });

export function addScratchpadEvent(input: ScratchpadInput): ParsedEvent {
  const ev = makeScratchpadEvent(input);
  const prev = events.byFeed[SCRATCHPAD_FEED_ID] ?? [];
  events.byFeed[SCRATCHPAD_FEED_ID] = [...prev, ev].sort((a, b) => a.start.getTime() - b.start.getTime());
  saveScratchpad(events.byFeed[SCRATCHPAD_FEED_ID]);
  return ev;
}

export function updateScratchpadEvent(uid: string, input: ScratchpadInput): void {
  const prev = events.byFeed[SCRATCHPAD_FEED_ID] ?? [];
  const next = makeScratchpadEvent(input);
  next.uid = uid;
  events.byFeed[SCRATCHPAD_FEED_ID] = prev
    .map((e) => (e.uid === uid ? next : e))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  saveScratchpad(events.byFeed[SCRATCHPAD_FEED_ID]);
}

export function deleteScratchpadEvent(uid: string): void {
  const prev = events.byFeed[SCRATCHPAD_FEED_ID] ?? [];
  events.byFeed[SCRATCHPAD_FEED_ID] = prev.filter((e) => e.uid !== uid);
  saveScratchpad(events.byFeed[SCRATCHPAD_FEED_ID]);
  if (selection.uids.has(uid)) {
    const next = new Set(selection.uids);
    next.delete(uid);
    selection.uids = next;
    if (next.size === 0) selection.mode = false;
  }
  if (ui.modalEvent?.uid === uid) ui.modalEvent = null;
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
  shareImport: { feeds: CalendarFeed[]; rules: FindReplaceRule[]; view: ShareImportView | null } | null;
  rawEventUid: string | null;
  tempMarkerMs: number | null;
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
});

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
