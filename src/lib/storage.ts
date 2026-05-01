import type { AppConfig, CalendarFeed } from './types';
import { SCHEMA_VERSION } from './types';

export const STORAGE_KEY = 'calendar-timeline:config:v1';

export function defaultConfig(): AppConfig {
  const demoFeed: CalendarFeed = {
    id: 'static:/demo/greek-holidays.ics',
    source: { kind: 'static', path: '/demo/greek-holidays.ics' },
    name: 'Greek Public Holidays',
    collapsed: false,
    order: 0,
  };
  return {
    feeds: [demoFeed],
    refreshIntervalMs: 15 * 60 * 1000,
    schemaVersion: SCHEMA_VERSION,
  };
}

export function loadConfig(): AppConfig {
  if (typeof localStorage === 'undefined') return defaultConfig();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultConfig();
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== SCHEMA_VERSION) return defaultConfig();
    return parsed as AppConfig;
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: AppConfig): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function exportConfig(config: AppConfig): string {
  return JSON.stringify(config, null, 2);
}

export function importConfig(json: string): AppConfig {
  const parsed = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid config');
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('Unsupported schema version: ' + parsed.schemaVersion);
  }
  if (!Array.isArray(parsed.feeds)) throw new Error('Invalid feeds');
  return parsed as AppConfig;
}
