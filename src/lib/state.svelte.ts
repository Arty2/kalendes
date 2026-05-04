import type { AppConfig, DisplayEvent, ParsedEvent, Zoom } from './types';
import { loadConfig } from './storage';
import { applyRules } from './rules';

export const config = $state<AppConfig>(loadConfig());

export const events = $state<{ byFeed: Record<string, ParsedEvent[]> }>({ byFeed: {} });

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

export const ui = $state<{
  modalEvent: DisplayEvent | null;
  settingsOpen: boolean;
  loading: boolean;
  error: string | null;
  errorModal: { feedName: string; message: string } | null;
  toast: string | null;
  feedErrors: Record<string, string>;
}>({
  modalEvent: null,
  settingsOpen: false,
  loading: false,
  error: null,
  errorModal: null,
  toast: null,
  feedErrors: {},
});

export function displayEventsFor(feedId: string): DisplayEvent[] {
  const raw = events.byFeed[feedId] ?? [];
  return applyRules(raw, config.rules);
}
