import type {
  AppConfig,
  CalendarColor,
  CalendarFeed,
  FeedCategory,
  FindReplaceRule,
  FontSize,
  Haptics,
  Motion,
  ParsedEvent,
  Spacing,
  StyleVariant,
  Theme,
  Travel,
} from './types';
import { CALENDAR_COLORS, FEED_CATEGORIES, SCHEMA_VERSION, SCRATCHPAD_FEED_ID, TRAVEL_OPTIONS } from './types';
import { offsetMinutes, resolveLocalTz } from './format';

const VALID_STYLES: StyleVariant[] = [
  'none', 'bold', 'inverted', 'dashed', 'muted', 'striked', 'hidden',
];

export const STORAGE_KEY = 'calendar-timeline:config';

export const GREEK_HOLIDAYS_URL =
  'https://calendar.google.com/calendar/ical/en.greek%23holiday%40group.v.calendar.google.com/public/basic.ics';
export const USA_HOLIDAYS_URL =
  'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics';

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

export const DEFAULT_RULES: FindReplaceRule[] = [
  { id: 'default-tbd', find: 'TBD', replace: 'TBD', style: 'dashed', category: 'none' },
  { id: 'default-tbc', find: 'TBC', replace: 'TBC', style: 'dashed', category: 'none' },
  { id: 'default-canceled', find: 'CANCELED', replace: 'CANCELED', style: 'striked', category: 'none' },
  { id: 'default-observance', find: 'Observance', replace: 'Observance', style: 'dashed', category: 'observances' },
];

export const DEFAULT_RULE_IDS: ReadonlySet<string> = new Set(DEFAULT_RULES.map((r) => r.id));

function hoursFrom(tz: string): number {
  return ((offsetMinutes(resolveLocalTz()) ?? 0) - (offsetMinutes(tz) ?? 0)) / 60;
}

export type HolidayPrimary = 'greek' | 'usa';

export function defaultPrimaryHoliday(): HolidayPrimary {
  const athens = Math.abs(hoursFrom('Europe/Athens'));
  if (athens <= 1) return 'greek';
  const newYork = Math.abs(hoursFrom('America/New_York'));
  if (newYork <= 2) return 'usa';
  return 'greek';
}

export function scratchpadFeed(order: number): CalendarFeed {
  return {
    id: SCRATCHPAD_FEED_ID,
    source: { kind: 'scratchpad' },
    name: 'Draft',
    collapsed: false,
    order,
    kind: 'events',
    category: 'none',
    hidden: true,
  };
}

export function defaultConfig(): AppConfig {
  const primary = defaultPrimaryHoliday();
  const greekIsPrimary = primary === 'greek';
  const greek: CalendarFeed = {
    id: 'user:greek-bank-holidays',
    source: { kind: 'user', url: GREEK_HOLIDAYS_URL },
    name: 'Greek Public Holidays',
    collapsed: false,
    order: greekIsPrimary ? 0 : 1,
    kind: greekIsPrimary ? 'holidays' : 'events',
    category: greekIsPrimary ? 'holidays' : 'observances',
  };
  const usa: CalendarFeed = {
    id: 'user:usa-bank-holidays',
    source: { kind: 'user', url: USA_HOLIDAYS_URL },
    name: 'USA Public Holidays',
    collapsed: false,
    order: greekIsPrimary ? 1 : 0,
    kind: greekIsPrimary ? 'events' : 'holidays',
    category: greekIsPrimary ? 'observances' : 'holidays',
  };
  return {
    feeds: [greek, usa, scratchpadFeed(2)],
    refreshIntervalMs: 60 * 60 * 1000,
    schemaVersion: SCHEMA_VERSION,
    theme: 'auto',
    motion: 'auto',
    spacing: 'auto',
    borderWeight: 'thin',
    haptics: 'auto',
    fontSize: 14,
    locale: 'en',
    dateFormat: 'YYYY-MM-DD',
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
    cardShowDescription: false,
    cardShowLocation: true,
    timezone: 'local',
    dst: 'auto',
    timeFormat: '24h',
    weekStart: 'monday',
    pastMonths: 12,
    futureMonths: 24,
    morningLimit: '07:30',
    eveningLimit: '20:30',
    trayFilter: {
      categories: ['none', 'events', 'holidays', 'announcements'],
      travel: ['none', 'local', 'international'],
    },
    kioskPin: null,
  };
}

