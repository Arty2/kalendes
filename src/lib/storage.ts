import type { AppConfig, CalendarColor, CalendarFeed, FeedCategory, StyleVariant, Theme } from './types';
import { CALENDAR_COLORS, FEED_CATEGORIES, SCHEMA_VERSION } from './types';

const VALID_STYLES: StyleVariant[] = [
  'none', 'inverted-dashed', 'inverted-strike', 'hidden', 'muted', 'highlight',
];

export const STORAGE_KEY = 'calendar-timeline:config';

export const GREEK_HOLIDAYS_URL =
  'https://calendar.google.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/public/basic.ics';
export const USA_HOLIDAYS_URL =
  'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics';

const GREEK_HOLIDAYS_LEGACY_URLS = new Set<string>([
  'https://www.officeholidays.com/ics/greece',
  'https://www.officeholidays.com/ics-clean/greece',
]);

export const REFRESH_INTERVAL_OPTIONS = [
  30 * 60 * 1000,
  60 * 60 * 1000,
  240 * 60 * 1000,
] as const;

export function snapRefreshInterval(ms: number): number {
  let best = REFRESH_INTERVAL_OPTIONS[0];
  let bestDelta = Math.abs(ms - best);
  for (const v of REFRESH_INTERVAL_OPTIONS) {
    const d = Math.abs(ms - v);
    if (d < bestDelta) { best = v; bestDelta = d; }
  }
  return best;
}

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
    category: 'holidays',
  };
  const usa: CalendarFeed = {
    id: 'user:usa-bank-holidays',
    source: { kind: 'user', url: USA_HOLIDAYS_URL },
    name: 'USA Bank Holidays',
    collapsed: false,
    order: 1,
    kind: 'holidays',
    category: 'holidays',
  };
  return {
    feeds: [greek, usa],
    refreshIntervalMs: 60 * 60 * 1000,
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

const USA_HOLIDAYS_LEGACY_URLS = new Set<string>([
  'https://www.apple.com/calendar/ical/USHolidays.ics',
  'https://www.officeholidays.com/ics/usa',
]);

function normalizeFeed(raw: unknown, fallbackOrder: number): CalendarFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.id !== 'string' || typeof f.name !== 'string') return null;
  if (!f.source || typeof f.source !== 'object') return null;
  const source = f.source as Record<string, unknown>;
  let normalizedSource: CalendarFeed['source'] | null = null;
  if (source.kind === 'user' && typeof source.url === 'string') {
    let url = source.url;
    if (USA_HOLIDAYS_LEGACY_URLS.has(url)) url = USA_HOLIDAYS_URL;
    else if (GREEK_HOLIDAYS_LEGACY_URLS.has(url)) url = GREEK_HOLIDAYS_URL;
    normalizedSource = { kind: 'user', url };
  } else if (source.kind === 'secret' && typeof source.id === 'string') {
    normalizedSource = { kind: 'secret', id: source.id };
  }
  if (!normalizedSource) return null;
  const color: CalendarColor | undefined =
    typeof f.color === 'string' && (CALENDAR_COLORS as string[]).includes(f.color)
      ? (f.color as CalendarColor)
      : undefined;
  const style: StyleVariant | undefined =
    typeof f.style === 'string' && (VALID_STYLES as string[]).includes(f.style)
      ? (f.style as StyleVariant)
      : undefined;
  const kind: 'events' | 'holidays' = f.kind === 'holidays' ? 'holidays' : 'events';
  let category: FeedCategory;
  if (typeof f.category === 'string' && (FEED_CATEGORIES as string[]).includes(f.category)) {
    category = f.category as FeedCategory;
  } else {
    category = kind === 'holidays' ? 'holidays' : 'none';
  }
  const timezone =
    typeof f.timezone === 'string' && f.timezone.trim().length > 0
      ? f.timezone.trim()
      : undefined;
  return {
    id: f.id,
    source: normalizedSource,
    name: f.name,
    collapsed: f.collapsed === true,
    order: typeof f.order === 'number' ? f.order : fallbackOrder,
    kind: category === 'holidays' ? 'holidays' : 'events',
    category,
    ...(color ? { color } : {}),
    ...(style ? { style } : {}),
    ...(timezone ? { timezone } : {}),
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
  const refreshIntervalMs = snapRefreshInterval(
    typeof parsed.refreshIntervalMs === 'number' ? parsed.refreshIntervalMs : base.refreshIntervalMs,
  );
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
  if (
    version !== SCHEMA_VERSION &&
    version !== 1 &&
    version !== 2 &&
    version !== 3 &&
    version !== 4 &&
    version !== 5
  ) {
    throw new Error('Unsupported schema version: ' + parsed.schemaVersion);
  }
  return migrate(parsed as Record<string, unknown>);
}
