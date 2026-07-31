import type { DateFormat, Locale, Scheme, Zoom } from './types';

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
const SCHEMES: Scheme[] = ['light', 'dark', 'auto'];

export function readUrlState(search: string = typeof location !== 'undefined' ? location.search : ''): UrlState {
  const params = new URLSearchParams(search);
  const z = params.get('z')?.toLowerCase();
  const loc = params.get('loc')?.toLowerCase();
  const d = params.get('d')?.toLowerCase();
  const t = params.get('t')?.toLowerCase();
  return {
    zoom: z && ZOOM_MAP[z] ? ZOOM_MAP[z] : null,
    locale: loc && LOCALES.includes(loc as Locale) ? (loc as Locale) : null,
    dateFormat: d && PARAM_TO_FORMAT[d] ? PARAM_TO_FORMAT[d] : null,
    scheme: t && SCHEMES.includes(t as Scheme) ? (t as Scheme) : null,
  };
}

export function writeUrlState(state: {
  zoom: Zoom;
  locale: Locale;
  dateFormat: DateFormat;
  scheme: Scheme;
}): string {
  const params = new URLSearchParams();
  params.set('z', ZOOM_MAP_REVERSE[state.zoom]);
  params.set('loc', state.locale);
  params.set('d', FORMAT_TO_PARAM[state.dateFormat]);
  params.set('t', state.scheme);
  return '?' + params.toString();
}

export function applyUrlState(state: {
  zoom: Zoom;
  locale: Locale;
  dateFormat: DateFormat;
  scheme: Scheme;
}): void {
  if (typeof history === 'undefined') return;
  const next = writeUrlState(state);
  if (location.search === next) return;
  history.replaceState(null, '', next + location.hash);
}

// The temporary marker date lives in the URL fragment (e.g. #d=2026-05-28) so a
// shared link restores the viewed position even if the recipient declines the
// config (?s=...) import. Stored as plain UTC calendar days. A duration marker
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

export function writeMarkerHash(ms: number | null, endMs: number | null = null): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  let hash = '';
  if (ms != null) {
    hash = `#d=${dayPart(new Date(ms))}`;
    if (endMs != null && endMs > ms) hash += `..${dayPart(new Date(endMs))}`;
  }
  if (location.hash === hash) return;
  history.replaceState(null, '', location.pathname + location.search + hash);
}