function normalizeTheme(value: unknown): Theme {
  if (value === 'light' || value === 'dark' || value === 'auto') return value;
  return 'auto';
}

function normalizeMotion(value: unknown): Motion {
  if (value === 'auto' || value === 'reduced' || value === 'full') return value;
  return 'auto';
}

function normalizeSpacing(value: unknown): Spacing {
  if (value === 'auto' || value === 'condensed' || value === 'relaxed') return value;
  return 'auto';
}

function normalizeHaptics(value: unknown): Haptics {
  if (
    value === 'auto' ||
    value === 'sound' ||
    value === 'vibration' ||
    value === 'both' ||
    value === 'off'
  ) {
    return value;
  }
  return 'auto';
}

function normalizeFontSize(value: unknown): FontSize {
  if (value === 10 || value === 12 || value === 14 || value === 16 || value === 18 || value === 20) {
    return value;
  }
  return 14;
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
  } else if (source.kind === 'scratchpad') {
    normalizedSource = { kind: 'scratchpad', id: typeof source.id === 'string' ? source.id : 'default' };
  }
  if (!normalizedSource) return null;
  // Only the built-in Draft lane has a fixed name; imported local lanes keep theirs.
  const isDraftLane =
    normalizedSource.kind === 'scratchpad' && (normalizedSource.id ?? 'default') === 'default';
  const color: CalendarColor | undefined =
    typeof f.color === 'string' && (CALENDAR_COLORS as string[]).includes(f.color)
      ? (f.color as CalendarColor)
      : undefined;
  const style: StyleVariant | undefined =
    typeof f.style === 'string' && (VALID_STYLES as string[]).includes(f.style)
      ? (f.style as StyleVariant)
      : undefined;
  const kind: 'events' | 'holidays' = f.kind === 'holidays' ? 'holidays' : 'events';
  const travel: Travel | undefined =
    typeof f.travel === 'string' && (TRAVEL_OPTIONS as string[]).includes(f.travel)
      ? (f.travel as Travel)
      : undefined;
  const category: FeedCategory =
    typeof f.category === 'string' && (FEED_CATEGORIES as string[]).includes(f.category)
      ? (f.category as FeedCategory)
      : kind === 'holidays'
        ? 'holidays'
        : 'none';
  const timezone =
    typeof f.timezone === 'string' && f.timezone.trim().length > 0
      ? f.timezone.trim()
      : undefined;
  return {
    id: f.id,
    source: normalizedSource,
    // The Draft (scratchpad) feed is a system feed with a fixed name; coerce
    // the legacy "Scratchpad" name to "Draft". Imported local lanes keep theirs.
    name: isDraftLane ? 'Draft' : f.name,
    collapsed: f.collapsed === true,
    order: typeof f.order === 'number' ? f.order : fallbackOrder,
    kind: category === 'holidays' ? 'holidays' : 'events',
    category,
    ...(travel && travel !== 'none' ? { travel } : {}),
    ...(color ? { color } : {}),
    ...(style ? { style } : {}),
    ...(timezone ? { timezone } : {}),
    ...(f.hidden === true ? { hidden: true } : {}),
  };
}

function normalizeRule(r: FindReplaceRule): FindReplaceRule {
  const style: StyleVariant =
    typeof r.style === 'string' && (VALID_STYLES as string[]).includes(r.style)
      ? r.style
      : 'none';
  const category: FeedCategory =
    typeof r.category === 'string' && (FEED_CATEGORIES as string[]).includes(r.category)
      ? r.category
      : 'none';
  return { ...r, style, category };
}

function mergeDefaultRules(userRules: FindReplaceRule[]): FindReplaceRule[] {
  const byId = new Map<string, FindReplaceRule>();
  for (const r of userRules) {
    if (r && typeof r.id === 'string') byId.set(r.id, normalizeRule(r));
  }
  for (const def of DEFAULT_RULES) {
    byId.set(def.id, { ...def });
  }
  const result: FindReplaceRule[] = [];
  const seen = new Set<string>();
  for (const r of userRules) {
    if (!r || typeof r.id !== 'string') continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    result.push(byId.get(r.id) ?? r);
  }
  for (const def of DEFAULT_RULES) {
    if (!seen.has(def.id)) {
      seen.add(def.id);
      result.push(byId.get(def.id) ?? { ...def });
    }
  }
  return result;
}

