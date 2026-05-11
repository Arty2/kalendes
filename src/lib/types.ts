export type FeedSource =
  | { kind: 'secret'; id: string }
  | { kind: 'user'; url: string };

export type FeedKind = 'events' | 'holidays';

export type FeedCategory = 'none' | 'holidays' | 'observances' | 'guests' | 'announcements';

export const FEED_CATEGORIES: FeedCategory[] = [
  'none', 'holidays', 'observances', 'guests', 'announcements',
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
};

export type StyleVariant =
  | 'none'
  | 'inverted-dashed'
  | 'inverted-strike'
  | 'hidden'
  | 'muted'
  | 'highlight';

export type DisplayEvent = ParsedEvent & {
  displayTitle: string;
  displayDescription: string;
  displayDescriptionSnippet: string;
  displayLocation: string;
  styleVariant: StyleVariant;
  hidden: boolean;
};

export type LaneEvent = DisplayEvent & {
  lane: number;
  leftPx: number;
  widthPx: number;
};

export type Zoom = 'month' | 'quarter' | 'half-year' | 'year' | '2-year';

export type Theme = 'light' | 'dark' | 'auto';

export type Locale = 'en' | 'el';

export type DateFormat = 'YYYY-MM-DD' | 'DD MMM YYYY' | 'DD.MM.YYYY' | 'MM/DD/YYYY';

export type TimeFormat = '24h' | '12h';

export type Timezone = 'local' | 'UTC' | 'Europe/Athens' | 'America/New_York';

export type FindReplaceRule = {
  id: string;
  find: string;
  replace: string;
  style: StyleVariant;
};

export type AppConfig = {
  feeds: CalendarFeed[];
  refreshIntervalMs: number;
  schemaVersion: number;
  theme: Theme;
  locale: Locale;
  dateFormat: DateFormat;
  rules: FindReplaceRule[];
  cardShowDescription: boolean;
  cardShowLocation: boolean;
  timezone: Timezone;
  timeFormat: TimeFormat;
  pastMonths: number;
  futureMonths: number;
};

export const SCHEMA_VERSION = 1;
