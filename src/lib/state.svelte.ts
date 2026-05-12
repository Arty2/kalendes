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

export const focus = $state<{ rowIndex: number; eventIndex: number }>({
  rowIndex: 0,
  eventIndex: -1,
});

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

export function displayEventsFor(feedId: string): DisplayEvent[] {
  const raw = events.byFeed[feedId] ?? [];
  return applyRules(raw, config.rules);
}

export function effectiveFeedTz(feedId: string): string | null {
  const feed = config.feeds.find((f) => f.id === feedId);
  if (feed?.timezone && feed.timezone.length > 0) return feed.timezone;
  return events.tzByFeed[feedId] ?? null;
}
