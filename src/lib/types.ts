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

// Event type (UI label "Type"). 'travel-local' / 'travel-international' are the
// former standalone "Travel" tags, folded back in as ordinary types (there is no
// travel "N/A" — an untagged event is just 'none'/Auto).
export type FeedCategory =
  | 'none'
  | 'events'
  | 'holidays'
  | 'observances'
  | 'operations'
  | 'guests'
  | 'announcements'
  | 'travel-local'
  | 'travel-international';

export const FEED_CATEGORIES: FeedCategory[] = [
  'none', 'events', 'holidays', 'observances', 'operations', 'announcements', 'guests',
  'travel-local', 'travel-international',
];

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
  block?: Block;
  color?: CalendarColor;
  style?: StyleVariant;
  timezone?: string;
  hidden?: boolean;
  // Split the row into one band of lanes per event location. Absent = packed.
  subLanes?: SubLanes;
};

// How a calendar's row splits into lanes: 'none' packs every event together,
// 'location' gives each location its own band. Only 'location' is stored.
export const SUB_LANE_OPTIONS = ['none', 'location'] as const;
export type SubLanes = (typeof SUB_LANE_OPTIONS)[number];

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
  // STATUS:CANCELLED — drawn struck through (unless a filter styles it) and
  // never blocks a day.
  cancelled?: boolean;
  // Local lanes only: the iCal revision, bumped on every edit so a re-exported
  // .ics updates the copy another calendar app imported instead of duplicating
  // it (SEQUENCE / LAST-MODIFIED). Absent = never edited (sequence 0).
  sequence?: number;
  lastModified?: Date;
  // Local lanes only: a repeating series, stored once as its first occurrence.
  // rrule is the RFC 5545 RRULE value ("FREQ=WEEKLY;BYDAY=MO"), exdates the
  // starts of skipped occurrences, tzid the zone whose wall clock a timed
  // series repeats on. Expanded for display by recurrence.ts.
  rrule?: string;
  exdates?: Date[];
  tzid?: string;
  // Display-only: on an expanded occurrence (uid `seriesUid#r<startMs>`), the
  // uid of the series it came from. Never stored.
  seriesUid?: string;
};

