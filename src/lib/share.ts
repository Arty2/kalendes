import type {
  AppConfig,
  CalendarFeed,
  DateFormat,
  FeedCategory,
  FindReplaceRule,
  Locale,
  StyleVariant,
  Theme,
  Zoom,
} from './types';
import { FEED_CATEGORIES } from './types';
import { feedIdFor } from './ics';

export const SHARE_URL_LIMIT = 2000;
export const SHARE_PARAM = 's';

type SharedFeed = { u: string; n: string; h: 0 | 1; c?: FeedCategory; tz?: string };
type SharedRule = { i: string; f: string; r: string; s: StyleVariant };
type SharedView = { z?: Zoom; l?: Locale; d?: DateFormat; t?: Theme };
type SharedPayload = { f: SharedFeed[]; r: SharedRule[]; v?: SharedView };

const STYLE_VARIANTS: StyleVariant[] = [
  'none', 'inverted-dashed', 'inverted-strike', 'hidden', 'muted', 'highlight',
];
const ZOOMS: Zoom[] = ['month', 'quarter', 'half-year', 'year', '2-year'];
const LOCALES: Locale[] = ['en', 'el'];
const DATE_FORMATS: DateFormat[] = ['YYYY-MM-DD', 'DD MMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY'];
const THEMES: Theme[] = ['light', 'dark'];

export type SharedView_t = { zoom?: Zoom; locale?: Locale; dateFormat?: DateFormat; theme?: Theme };

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeShareState(config: AppConfig, zoom?: Zoom): string {
  const payload: SharedPayload = {
    f: config.feeds
      .filter((f) => f.source.kind === 'user')
      .sort((a, b) => a.order - b.order)
      .map((f) => ({
        u: (f.source as { kind: 'user'; url: string }).url,
        n: f.name,
        h: f.category === 'holidays' ? 1 : 0,
        ...(f.category && f.category !== 'none' && f.category !== 'holidays' ? { c: f.category } : {}),
        ...(f.timezone ? { tz: f.timezone } : {}),
      })),
    r: config.rules.map((r) => ({ i: r.id, f: r.find, r: r.replace, s: r.style })),
  };
  const view: SharedView = {};
  if (zoom) view.z = zoom;
  if (config.locale) view.l = config.locale;
  if (config.dateFormat) view.d = config.dateFormat;
  if (config.theme) view.t = config.theme;
  if (Object.keys(view).length > 0) payload.v = view;
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return toBase64Url(bytes);
}

export function decodeShareState(
  payload: string,
): { feeds: CalendarFeed[]; rules: FindReplaceRule[]; view: SharedView_t | null } | null {
  if (!payload || typeof payload !== 'string') return null;
  try {
    const bytes = fromBase64Url(payload);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as Partial<SharedPayload>;
    if (!parsed || typeof parsed !== 'object') return null;
    const rawFeeds = Array.isArray(parsed.f) ? parsed.f : [];
    const rawRules = Array.isArray(parsed.r) ? parsed.r : [];
    const feeds: CalendarFeed[] = [];
    rawFeeds.forEach((f, i) => {
      if (!f || typeof f !== 'object') return;
      if (typeof f.u !== 'string' || typeof f.n !== 'string') return;
      const source = { kind: 'user' as const, url: f.u };
      let category: FeedCategory;
      if (typeof f.c === 'string' && (FEED_CATEGORIES as string[]).includes(f.c)) {
        category = f.c as FeedCategory;
      } else {
        category = f.h === 1 ? 'holidays' : 'none';
      }
      const timezone =
        typeof f.tz === 'string' && f.tz.trim().length > 0 ? f.tz.trim() : undefined;
      feeds.push({
        id: feedIdFor(source),
        source,
        name: f.n,
        collapsed: false,
        order: i,
        kind: category === 'holidays' ? 'holidays' : 'events',
        category,
        ...(timezone ? { timezone } : {}),
      });
    });
    const rules: FindReplaceRule[] = [];
    rawRules.forEach((r) => {
      if (!r || typeof r !== 'object') return;
      if (typeof r.i !== 'string' || typeof r.f !== 'string' || typeof r.r !== 'string') return;
      const style: StyleVariant = STYLE_VARIANTS.includes(r.s) ? r.s : 'none';
      rules.push({ id: r.i, find: r.f, replace: r.r, style });
    });
    let view: SharedView_t | null = null;
    if (parsed.v && typeof parsed.v === 'object') {
      const v: SharedView_t = {};
      const raw = parsed.v;
      if (raw.z && ZOOMS.includes(raw.z)) v.zoom = raw.z;
      if (raw.l && LOCALES.includes(raw.l)) v.locale = raw.l;
      if (raw.d && DATE_FORMATS.includes(raw.d)) v.dateFormat = raw.d;
      if (raw.t && THEMES.includes(raw.t)) v.theme = raw.t;
      if (Object.keys(v).length > 0) view = v;
    }
    return { feeds, rules, view };
  } catch {
    return null;
  }
}

export function buildShareUrl(config: AppConfig, zoom?: Zoom, base?: string): string {
  const payload = encodeShareState(config, zoom);
  const root = base ?? (typeof location !== 'undefined' ? location.origin + location.pathname : '');
  return root + '?' + SHARE_PARAM + '=' + payload;
}

export function readShareParam(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get(SHARE_PARAM);
}

export function stripShareParam(): void {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const params = new URLSearchParams(location.search);
  if (!params.has(SHARE_PARAM)) return;
  params.delete(SHARE_PARAM);
  const next = params.toString();
  history.replaceState(null, '', location.pathname + (next ? '?' + next : '') + location.hash);
}
