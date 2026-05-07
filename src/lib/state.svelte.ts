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
  eventIndex: 0,
});

export type ShareImportView = {
  zoom?: Zoom;
  locale?: Locale;
  dateFormat?: DateFormat;
  theme?: Theme;
};

export const ui = $state<{
  modalEvent: DisplayEvent | null;
  settingsOpen: boolean;
  settingsScrollToFeedId: string | null;
  settingsAutoEditFeedId: string | null;
  loading: boolean;
  error: string | null;
  errorModal: { feedName: string; message: string } | null;
  toast: string | null;
  feedErrors: Record<string, string>;
  shareImport: { feeds: CalendarFeed[]; rules: FindReplaceRule[]; view: ShareImportView | null } | null;
  rawEventUid: string | null;
}>({
  modalEvent: null,
  settingsOpen: false,
  settingsScrollToFeedId: null,
  settingsAutoEditFeedId: null,
  loading: false,
  error: null,
  errorModal: null,
  toast: null,
  feedErrors: {},
  shareImport: null,
  rawEventUid: null,
});

export function displayEventsFor(feedId: string): DisplayEvent[] {
  const raw = events.byFeed[feedId] ?? [];
  return applyRules(raw, config.rules);
}