// HTTP revalidation state for a fetched feed. Conditional requests are only
// valid while the recurrence-expansion range is unchanged (rangeKey), since a
// new range needs the full body to re-expand.
export type FeedValidators = {
  etag?: string;
  lastModified?: string;
  // SHA-256 of the last parsed body (DTSTAMP lines dropped), for servers that
  // send no ETag/Last-Modified: an identical body skips the parse.
  bodyHash?: string;
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
  // Display-only: the individual events an exact-duplicate group (same title +
  // start + end, typically the same event carried by several calendar feeds)
  // was collapsed into — in first-occurrence order, including the representative
  // itself. Lets the event modal page between the combined copies (each feed's
  // own version). Set only when dupCount > 1; recomputed each render, never
  // persisted (see dedupeDisplayEvents).
  dupMembers?: DisplayEvent[];
  // Display-only: whether any active find/replace rule (filter) matched this
  // event. Computed once in decorate() while it already walks the rules, so the
  // pill can show its filter dot without re-scanning every rule per render.
  // Recomputed each render, never persisted (see decorate / matchingRulesFor).
  matchedFilter?: boolean;
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

// A locked kiosk's home view, read when the lock begins (kiosk-idle.ts). Kept
// in sessionStorage, never in config or share links.
export type KioskHome = {
  pin: string;
  zoom: Zoom;
  lastNonWeek: Zoom;
  markerMs: number | null;
  markerEndMs: number | null;
  collapsed: Record<string, boolean>;
};

// What actually reaches the data-scheme attribute. 'auto' and 'shake' are modes,
// not values — they resolve to one of these before hitting the DOM.
export type ResolvedScheme = 'light' | 'dark';

// Light/dark control (UI label "Scheme"). Orthogonal to Palette below: the
// resolved scheme drives data-scheme, which selects each palette's light or
// dark token set. 'auto' follows the OS; 'shake' picks at random, re-rolled on
// launch and whenever the device is shaken (see rollShake in state.svelte.ts).
export type Scheme = ResolvedScheme | 'auto' | 'shake';

export const RESOLVED_SCHEMES: readonly ResolvedScheme[] = ['light', 'dark'];

// Every value the Scheme field may hold. Shared by storage/share/url validation
// so the three lists can't drift apart.
export const SCHEMES: readonly Scheme[] = ['light', 'dark', 'auto', 'shake'];

// A real colour palette. Varies only --paper-color/--ink-color/--accent-color; every
// other token is inherited from the Pepper (base) scheme. 'pepper' is the default
// black-on-white look. See styles/global.css :root[data-palette=...] rules.
export type PaletteFlavor = 'pepper' | 'juniper' | 'bergamot' | 'rose' | 'cinnamon' | 'sage';

// The Flavor field (UI label "Flavor"). 'auto' and 'shake' are modes rather than
// colours — both resolve to one of the flavors above, so neither may ever reach
// data-palette. 'auto' follows whatever the app calls its default, so changing
// DEFAULT_PALETTE_FLAVOR moves everyone who hasn't picked a flavor by hand.
export type Palette = PaletteFlavor | 'auto' | 'shake';

export const PALETTE_FLAVORS: readonly PaletteFlavor[] = [
  'pepper', 'juniper', 'bergamot', 'rose', 'cinnamon', 'sage',
];

// The one place the default flavor is named. What 'auto' resolves to.
export const DEFAULT_PALETTE_FLAVOR: PaletteFlavor = 'pepper';

// Every value the Flavor field may hold — the validation list, as distinct from
// PALETTE_FLAVORS, which is what a random roll draws from.
export const PALETTES: readonly Palette[] = [...PALETTE_FLAVORS, 'auto', 'shake'];

// Whether an appearance mode is worth putting in a URL or a share link. 'shake'
// is a device-local plaything, not a preference: it means nothing on a machine
// that can't be shaken, and a recipient would inherit an appearance that
// re-rolls every launch with no visible cause. Links carry the stable modes
// only, and a stripped axis leaves the reader on whatever they already have —
// Auto, on a fresh install. Same reasoning that keeps `motion` and `haptics`
// out of share links. It still round-trips through localStorage and through a
// config export, which is a full backup of the machine it was taken on.
export function isShareableMode(mode: Scheme | Palette): boolean {
  return mode !== 'shake';
}

export type Motion = 'auto' | 'reduced' | 'full';

// UI density. 'auto' is condensed on mobile, relaxed on desktop.
export type Spacing = 'auto' | 'condensed' | 'relaxed';

// Where the events tray sits. 'auto' slides in from the left on desktop and up
// from the bottom on mobile; 'bottom'/'left' force one side regardless of device.
export type TraySide = 'auto' | 'bottom' | 'left';

// How remote feeds are fetched (Settings → Fetch calendars). 'auto': the
// browser asks the calendar's host itself where the host allows it (the host
// sees the device's IP, our server sees nothing), else our proxy. 'direct': the
// host only; a calendar it can't serve shows an error. 'proxy': always through
// our proxy (the host sees only the proxy; the proxy sees the feed's URL).
// Secret and public holiday feeds use the proxy in every mode.
export type FeedFetch = 'auto' | 'direct' | 'proxy';
export const FEED_FETCH_OPTIONS: readonly FeedFetch[] = ['auto', 'direct', 'proxy'];

// What the collapsed status bar's next-event line shows (Settings' Next Event):
// every event, all-day events only, timed events only ("Short"), or nothing.
export type NextEvents = 'all' | 'allday' | 'timed' | 'none';
export const NEXT_EVENTS_OPTIONS: readonly NextEvents[] = ['all', 'allday', 'timed', 'none'];

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
  // How the rule treats matched text: absent = matte (match + decorate only, no
  // rewrite — the default); '' = replace with blank (delete the matched text);
  // a non-empty string = replace the match with that text.
  replace?: string;
  style: StyleVariant;
  category: FeedCategory;
  color?: CalendarColor;
  block?: Block;
  position?: MatchPosition;
  disabled?: boolean;
};

