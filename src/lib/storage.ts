import type { AppConfig, CalendarFeed, Theme } from './types';
import { SCHEMA_VERSION } from './types';

export const STORAGE_KEY = 'calendar-timeline:config';

export const GREEK_HOLIDAYS_URL = 'https://www.officeholidays.com/ics/greece';
export const USA_HOLIDAYS_URL = 'https://www.apple.com/calendar/ical/USHolidays.ics';

function resolveSystemTheme(): Theme {
  if (typeof matchMedia === 'undefined') return 'light';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function defaultConfig(): AppConfig {
  const greek: CalendarFeed = {
    id: 'user:greek-bank-holidays',
    source: { kind: 'user', url: GREEK_HOLIDAYS_URL },
    name: 'Greek Bank Holidays',
    collapsed: false,
    order: 0,
    kind: 'holidays',
  };
  const usa: CalendarFeed = {
    id: 'user:usa-bank-holidays',
    source: { kind: 'user', url: USA_HOLIDAYS_URL },
    name: 'USA Bank Holidays',
    collapsed: false,
    order: 1,
    kind: 'holidays',
  };
  return {
    feeds: [greek, usa],
    refreshIntervalMs: 15 * 60 * 1000,
    schemaVersion: SCHEMA_VERSION,
    theme: resolveSystemTheme(),
    locale: 'en',
    dateFormat: 'YYYY-MM-DD',
    rules: [],
    cardShowDescription: false,
    cardShowLocation: true,
    timezone: 'local',
    timeFormat: '24h',
    pastMonths: 12,
    futureMonths: 24,
  };
}

function normalizeTheme(value: unknown): Theme {
  if (value === 'light' || value === 'dark') return value;
  return resolveSystemTheme();
}

function normalizeFeed(raw: unknown, fallbackOrder: number): CalendarFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.id !== 'string' || typeof f.name !== 'string') return null;
  if (!f.source || typeof f.source !== 'object') return null;
  const source = f.source as Record<string, unknown>;
  let normalizedSource: CalendarFeed['source'] | null = null;
  if (source.kind === 'user' && typeof source.url === 'string') {
    normalizedSource = { kind: 'user', url: source.url };
  } else if (source.kind === 'secret' && typeof source.id === 'string') {
    normalizedSource = { kind: 'secret', id: source.id };
  }
  if (!normalizedSource) return null;
  return {
    id: f.id,
    source: normalizedSource,
    name: f.name,
    collapsed: f.collapsed === true,
    order: typeof f.order === 'number' ? f.order : fallbackOrder,
    kind: f.kind === 'holidays' ? 'holidays' : 'events',
  };
}

function migrate(parsed: Record<string, unknown>): AppConfig {
  const base = defaultConfig();
  const rawFeeds = Array.isArray(parsed.feeds) ? parsed.feeds : [];
  const feeds: CalendarFeed[] = [];
  rawFeeds.forEach((f, i) => {
    const normalized = normalizeFeed(f, i);
    if (normalized) feeds.push(normalized);
  });
  const refreshIntervalMs =
    typeof parsed.refreshIntervalMs === 'number' ? parsed.refreshIntervalMs : base.refreshIntervalMs;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    feeds: feeds.length > 0 ? feeds : base.feeds,
    refreshIntervalMs,
    schemaVersion: SCHEMA_VERSION,
    theme: normalizeTheme(parsed.theme),
    locale: (parsed.locale as AppConfig['locale']) ?? base.locale,
    dateFormat: (parsed.dateFormat as AppConfig['dateFormat']) ?? base.dateFormat,
    rules: Array.isArray(parsed.rules) ? (parsed.rules as AppConfig['rules']) : base.rules,
    cardShowDescription:
      typeof parsed.cardShowDescription === 'boolean'
        ? parsed.cardShowDescription
        : base.cardShowDescription,
    cardShowLocation:
      typeof parsed.cardShowLocation === 'boolean'
        ? parsed.cardShowLocation
        : base.cardShowLocation,
    timezone: (parsed.timezone as AppConfig['timezone']) ?? base.timezone,
    timeFormat: parsed.timeFormat === '12h' ? '12h' : base.timeFormat,
    pastMonths: Math.max(0, Math.round(num(parsed.pastMonths, base.pastMonths))),
    futureMonths: Math.max(0, Math.round(num(parsed.futureMonths, base.futureMonths))),
  };
}

export function loadConfig(): AppConfig {
  if (typeof localStorage === 'undefined') return defaultConfig();
  const raw = localStorage.getItem(STORAGE_KEY);
  const legacy = raw ? null : localStorage.getItem('calendar-timeline:config:v1');
  const text = raw ?? legacy;
  if (!text) return defaultConfig();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return defaultConfig();
    return migrate(parsed as Record<string, unknown>);
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
  if (!Array.isArray(parsed.feeds)) throw new Error('Invalid feeds');
  const version = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0;
  if (version !== SCHEMA_VERSION && version !== 1 && version !== 2) {
    throw new Error('Unsupported schema version: ' + parsed.schemaVersion);
  }
  return migrate(parsed as Record<string, unknown>);
}
