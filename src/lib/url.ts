import type { DateFormat, Locale, Scheme, Zoom } from './types';
import { isShareableMode, SCHEMES } from './types';

export type UrlState = {
  zoom: Zoom | null;
  locale: Locale | null;
  dateFormat: DateFormat | null;
  scheme: Scheme | null;
};

const ZOOM_MAP: Record<string, Zoom> = {
  '1w': 'week',
  '1m': 'month',
  '3m': 'quarter',
  '6m': 'half-year',
  '1y': 'year',
  '2y': '2-year',
};
const ZOOM_MAP_REVERSE: Record<Zoom, string> = {
  week: '1w',
  month: '1m',
  quarter: '3m',
  'half-year': '6m',
  year: '1y',
  '2-year': '2y',
};

const LOCALES: Locale[] = ['en', 'el'];
const FORMAT_TO_PARAM: Record<DateFormat, string> = {
  'YYYY-MM-DD': 'iso',
  'DD MMM YYYY': 'long',
  'DD.MM.YYYY': 'dmy',
  'MM/DD/YYYY': 'mdy',
};
const PARAM_TO_FORMAT: Record<string, DateFormat> = {
  iso: 'YYYY-MM-DD',
  long: 'DD MMM YYYY',
  dmy: 'DD.MM.YYYY',
  mdy: 'MM/DD/YYYY',
};

// Everything the app keeps in its address lives in the fragment (`#…`), which
// browsers never send to the server: the view settings, the temp marker and a
// share link's payload. Links from before this (`?z=…&loc=…&d=…&t=…`, `?s=…`)
// are still read once, then the query is cleared.
export function fragmentParams(
  hash: string = typeof location !== 'undefined' ? location.hash : '',
): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
}

function fragmentString(params: URLSearchParams): string {
  const s = params.toString();
  return s ? '#' + s : '';
}

// Merge keys into the current fragment (null deletes one) and drop the given
// legacy query keys, in a single replaceState that keeps the entry's state:
// Settings tags its history entry `{ settingsOpen }`, and wiping it left that
// entry behind when Settings closed.
export function updateLocation(
  fragment: Record<string, string | null>,
  dropQuery: readonly string[] = [],
): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  const frag = fragmentParams(location.hash);
  for (const [k, v] of Object.entries(fragment)) {
    if (v == null) frag.delete(k);
    else frag.set(k, v);
  }
  const query = new URLSearchParams(location.search);
  for (const k of dropQuery) query.delete(k);
  const search = query.toString();
  const next = location.pathname + (search ? '?' + search : '') + fragmentString(frag);
  if (next === location.pathname + location.search + location.hash) return;
  history.replaceState(history.state, '', next);
}

// History entries the app has seen carry a state object (`{ app: true }`, or
// Settings' `{ settingsOpen }`); one the browser created for a pasted link's
// fragment has none. That tells a link apart from Back/Forward, which land on
// our own entries and must not re-apply what they hold.
export function isLinkEntry(state: unknown = typeof history !== 'undefined' ? history.state : null): boolean {
  return state == null;
}

export function tagHistoryEntry(): void {
  if (typeof history === 'undefined' || history.state != null) return;
  history.replaceState({ app: true }, '');
}

// The pre-fragment view keys; `d` was the date format there (in the fragment
// it is the marker, so the format travels as `df`).
const LEGACY_VIEW_KEYS = ['z', 'loc', 'd', 't'] as const;

export function readUrlState(
  hash: string = typeof location !== 'undefined' ? location.hash : '',
  search: string = typeof location !== 'undefined' ? location.search : '',
): UrlState {
  const frag = fragmentParams(hash);
  const legacy = new URLSearchParams(search);
  const pick = (key: string, legacyKey: string): string | undefined =>
    (frag.get(key) ?? legacy.get(legacyKey))?.toLowerCase();
  const z = pick('z', 'z');
  const loc = pick('loc', 'loc');
  const d = pick('df', 'd');
  const t = pick('t', 't');
  return {
    zoom: z && ZOOM_MAP[z] ? ZOOM_MAP[z] : null,
    locale: loc && LOCALES.includes(loc as Locale) ? (loc as Locale) : null,
    dateFormat: d && PARAM_TO_FORMAT[d] ? PARAM_TO_FORMAT[d] : null,
    scheme: t && SCHEMES.includes(t as Scheme) && isShareableMode(t as Scheme) ? (t as Scheme) : null,
  };
}

function viewEntries(state: {
  zoom: Zoom;
  locale: Locale;
  dateFormat: DateFormat;
  scheme: Scheme;
}): Record<string, string | null> {
  return {
    z: ZOOM_MAP_REVERSE[state.zoom],
    loc: state.locale,
    df: FORMAT_TO_PARAM[state.dateFormat],
    // Shake is left out rather than substituted: a missing `t` makes readUrlState
    // return null for it, so the reader keeps the scheme they already have and the
    // shaker's own localStorage choice still stands on reload.
    t: isShareableMode(state.scheme) ? state.scheme : null,
  };
}

export function applyUrlState(state: {
  zoom: Zoom;
  locale: Locale;
  dateFormat: DateFormat;
  scheme: Scheme;
}): void {
  updateLocation(viewEntries(state), LEGACY_VIEW_KEYS);
}

// The temporary marker date lives in the URL fragment (e.g. #d=2026-05-28) so a
// shared link restores the viewed position even if the recipient declines the
// config (#s=...) import. Stored as plain UTC calendar days. A duration marker
// appends its inclusive last day: #d=2026-05-28..2026-06-04. The end is
// optional, so links written before durations existed still parse.
const MARKER_RE =
  /(?:^|[#&])d=(\d{4})-(\d{2})-(\d{2})(?:\.\.(\d{4})-(\d{2})-(\d{2}))?(?:&|$)/;

function dayPart(d: Date): string {
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mo}-${da}`;
}

export function readMarkerHash(
  hash: string = typeof location !== 'undefined' ? location.hash : '',
): { startMs: number; endMs: number | null } | null {
  const m = MARKER_RE.exec(hash);
  if (!m) return null;
  const startMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(startMs)) return null;
  if (m[4] == null) return { startMs, endMs: null };
  const endMs = Date.UTC(Number(m[4]), Number(m[5]) - 1, Number(m[6]));
  // A malformed or backwards end degrades to a plain single-day marker rather
  // than dropping the position entirely.
  if (Number.isNaN(endMs) || endMs < startMs) return { startMs, endMs: null };
  return { startMs, endMs };
}

export function markerValue(ms: number | null, endMs: number | null = null): string | null {
  if (ms == null) return null;
  let v = dayPart(new Date(ms));
  if (endMs != null && endMs > ms) v += `..${dayPart(new Date(endMs))}`;
  return v;
}

export function writeMarkerHash(ms: number | null, endMs: number | null = null): void {
  updateLocation({ d: markerValue(ms, endMs) });
}
