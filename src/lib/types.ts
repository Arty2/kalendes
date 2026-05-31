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
};

export type LaneEvent = DisplayEvent & {
  lane: number;
  leftPx: number;
  widthPx: number;
};

export type Zoom = 'month' | 'quarter' | 'half-year' | 'year' | '2-year';

export type Theme = 'light' | 'dark' | 'auto';

export type Motion = 'auto' | 'reduced' | 'full';

// Feedback for taps/holds: 'auto' vibrates where supported (else a tap sound),
// 'sound' always plays the tap sound, 'vibration' vibrates only, 'off' neither.
export type Haptics = 'auto' | 'sound' | 'vibration' | 'both' | 'off';

export type FontSize = 10 | 12 | 14 | 16 | 18 | 20;

export type Locale = 'en' | 'el';

export type DateFormat = 'YYYY-MM-DD' | 'DD MMM YYYY' | 'DD.MM.YYYY' | 'MM/DD/YYYY';

export type TimeFormat = '24h' | '12h';

export type Timezone = 'local' | 'UTC' | 'Europe/Athens' | 'America/New_York';

export type WeekStart = 'monday' | 'sunday';

export type FindReplaceRule = {
  id: string;
  find: string;
  replace: string;
  style: StyleVariant;
  category: FeedCategory;
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
  haptics: Haptics;
  fontSize: FontSize;
  locale: Locale;
  dateFormat: DateFormat;
  rules: FindReplaceRule[];
  cardShowDescription: boolean;
  cardShowLocation: boolean;
  timezone: Timezone;
  timeFormat: TimeFormat;
  weekStart: WeekStart;
  pastMonths: number;
  futureMonths: number;
  morningLimit: string;
  eveningLimit: string;
  trayFilter: TrayFilter;
  kioskPin: string | null;
};

export const SCHEMA_VERSION = 1;