function normalizeDateFormat(value: unknown): AppConfig['dateFormat'] {
  if (value === 'YYYY-MM-DD' || value === 'DD MMM YYYY' || value === 'DD.MM.YYYY' || value === 'MM/DD/YYYY') {
    return value;
  }
  return 'YYYY-MM-DD';
}

function migrate(parsed: Record<string, unknown>): AppConfig {
  const base = defaultConfig();
  const rawFeeds = Array.isArray(parsed.feeds) ? parsed.feeds : [];
  const feeds: CalendarFeed[] = [];
  rawFeeds.forEach((f, i) => {
    const normalized = normalizeFeed(f, i);
    if (normalized) feeds.push(normalized);
  });
  if (feeds.length > 0 && !feeds.some((f) => f.id === SCRATCHPAD_FEED_ID)) {
    feeds.push(scratchpadFeed(feeds.length));
  }
  const refreshIntervalMs = snapRefreshInterval(
    typeof parsed.refreshIntervalMs === 'number' ? parsed.refreshIntervalMs : base.refreshIntervalMs,
  );
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const rawRules = Array.isArray(parsed.rules) ? (parsed.rules as FindReplaceRule[]) : [];
  return {
    feeds: feeds.length > 0 ? feeds : base.feeds,
    refreshIntervalMs,
    schemaVersion: SCHEMA_VERSION,
    theme: normalizeTheme(parsed.theme),
    motion: normalizeMotion(parsed.motion),
    spacing: normalizeSpacing(parsed.spacing),
    borderWeight: parsed.borderWeight === 'bold' ? 'bold' : base.borderWeight,
    haptics: normalizeHaptics(parsed.haptics ?? parsed.baptism),
    fontSize: normalizeFontSize(parsed.fontSize),
    locale: (parsed.locale as AppConfig['locale']) ?? base.locale,
    dateFormat: normalizeDateFormat(parsed.dateFormat),
    rules: mergeDefaultRules(rawRules),
    cardShowDescription:
      typeof parsed.cardShowDescription === 'boolean'
        ? parsed.cardShowDescription
        : base.cardShowDescription,
    cardShowLocation:
      typeof parsed.cardShowLocation === 'boolean'
        ? parsed.cardShowLocation
        : base.cardShowLocation,
    timezone: (parsed.timezone as AppConfig['timezone']) ?? base.timezone,
    dst: parsed.dst === 'on' || parsed.dst === 'off' ? parsed.dst : base.dst,
    timeFormat: parsed.timeFormat === '12h' ? '12h' : base.timeFormat,
    weekStart: parsed.weekStart === 'sunday' ? 'sunday' : base.weekStart,
    pastMonths: Math.max(0, Math.round(num(parsed.pastMonths, base.pastMonths))),
    futureMonths: Math.max(0, Math.round(num(parsed.futureMonths, base.futureMonths))),
    morningLimit: typeof parsed.morningLimit === 'string' ? parsed.morningLimit : '',
    eveningLimit: typeof parsed.eveningLimit === 'string' ? parsed.eveningLimit : '',
    trayFilter: (() => {
      const raw = parsed.trayFilter as AppConfig['trayFilter'] | undefined;
      const validCats: FeedCategory[] = ['none', 'events', 'holidays', 'observances', 'guests', 'announcements'];
      const validTravel: Travel[] = ['none', 'local', 'international'];
      let cats = Array.isArray(raw?.categories)
        ? (raw.categories as string[]).filter(c => validCats.includes(c as FeedCategory)) as FeedCategory[]
        : base.trayFilter.categories;
      // 'events' is a new category — add it for existing users who had a saved filter
      if (raw?.categories && !cats.includes('events')) cats = [...cats, 'events'];
      let travel = Array.isArray(raw?.travel)
        ? (raw.travel as string[]).filter(t => validTravel.includes(t as Travel)) as Travel[]
        : base.trayFilter.travel;
      // 'none' is newly filterable — add it for existing users
      if (raw?.travel && !travel.includes('none')) travel = [...travel, 'none'];
      return { categories: cats, travel };
    })(),
    kioskPin:
      typeof parsed.kioskPin === 'string' && /^\d{4}$/.test(parsed.kioskPin)
        ? parsed.kioskPin
        : null,
  };
}