export type TrayFilter = {
  categories: FeedCategory[];
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
  feedFetch: FeedFetch;
  nextEvents: NextEvents;
  borderWeight: BorderWeight;
  haptics: Haptics;
  fontSize: FontSize;
  locale: Locale;
  dateFormat: DateFormat;
  rules: FindReplaceRule[];
  cardShowDescription: boolean;
  cardShowLocation: boolean;
  // The "Current" (display) timezone: drives every shown time — event-pill
  // times, the now-line marker, modal / hover / status bar — and is the 1W week
  // view's leftmost gutter column + grid layout anchor. 'local' resolves to the
  // device zone.
  timezone: Timezone;
  dst: Dst;
  timeFormat: TimeFormat;
  weekStart: WeekStart;
  // 1W reference gutter columns (IANA zone ids, no 'local' sentinel). Shown after
  // the Current column; a reference zone equal to Current collapses out, so a
  // third column appears only when Current differs from both. timezone1 defaults
  // to Athens, timezone2 to New York.
  timezone1: string;
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

export const SCHEMA_VERSION = 3;

// Open/closed state of the settings panel's <details> sections. Device-local
// UI state persisted under its own key — deliberately outside AppConfig so it
// never rides share links or the schema version.
export const SETTINGS_SECTION_IDS = ['look', 'time', 'filters', 'calendars'] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsSections = Record<SettingsSectionId, boolean>;

// A day (UTC midnight) → the moment it begins for an all-day or timed event.
export type DayStart = (dayMs: number, allDay: boolean) => number;

// A pointer position, as PointerEvent carries it.
export type PointerAt = { clientX: number; clientY: number };

// How an opened share link is handled on this device (decideShareImport).
// `sign`: a display with no pointer, whose setup the link replaces whole.
export type ShareImportDecision =
  | { action: 'auto'; sign: boolean }
  | { action: 'ask' }
  | { action: 'refuse'; reason: 'locked' | 'insecure' | 'cut' };

// --- Share links (share.ts) ---

// A local lane paired with its live events, as the share buttons hand it to the
// encoder (from reactive state) — so editing Draft events refreshes the link.
export type LocalLaneForShare = { feed: CalendarFeed; events: ParsedEvent[] };

// A decoded local lane, ready to be materialized into a fresh scratchpad lane.
// isDraft routes it into the recipient's own Draft; hidden restores its enabled state.
export type DecodedLocalFeed = {
  name: string; category: FeedCategory; timezone?: string;
  hidden?: boolean; isDraft?: boolean; subLanes?: SubLanes; events: ParsedEvent[];
};

// What a share link decodes to. `truncated`: the link was cut short and only
// what arrived before the cut is here.
export type DecodedShare = {
  feeds: CalendarFeed[]; rules: FindReplaceRule[]; localFeeds: DecodedLocalFeed[];
  view: SharedView_t | null; kioskPin: string | null; truncated: boolean;
};

export type SharedView_t = { zoom?: Zoom; locale?: Locale; dateFormat?: DateFormat; scheme?: Scheme; palette?: Palette };

// What a native share sheet attempt came to (share.ts tryNativeShare).
export type NativeShareResult = 'shared' | 'stuck' | 'fallback' | 'dismissed';

// --- Feed transport (feed-transport.ts) ---

export type FeedRoute = 'direct' | 'proxy';

// `text`: the body, when the transport already had to read it (a direct
// answer labelled text/html is judged by its body).
export type FeedResponse = { response: Response; via: FeedRoute; text?: string };

// The feed-error "?" is drawn at one size wherever it appears: the timeline
// row header and Settings' calendar list (where its slot is this wide, so the
// row doesn't shift when it replaces the chain icon).
export const FEED_ERROR_ICON_PX = 16;
