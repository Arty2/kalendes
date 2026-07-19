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
  | 'lavender'
  | 'grey';

export const CALENDAR_COLORS: CalendarColor[] = [
  'peach', 'amber', 'mint', 'teal', 'sky', 'lavender', 'grey',
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
  // Renders exactly like the default pill, but — unlike 'none' (which means
  // "inherit") — it is an explicit value, so a filter set to Outline forces the
  // default look over a calendar's own style (mirrors Block's 'off').
  | 'outline'
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
  // Display-only: number of consecutive calendar days this pill spans when a run
  // of same-title/same-time daily instances has been merged into one continuous
  // bar (see mergeConsecutiveDays). Like dupCount it is recomputed each render
  // and never persisted, so it needs no schema migration. Undefined/1 for a
  // normal pill; > 1 renders an ×N badge and a "N days" duration.
  spanDays?: number;
  // Display-only: when a merged consecutive-day run's members differ in start
  // (or end) clock time — within the merge tolerance — these hold the run's two
  // extreme start/end instants (earliest-time, latest-time), so the pill can
  // show a range like "10:00/10:30 — 15:00/16:00". Undefined when every member
  // shares the same start/end time (then the single time is shown, no slash).
  spanStartRange?: [Date, Date];
  spanEndRange?: [Date, Date];
  // Display-only: the individual per-day events a merged consecutive-day run
  // stands in for, in day order, so the event modal can show one real day at a
  // time (with its own unaltered times) and page between them. Never persisted.
  spanMembers?: DisplayEvent[];
};

export type LaneEvent = DisplayEvent & {
  lane: number;
  leftPx: number;
  widthPx: number;
  // Display-only: horizontal room (px) from this pill's left edge to the next
  // pill in the same lane — the space its label may occupy before it would
  // smear over the neighbour. Undefined for the last pill in a lane (unbounded).
  // Recomputed by assignLanes each render, never persisted.
  labelRoomPx?: number;
};

// 'week' is the 1W view: a deeply-zoomed mode (days as columns, hours
// horizontal, two timezone header rows, no per-feed lane rows). It is toggled
// separately and deliberately left out of the pinch/wheel zoom progression.
export type Zoom = 'month' | 'quarter' | 'half-year' | 'year' | '2-year' | 'week';

// The pinch/wheel zoom progression, and the toolbar's zoom-button order.
// Shared so the button row and the gesture stepping can never diverge.
export const ZOOM_ORDER: readonly Zoom[] = ['month', 'quarter', 'half-year', 'year', '2-year'];

// Light/dark control (UI label "Scheme"). Orthogonal to Palette below: the
// resolved scheme drives data-scheme, which selects each palette's light or
// dark token set.
export type Scheme = 'light' | 'dark' | 'auto';

// Colour palette (UI label "Flavor"). Varies only --paper-color/--ink-color/--accent-color; every
// other token is inherited from the Pepper (base) scheme. 'pepper' is the default
// black-on-white look. See styles/global.css :root[data-palette=...] rules.
export type Palette = 'pepper' | 'juniper' | 'bergamot' | 'rose' | 'cinnamon' | 'sage';

export const PALETTES: readonly Palette[] = [
  'pepper', 'juniper', 'bergamot', 'rose', 'cinnamon', 'sage',
];

export type Motion = 'auto' | 'reduced' | 'full';

// UI density. 'auto' is condensed on mobile, relaxed on desktop.
export type Spacing = 'auto' | 'condensed' | 'relaxed';

// Where the events tray sits. 'auto' slides in from the left on desktop and up
// from the bottom on mobile; 'bottom'/'left' force one side regardless of device.
export type TraySide = 'auto' | 'bottom' | 'left';

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
  // Light/dark control (UI "Scheme"); `palette` is the colour theme (UI "Theme").
  scheme: Scheme;
  palette: Palette;
  motion: Motion;
  spacing: Spacing;
  traySide: TraySide;
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
  // Secondary timezone (IANA zone id, no 'local' sentinel): the 1W week view's
  // right hour column. The primary `timezone` drives the left column and the
  // grid layout; when the two resolve to the same zone only one column shows.
  timezone2: string;
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
