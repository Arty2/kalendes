export type FeedSource =
  | { kind: 'secret'; id: string }
  | { kind: 'user'; url: string }
  | { kind: 'scratchpad'; id?: string };

export const SCRATCHPAD_FEED_ID = 'scratchpad:default';

// Local lanes (the Draft and any imported .ics) share the 'scratchpad:' feed-id
// prefix and are stored in localStorage rather than synced from a URL.
export function isLocalFeedId(feedId: string): boolean {
  return feedId.startsWith('scratchpad:');
}

export type FeedKind = 'events' | 'holidays';

export type FeedCategory = 'none' | 'events' | 'holidays' | 'observances' | 'guests' | 'announcements';

export const FEED_CATEGORIES: FeedCategory[] = [
  'none', 'events', 'holidays', 'observances', 'announcements', 'guests',
];

export type Travel = 'none' | 'international' | 'local';

export const TRAVEL_OPTIONS: Travel[] = ['none', 'international', 'local'];

// Day-blocking hatch for a calendar/filter, independent of its Type:
//   'global' = full-width band spanning the header and every row
//   'local'  = hatch confined to the owning row
//   'none'   = N/A — unset, inherits (a filter leaves the calendar's block alone)
//   'off'    = No block — an explicit override that forces non-blocking, even
//              over a calendar's Global/Local block when a filter applies
export type Block = 'none' | 'global' | 'local' | 'off';

export const BLOCK_OPTIONS: Block[] = ['none', 'global', 'local', 'off'];

// Where a filter's Find anchors. 'any' matches a substring anywhere (the
// default, and the only mode that requires a non-empty Find); 'start'/'end'
// anchor to the ends and accept an empty Find so text can be inserted there.
export type MatchPosition = 'start' | 'any' | 'end';

export const MATCH_POSITIONS: MatchPosition[] = ['start', 'any', 'end'];

export type CalendarColor =
  | 'peach'
  | 'amber'
  | 'mint'
  | 'teal'
  | 'sky'
  | 'lavender';

export const CALENDAR_COLORS: CalendarColor[] = [
  'peach', 'amber', 'mint', 'teal', 'sky', 'lavender',
];

export type CalendarFeed = {
  id: string;
  source: FeedSource;
  name: string;
  collapsed: boolean;
  order: number;
  kind: FeedKind;
  category: FeedCategory;
  travel?: Travel;
  block?: Block;
  color?: CalendarColor;
  style?: StyleVariant;
  timezone?: string;
  hidden?: boolean;
};

export type ParsedEvent = {
  uid: string;
  feedId: string;
  title: string;
  description: string;
  descriptionSnippet: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  url?: string;
  category?: FeedCategory;
  // Per-event travel tag (local Draft/imported lanes); overrides the feed's.
  travel?: Travel;
};

// HTTP revalidation state for a fetched feed. Conditional requests are only
// valid while the recurrence-expansion range is unchanged (rangeKey), since a
// new range needs the full body to re-expand.
export type FeedValidators = {
  etag?: string;
  lastModified?: string;
  rangeKey: string;
};

export type StyleVariant =
  | 'none'
  | 'bold'
  | 'inverted'
  | 'dashed'
  | 'muted'
  | 'striked'
  | 'hidden';

export type DisplayEvent = ParsedEvent & {
  displayTitle: string;
  displayDescription: string;
  displayDescriptionSnippet: string;
  displayLocation: string;
  styleVariant: StyleVariant;
  hidden: boolean;
  ruleCategory: FeedCategory | null;
  ruleColor: CalendarColor | null;
  ruleBlock: Block | null;
  // Display-only: number of exact-duplicate events (same title + start + end)
  // this pill stands in for. Recomputed each render from parsed events, so it is
  // never persisted (storage/share) and needs no schema migration. 1/undefined
  // when unique; > 1 renders an ×N badge on the pill.
  dupCount?: number;
};

export type LaneEvent = DisplayEvent & {
  lane: number;
  leftPx: number;
  widthPx: number;
};

// 'week' is the 1W view: a deeply-zoomed mode (days as columns, hours
// horizontal, two timezone header rows, no per-feed lane rows). It is toggled
// separately and deliberately left out of the pinch/wheel zoom progression.
export type Zoom = 'month' | 'quarter' | 'half-year' | 'year' | '2-year' | 'week';

export type Theme = 'light' | 'dark' | 'auto';

export type Motion = 'auto' | 'reduced' | 'full';

// UI density. 'auto' is condensed on mobile, relaxed on desktop.
export type Spacing = 'auto' | 'condensed' | 'relaxed';

// Structural border weight. 'thin' is the default 1px; 'bold' thickens to 2px.
export type BorderWeight = 'thin' | 'bold';

// Feedback for taps/holds: 'auto' vibrates where supported (else a tap sound),
// 'sound' always plays the tap sound, 'vibration' vibrates only, 'off' neither.
export type Haptics = 'auto' | 'sound' | 'vibration' | 'both' | 'off';

export type FontSize = 10 | 12 | 14 | 16 | 18 | 20;

export type Locale = 'en' | 'el';

export type DateFormat = 'YYYY-MM-DD' | 'DD MMM YYYY' | 'DD.MM.YYYY' | 'MM/DD/YYYY';

export type TimeFormat = '24h' | '12h';

// 'local' resolves to the device timezone; any other value is an IANA zone id
// chosen from the shared picker list (TZ_PINNED / TZ_REST in format.ts).
export type Timezone = 'local' | (string & {});

// Global daylight-saving override: 'auto' follows each zone's real IANA rule;
// 'on'/'off' force each zone's own daylight/standard offset.
export type Dst = 'auto' | 'on' | 'off';

export type WeekStart = 'monday' | 'sunday';

export type FindReplaceRule = {
  id: string;
  find: string;
  replace: string;
  style: StyleVariant;
  category: FeedCategory;
  color?: CalendarColor;
  block?: Block;
  position?: MatchPosition;
  disabled?: boolean;
};

export type TrayFilter = {
  categories: FeedCategory[];
  travel: Array<Travel>;
};

export type AppConfig = {
  feeds: CalendarFeed[];
  refreshIntervalMs: number;
  schemaVersion: number;
  theme: Theme;
  motion: Motion;
  spacing: Spacing;
  borderWeight: BorderWeight;
  haptics: Haptics;
  fontSize: FontSize;
  locale: Locale;
  dateFormat: DateFormat;
  rules: FindReplaceRule[];
  cardShowDescription: boolean;
  cardShowLocation: boolean;
  timezone: Timezone;
  dst: Dst;
  timeFormat: TimeFormat;
  weekStart: WeekStart;
  // The two timezones shown as stacked header rows in the 1W week view (IANA
  // zone ids). Top row defaults to Athens, bottom row to US Eastern.
  weekTzTop: string;
  weekTzBottom: string;
  // Vertical zoom for the 1W hour grid: multiplies the base hour-row height.
  weekHourScale: number;
  pastMonths: number;
  futureMonths: number;
  morningLimit: string;
  eveningLimit: string;
  trayFilter: TrayFilter;
  kioskPin: string | null;
};

export const SCHEMA_VERSION = 1;

// Open/closed state of the settings panel's <details> sections. Device-local
// UI state persisted under its own key — deliberately outside AppConfig so it
// never rides share links or the schema version.
export const SETTINGS_SECTION_IDS = ['look', 'time', 'filters', 'calendars'] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsSections = Record<SettingsSectionId, boolean>;
