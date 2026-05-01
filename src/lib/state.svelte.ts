import type { AppConfig, ParsedEvent, Zoom } from './types';
import { loadConfig } from './storage';

export const config = $state<AppConfig>(loadConfig());

export const events = $state<{ byFeed: Record<string, ParsedEvent[]> }>({ byFeed: {} });

export const zoom = $state<{ value: Zoom }>({ value: 'month' });

export const search = $state<{ query: string; currentIndex: number }>({
  query: '',
  currentIndex: 0,
});

export const ui = $state<{
  modalEvent: ParsedEvent | null;
  settingsOpen: boolean;
  loading: boolean;
  error: string | null;
}>({
  modalEvent: null,
  settingsOpen: false,
  loading: false,
  error: null,
});
