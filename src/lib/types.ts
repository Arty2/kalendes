export type FeedSource =
  | { kind: 'secret'; id: string }
  | { kind: 'user'; url: string }
  | { kind: 'static'; path: string };

export type CalendarFeed = {
  id: string;
  source: FeedSource;
  name: string;
  collapsed: boolean;
  order: number;
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

export type LaneEvent = ParsedEvent & {
  lane: number;
  leftPx: number;
  widthPx: number;
};

export type Zoom = 'month' | 'quarter' | 'half-year' | 'year';

export type AppConfig = {
  feeds: CalendarFeed[];
  refreshIntervalMs: number;
  schemaVersion: number;
};

export const SCHEMA_VERSION = 1;
