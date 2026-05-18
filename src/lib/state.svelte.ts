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
import { loadConfig } from './storage';
import { applyRules } from './rules';

export const config = $state<AppConfig>(loadConfig());

export const events = $state<{
  byFeed: Record<string, ParsedEvent[]>;
  tzByFeed: Record<string, string>;
  rawByUid: Record<string, string>;
  lastSuccessAt: Record<string, number>;
}>({ byFeed: {}, tzByFeed: {}, rawByUid: {}, lastSuccessAt: {} });

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

export type ShareImportView = {
  zoom?: Zoom;
  locale?: Locale;
  dateFormat?: DateFormat;
  theme?: Theme;
  kiosk?: boolean;
  eink?: boolean;
};

export type LogEntry = {
  id: string;
  ts: number;
  message: string;
  kind: 'info' | 'warn' | 'error';
};

export const ui = $state<{
  modalEvent: DisplayEvent | null;
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
    const parts = new Intl.DateTimeFormat('en-US', {
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

export function effectiveFeedTz(feedId: string): string | null {
  const feed = config.feeds.find((f) => f.id === feedId);
  if (feed?.timezone && feed.timezone.length > 0) return feed.timezone;
  return events.tzByFeed[feedId] ?? null;
}