export function loadConfig(): AppConfig {
  if (typeof localStorage === 'undefined') return defaultConfig();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultConfig();
  try {
    const parsed = JSON.parse(raw);
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

export const EVENTS_CACHE_KEY = 'calendar-timeline:events';

type SerializedEvent = {
  uid: string;
  feedId: string;
  title: string;
  description: string;
  descriptionSnippet: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  url?: string;
};

// Serializing every event to JSON is synchronous and can block for tens of ms
// on slow devices. Coalesce bursts of refresh writes into a single trailing
// write, with a flush on page hide so nothing is lost on close.
type CachePayload = {
  byFeed: Record<string, ParsedEvent[]>;
  tzByFeed: Record<string, string>;
  lastSuccessAt: Record<string, number>;
  // Per-feed retrieval error messages, persisted so a failed feed's error stays
  // visible across reloads — notably while offline, where the fetch that would
  // re-create the error is skipped.
  feedErrors: Record<string, string>;
};
let pendingCache: CachePayload | null = null;
let cacheTimer: ReturnType<typeof setTimeout> | null = null;

export function saveEventsCache(
  byFeed: Record<string, ParsedEvent[]>,
  tzByFeed: Record<string, string>,
  lastSuccessAt: Record<string, number>,
  feedErrors: Record<string, string>,
): void {
  if (typeof localStorage === 'undefined') return;
  pendingCache = { byFeed, tzByFeed, lastSuccessAt, feedErrors };
  if (cacheTimer) return;
  cacheTimer = setTimeout(flushEventsCache, 1000);
}

export function flushEventsCache(): void {
  if (cacheTimer) {
    clearTimeout(cacheTimer);
    cacheTimer = null;
  }
  if (!pendingCache) return;
  const { byFeed, tzByFeed, lastSuccessAt, feedErrors } = pendingCache;
  pendingCache = null;
  writeEventsCache(byFeed, tzByFeed, lastSuccessAt, feedErrors);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushEventsCache);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEventsCache();
  });
}

function serializeEventsCache(
  byFeed: Record<string, ParsedEvent[]>,
  tzByFeed: Record<string, string>,
  lastSuccessAt: Record<string, number>,
  feedErrors: Record<string, string>,
): string {
  return JSON.stringify({
    byFeed: Object.fromEntries(
      Object.entries(byFeed)
        // Local lanes (Draft + imported .ics) persist via the scratchpad store,
        // not this network-feed cache; skip them to avoid stale duplicates.
        .filter(([id]) => !id.startsWith('scratchpad:'))
        .map(([id, evts]) => [
        id,
        evts.map((e): SerializedEvent => ({
          uid: e.uid,
          feedId: e.feedId,
          title: e.title,
          description: e.description,
          descriptionSnippet: e.descriptionSnippet,
          location: e.location,
          start: e.start.toISOString(),
          end: e.end.toISOString(),
          allDay: e.allDay,
          ...(e.url ? { url: e.url } : {}),
        })),
      ]),
    ),
    tzByFeed: { ...tzByFeed },
    lastSuccessAt: { ...lastSuccessAt },
    feedErrors: { ...feedErrors },
  });
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    // Spec name, Firefox's legacy name, and the legacy numeric code (22).
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22)
  );
}

// The least-recently-refreshed cacheable feed — the first to evict when the
// store is full. Scratchpad lanes aren't in this cache, so they're never picked;
// a feed with no recorded success is treated as oldest.
function oldestCacheableFeedId(
  byFeed: Record<string, ParsedEvent[]>,
  lastSuccessAt: Record<string, number>,
): string | null {
  let oldestId: string | null = null;
  let oldestTs = Infinity;
  for (const id of Object.keys(byFeed)) {
    if (id.startsWith('scratchpad:')) continue;
    const ts = lastSuccessAt[id] ?? 0;
    if (ts < oldestTs) {
      oldestTs = ts;
      oldestId = id;
    }
  }
  return oldestId;
}

