import type { DateFormat, Locale, Theme, Zoom } from './types';

export type UrlState = {
  zoom: Zoom | null;
  locale: Locale | null;
  dateFormat: DateFormat | null;
  theme: Theme | null;
};

const ZOOM_MAP: Record<string, Zoom> = {
  '1m': 'month',
  '3m': 'quarter',
  '6m': 'half-year',
  '1y': 'year',
  '2y': '2-year',
};
const ZOOM_MAP_REVERSE: Record<Zoom, string> = {
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
const THEMES: Theme[] = ['light', 'dark', 'auto'];

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
    theme: t && THEMES.includes(t as Theme) ? (t as Theme) : null,
  };
}

export function writeUrlState(state: {
  zoom: Zoom;
  locale: Locale;
  dateFormat: DateFormat;
  theme: Theme;
}): string {
  const params = new URLSearchParams();
  params.set('z', ZOOM_MAP_REVERSE[state.zoom]);
  params.set('loc', state.locale);
  params.set('d', FORMAT_TO_PARAM[state.dateFormat]);
  params.set('t', state.theme);
  return '?' + params.toString();
}

export function applyUrlState(state: {
  zoom: Zoom;
  locale: Locale;
  dateFormat: DateFormat;
  theme: Theme;
}): void {
  if (typeof history === 'undefined') return;
  const next = writeUrlState(state);
  if (location.search === next) return;
  history.replaceState(null, '', next + location.hash);
}