function writeEventsCache(
  byFeed: Record<string, ParsedEvent[]>,
  tzByFeed: Record<string, string>,
  lastSuccessAt: Record<string, number>,
  feedErrors: Record<string, string>,
): void {
  if (typeof localStorage === 'undefined') return;
  // Work on a shallow copy so eviction never mutates live app state. On a full
  // store, drop the least-recently-refreshed feed and retry, so the freshest
  // calendars stay cached rather than the whole write failing. The retry count
  // is bounded by the feed count, so a persistently failing store can't spin.
  let feeds = byFeed;
  let errors = feedErrors;
  for (;;) {
    try {
      localStorage.setItem(
        EVENTS_CACHE_KEY,
        serializeEventsCache(feeds, tzByFeed, lastSuccessAt, errors),
      );
      return;
    } catch (err) {
      if (!isQuotaError(err)) return; // unavailable or other error — give up quietly
      const evictId = oldestCacheableFeedId(feeds, lastSuccessAt);
      if (!evictId) return; // nothing left to drop
      const { [evictId]: _dropped, ...rest } = feeds;
      feeds = rest;
      // Drop the evicted feed's error too, so the cache stays internally
      // consistent (no error for a feed whose events are no longer cached).
      const { [evictId]: _droppedErr, ...restErrors } = errors;
      errors = restErrors;
    }
  }
}

export function loadEventsCache(): {
  byFeed: Record<string, ParsedEvent[]>;
  tzByFeed: Record<string, string>;
  lastSuccessAt: Record<string, number>;
  feedErrors: Record<string, string>;
} | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(EVENTS_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      byFeed?: Record<string, SerializedEvent[]>;
      tzByFeed?: Record<string, string>;
      lastSuccessAt?: Record<string, number>;
      feedErrors?: Record<string, string>;
    };
    if (!parsed || typeof parsed !== 'object') return null;
    const byFeed: Record<string, ParsedEvent[]> = {};
    for (const [feedId, evts] of Object.entries(parsed.byFeed ?? {})) {
      if (!Array.isArray(evts)) continue;
      // Local lanes load from the scratchpad store, never this cache; ignore any
      // stale scratchpad entries left by older versions.
      if (feedId.startsWith('scratchpad:')) continue;
      byFeed[feedId] = evts.map((e) => ({
        uid: String(e.uid ?? ''),
        feedId: String(e.feedId ?? feedId),
        title: String(e.title ?? ''),
        description: String(e.description ?? ''),
        descriptionSnippet: String(e.descriptionSnippet ?? ''),
        location: String(e.location ?? ''),
        start: new Date(e.start),
        end: new Date(e.end),
        allDay: Boolean(e.allDay),
        ...(e.url ? { url: String(e.url) } : {}),
      }));
    }
    return {
      byFeed,
      tzByFeed:
        typeof parsed.tzByFeed === 'object' && parsed.tzByFeed !== null
          ? (parsed.tzByFeed as Record<string, string>)
          : {},
      lastSuccessAt:
        typeof parsed.lastSuccessAt === 'object' && parsed.lastSuccessAt !== null
          ? (parsed.lastSuccessAt as Record<string, number>)
          : {},
      // Default to {} for caches written before feedErrors existed.
      feedErrors:
        typeof parsed.feedErrors === 'object' && parsed.feedErrors !== null
          ? (parsed.feedErrors as Record<string, string>)
          : {},
    };
  } catch {
    return null;
  }
}

export function exportConfig(config: AppConfig): string {
  return JSON.stringify(config, null, 2);
}

export function importConfig(json: string): AppConfig {
  const parsed = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid config');
  if (!Array.isArray(parsed.feeds)) throw new Error('Invalid feeds');
  const version = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0;
  if (version !== SCHEMA_VERSION) {
    throw new Error('Unsupported schema version: ' + parsed.schemaVersion);
  }
  return migrate(parsed as Record<string, unknown>);
}
