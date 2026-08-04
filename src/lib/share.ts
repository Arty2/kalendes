import type {
  AppConfig,
  Block,
  CalendarColor,
  CalendarFeed,
  DateFormat,
  FeedCategory,
  FindReplaceRule,
  Locale,
  MatchPosition,
  Palette,
  ParsedEvent,
  Scheme,
  StyleVariant,
  Zoom,
} from './types';
import { BLOCK_OPTIONS, CALENDAR_COLORS, FEED_CATEGORIES, MATCH_POSITIONS, PALETTES, SCRATCHPAD_FEED_ID } from './types';
import { feedIdFor } from './ics';
import { loadScratchpad, makeScratchpadEvent } from './scratchpad';
import { safeHref } from './event-display';

export const SHARE_URL_LIMIT = 2000;
export const SHARE_PARAM = 's';

// Payloads are deflate-compressed and carry this prefix ('.' never occurs in
// base64url, so the format is self-identifying). Compression buys roughly
// 2-3× more feeds/rules within SHARE_URL_LIMIT. Pre-compression links (plain
// base64url) are deliberately not decoded — they fail closed: no import
// prompt, param stripped.
const SHARE_FORMAT_PREFIX = '2.';

type SharedFeed = {
  // u is the feed URL with a leading `https://` stripped (remote feeds are assumed
  // https) — decode re-adds it. Other schemes (http://, webcal://) travel intact.
  u: string; n: string; h: 0 | 1; c?: FeedCategory; tz?: string;
  cl?: CalendarColor; bl?: Block; st?: StyleVariant;
  // Legacy: pre-merge links carried a separate travel tag; decoded back into `c`.
  tr?: 'international' | 'local';
};
type SharedRule = {
  // r absent = matte (match + decorate only); '' = replace with blank.
  i: string; f: string; r?: string; s: StyleVariant;
  c?: FeedCategory; cl?: CalendarColor; bl?: Block; p?: MatchPosition; x?: 1;
};
// A local (scratchpad) lane and its events — there is no URL to re-fetch, so the
// event snapshot travels inline. To keep links short, timestamps are stored coarse:
//   s = start in MINUTES, delta from the previous event's start in this lane
//       (the first event's s is absolute minutes);
//   e = duration in MINUTES (end - start).
// descriptionSnippet and uid are dropped (recomputed / regenerated on decode).
type SharedLocalEvent = {
  t: string; s: number; e: number; a: 0 | 1;
  d?: string; l?: string; w?: string; c?: FeedCategory;
  // Legacy travel tag; decoded back into `c`.
  tr?: 'international' | 'local';
};
// h = hidden/disabled; df = this lane is the built-in Draft (scratchpad:default),
// so the recipient merges it into their own Draft rather than making a new lane.
type SharedLocalFeed = {
  n: string; c?: FeedCategory; tz?: string; h?: 0 | 1; df?: 1; ev: SharedLocalEvent[];
  // Legacy travel tag; decoded back into `c`.
  tr?: 'international' | 'local';
};
type SharedView = { z?: Zoom; l?: Locale; d?: DateFormat; t?: Scheme; p?: Palette };
type SharedPayload = { f: SharedFeed[]; r: SharedRule[]; lf?: SharedLocalFeed[]; v?: SharedView; k?: string };

// A local lane paired with its live events, as the share buttons hand it to the
// encoder (from reactive state) — so editing Draft events refreshes the link.
export type LocalLaneForShare = { feed: CalendarFeed; events: ParsedEvent[] };

// A decoded local lane, ready to be materialized into a fresh scratchpad lane.
// isDraft routes it into the recipient's own Draft; hidden restores its enabled state.
export type DecodedLocalFeed = {
  name: string; category: FeedCategory; timezone?: string;
  hidden?: boolean; isDraft?: boolean; events: ParsedEvent[];
};

const STYLE_VARIANTS: StyleVariant[] = [
  'none', 'outline', 'bold', 'inverted', 'dashed', 'muted', 'striked', 'hidden',
];
const ZOOMS: Zoom[] = ['month', 'quarter', 'half-year', 'year', '2-year'];
const LOCALES: Locale[] = ['en', 'el'];
const DATE_FORMATS: DateFormat[] = ['YYYY-MM-DD', 'DD MMM YYYY', 'DD.MM.YYYY', 'MM/DD/YYYY'];
const SCHEMES: Scheme[] = ['light', 'dark', 'auto'];

export type SharedView_t = { zoom?: Zoom; locale?: Locale; dateFormat?: DateFormat; scheme?: Scheme; palette?: Palette };

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

// Not Blob.stream(): jsdom's Blob (used by the test suite) doesn't implement it.
function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// lib.dom types (De)CompressionStream's writable side as BufferSource, which
// pipeThrough's invariant generics reject for a Uint8Array stream; the pair is
// byte-in/byte-out at runtime.
type BytePair = ReadableWritablePair<Uint8Array, Uint8Array>;

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = bytesToStream(bytes).pipeThrough(
    new CompressionStream('deflate-raw') as unknown as BytePair,
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = bytesToStream(bytes).pipeThrough(
    new DecompressionStream('deflate-raw') as unknown as BytePair,
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeShareState(
  config: AppConfig,
  zoom?: Zoom,
  localLanes?: LocalLaneForShare[],
): Promise<string> {
  const payload: SharedPayload = {
    f: config.feeds
      .filter((f) => f.source.kind === 'user')
      .sort((a, b) => a.order - b.order)
      .map((f) => {
        const url = (f.source as { kind: 'user'; url: string }).url;
        return {
          // Assume https for remote feeds: drop the scheme (decode re-adds it).
          // Other schemes travel intact so they still round-trip.
          u: url.startsWith('https://') ? url.slice('https://'.length) : url,
          n: f.name,
          h: f.category === 'holidays' ? 1 : 0,
          ...(f.category && f.category !== 'none' && f.category !== 'holidays' ? { c: f.category } : {}),
          ...(f.timezone ? { tz: f.timezone } : {}),
          ...(f.color ? { cl: f.color } : {}),
          ...(f.block && f.block !== 'none' ? { bl: f.block } : {}),
          ...(f.style && f.style !== 'none' ? { st: f.style } : {}),
        };
      }),
    r: config.rules.map((r) => ({
      i: r.id, f: r.find, s: r.style,
      ...(r.replace !== undefined ? { r: r.replace } : {}),
      ...(r.category && r.category !== 'none' ? { c: r.category } : {}),
      ...(r.color ? { cl: r.color } : {}),
      ...(r.block && r.block !== 'none' ? { bl: r.block } : {}),
      ...(r.position && r.position !== 'any' ? { p: r.position } : {}),
      ...(r.disabled ? { x: 1 as const } : {}),
    })),
  };
  // Local (scratchpad) lanes — the Draft and imported .ics — carry their events
  // inline, since there's no URL to re-fetch. Empty lanes are skipped so a fresh
  // install's always-present empty Draft never bloats every link. When the caller
  // doesn't pass live lanes (e.g. tests, non-UI callers) fall back to localStorage.
  const lanes: LocalLaneForShare[] =
    localLanes ??
    config.feeds
      .filter((f) => f.source.kind === 'scratchpad')
      .map((f) => ({
        feed: f,
        events: loadScratchpad((f.source as { kind: 'scratchpad'; id?: string }).id ?? 'default'),
      }));
  const lf: SharedLocalFeed[] = lanes
    // Keep any non-empty lane, plus an empty-but-enabled Draft so its enabled
    // state still travels. Empty non-Draft lanes are skipped.
    .filter(
      (l) =>
        l.feed.source.kind === 'scratchpad' &&
        (l.events.length > 0 || (l.feed.id === SCRATCHPAD_FEED_ID && !l.feed.hidden)),
    )
    .sort((a, b) => a.feed.order - b.feed.order)
    .map((l) => ({
      n: l.feed.name,
      ...(l.feed.category && l.feed.category !== 'none' ? { c: l.feed.category } : {}),
      ...(l.feed.timezone ? { tz: l.feed.timezone } : {}),
      ...(l.feed.hidden ? { h: 1 as const } : {}),
      ...(l.feed.id === SCRATCHPAD_FEED_ID ? { df: 1 as const } : {}),
      ev: (() => {
        // Delta/minute encode within the sorted lane: first start absolute (in
        // minutes), the rest as deltas from the previous start; e is a duration.
        let prevStartMin = 0;
        return l.events.map((ev, idx) => {
          const startMin = Math.round(ev.start.getTime() / 60000);
          const endMin = Math.round(ev.end.getTime() / 60000);
          const s = idx === 0 ? startMin : startMin - prevStartMin;
          prevStartMin = startMin;
          return {
            t: ev.title,
            s,
            e: endMin - startMin,
            a: ev.allDay ? 1 : 0,
            ...(ev.description ? { d: ev.description } : {}),
            ...(ev.location ? { l: ev.location } : {}),
            ...(ev.url ? { w: ev.url } : {}),
            ...(ev.category && ev.category !== 'none' ? { c: ev.category } : {}),
          };
        });
      })(),
    }));
  if (lf.length > 0) payload.lf = lf;
  const view: SharedView = {};
  if (zoom) view.z = zoom;
  if (config.locale) view.l = config.locale;
  if (config.dateFormat) view.d = config.dateFormat;
  if (config.scheme) view.t = config.scheme;
  if (config.palette) view.p = config.palette;
  if (Object.keys(view).length > 0) payload.v = view;
  if (config.kioskPin && /^\d{4}$/.test(config.kioskPin)) payload.k = config.kioskPin;
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return SHARE_FORMAT_PREFIX + toBase64Url(await deflateRaw(bytes));
}

export async function decodeShareState(
  payload: string,
): Promise<{ feeds: CalendarFeed[]; rules: FindReplaceRule[]; localFeeds: DecodedLocalFeed[]; view: SharedView_t | null; kioskPin: string | null } | null> {
  if (!payload || typeof payload !== 'string') return null;
  if (!payload.startsWith(SHARE_FORMAT_PREFIX)) return null;
  try {
    const bytes = fromBase64Url(payload.slice(SHARE_FORMAT_PREFIX.length));
    const json = new TextDecoder().decode(await inflateRaw(bytes));
    const parsed = JSON.parse(json) as Partial<SharedPayload>;
    if (!parsed || typeof parsed !== 'object') return null;
    const rawFeeds = Array.isArray(parsed.f) ? parsed.f : [];
    const rawRules = Array.isArray(parsed.r) ? parsed.r : [];
    const feeds: CalendarFeed[] = [];
    rawFeeds.forEach((f, i) => {
      if (!f || typeof f !== 'object') return;
      if (typeof f.u !== 'string' || typeof f.n !== 'string') return;
      // Re-add the assumed https scheme; leave any URL that already carries a
      // scheme (https://, http://, webcal://) untouched so we never double it.
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(f.u) ? f.u : 'https://' + f.u;
      const source = { kind: 'user' as const, url };
      let category: FeedCategory =
        typeof f.c === 'string' && (FEED_CATEGORIES as string[]).includes(f.c)
          ? (f.c as FeedCategory)
          : f.h === 1
            ? 'holidays'
            : 'none';
      // Legacy: pre-merge links carried travel as a separate `tr` tag — fold it
      // back into the event type.
      if (f.tr === 'international') category = 'travel-international';
      else if (f.tr === 'local') category = 'travel-local';
      const timezone =
        typeof f.tz === 'string' && f.tz.trim().length > 0 ? f.tz.trim() : undefined;
      const color: CalendarColor | undefined =
        typeof f.cl === 'string' && (CALENDAR_COLORS as string[]).includes(f.cl)
          ? (f.cl as CalendarColor)
          : undefined;
      const block: Block | undefined =
        typeof f.bl === 'string' && (BLOCK_OPTIONS as string[]).includes(f.bl) && f.bl !== 'none'
          ? (f.bl as Block)
          : undefined;
      const style: StyleVariant | undefined =
        typeof f.st === 'string' && STYLE_VARIANTS.includes(f.st as StyleVariant) && f.st !== 'none'
          ? (f.st as StyleVariant)
          : undefined;
      feeds.push({
        id: feedIdFor(source),
        source,
        name: f.n,
        collapsed: false,
        order: i,
        kind: category === 'holidays' ? 'holidays' : 'events',
        category,
        ...(timezone ? { timezone } : {}),
        ...(color ? { color } : {}),
        ...(block ? { block } : {}),
        ...(style ? { style } : {}),
      });
    });
    const rules: FindReplaceRule[] = [];
    rawRules.forEach((r) => {
      if (!r || typeof r !== 'object') return;
      if (typeof r.i !== 'string' || typeof r.f !== 'string') return;
      const style: StyleVariant = STYLE_VARIANTS.includes(r.s) ? r.s : 'none';
      // r absent = matte (match + decorate only); '' (replace with blank) and real
      // replacements are kept.
      const replace: string | undefined =
        typeof r.r === 'string' ? r.r : undefined;
      const category: FeedCategory =
        typeof r.c === 'string' && (FEED_CATEGORIES as string[]).includes(r.c)
          ? (r.c as FeedCategory)
          : 'none';
      const color: CalendarColor | undefined =
        typeof r.cl === 'string' && (CALENDAR_COLORS as string[]).includes(r.cl)
          ? (r.cl as CalendarColor)
          : undefined;
      const block: Block | undefined =
        typeof r.bl === 'string' && (BLOCK_OPTIONS as string[]).includes(r.bl) && r.bl !== 'none'
          ? (r.bl as Block)
          : undefined;
      const position: MatchPosition | undefined =
        typeof r.p === 'string' && (MATCH_POSITIONS as string[]).includes(r.p) && r.p !== 'any'
          ? (r.p as MatchPosition)
          : undefined;
      rules.push({
        id: r.i,
        find: r.f,
        style,
        category,
        ...(replace !== undefined ? { replace } : {}),
        ...(color ? { color } : {}),
        ...(block ? { block } : {}),
        ...(position ? { position } : {}),
        ...(r.x === 1 ? { disabled: true } : {}),
      });
    });
    const rawLocal = Array.isArray(parsed.lf) ? parsed.lf : [];
    const localFeeds: DecodedLocalFeed[] = [];
    rawLocal.forEach((lfd) => {
      if (!lfd || typeof lfd !== 'object') return;
      if (typeof lfd.n !== 'string' || !Array.isArray(lfd.ev)) return;
      let category: FeedCategory =
        typeof lfd.c === 'string' && (FEED_CATEGORIES as string[]).includes(lfd.c)
          ? (lfd.c as FeedCategory)
          : 'none';
      // Legacy travel tag → event type.
      if (lfd.tr === 'international') category = 'travel-international';
      else if (lfd.tr === 'local') category = 'travel-local';
      const timezone =
        typeof lfd.tz === 'string' && lfd.tz.trim().length > 0 ? lfd.tz.trim() : undefined;
      const events: ParsedEvent[] = [];
      // Running absolute start (minutes) to rebuild each event from its delta.
      let prevStartMin = 0;
      lfd.ev.forEach((ev, idx) => {
        if (!ev || typeof ev !== 'object') return;
        if (typeof ev.t !== 'string' || typeof ev.s !== 'number' || typeof ev.e !== 'number') return;
        let evCategory =
          typeof ev.c === 'string' && (FEED_CATEGORIES as string[]).includes(ev.c)
            ? (ev.c as FeedCategory)
            : undefined;
        // Legacy travel tag → event type.
        if (ev.tr === 'international') evCategory = 'travel-international';
        else if (ev.tr === 'local') evCategory = 'travel-local';
        // Coarse minute/delta decode: first event's s is absolute minutes, the rest
        // are deltas from the previous start; e is a duration in minutes.
        const startMin = idx === 0 ? ev.s : prevStartMin + ev.s;
        prevStartMin = startMin;
        const start = new Date(startMin * 60000);
        const end = new Date((startMin + ev.e) * 60000);
        const built = makeScratchpadEvent({
          title: ev.t,
          start,
          end,
          allDay: ev.a === 1,
          ...(typeof ev.l === 'string' ? { location: ev.l } : {}),
          ...(typeof ev.d === 'string' ? { description: ev.d } : {}),
          ...(evCategory ? { category: evCategory } : {}),
        });
        // makeScratchpadEvent has no url field; restore it so links round-trip —
        // but only if it carries a safe scheme, so a crafted link can't smuggle a
        // `javascript:`/`data:` URL into a stored event's "Open source" href.
        if (typeof ev.w === 'string') {
          const safe = safeHref(ev.w);
          if (safe) built.url = safe;
        }
        events.push(built);
      });
      localFeeds.push({
        name: lfd.n,
        category,
        ...(timezone ? { timezone } : {}),
        ...(lfd.h === 1 ? { hidden: true } : {}),
        ...(lfd.df === 1 ? { isDraft: true } : {}),
        events,
      });
    });
    let view: SharedView_t | null = null;
    if (parsed.v && typeof parsed.v === 'object') {
      const v: SharedView_t = {};
      const raw = parsed.v;
      if (raw.z && ZOOMS.includes(raw.z)) v.zoom = raw.z;
      if (raw.l && LOCALES.includes(raw.l)) v.locale = raw.l;
      if (raw.d && DATE_FORMATS.includes(raw.d)) v.dateFormat = raw.d;
      if (raw.t && SCHEMES.includes(raw.t)) v.scheme = raw.t;
      if (raw.p && PALETTES.includes(raw.p)) v.palette = raw.p;
      if (Object.keys(v).length > 0) view = v;
    }
    const kioskPin =
      typeof parsed.k === 'string' && /^\d{4}$/.test(parsed.k) ? parsed.k : null;
    return { feeds, rules, localFeeds, view, kioskPin };
  } catch {
    return null;
  }
}

export async function buildShareUrl(
  config: AppConfig,
  zoom?: Zoom,
  base?: string,
  localLanes?: LocalLaneForShare[],
): Promise<string> {
  const payload = await encodeShareState(config, zoom, localLanes);
  const root = base ?? (typeof location !== 'undefined' ? location.origin + location.pathname : '');
  // Carry the current fragment (temp-marker position) so the link restores the
  // viewed date even if the recipient never imports the config.
  const hash = typeof location !== 'undefined' ? location.hash : '';
  return root + '?' + SHARE_PARAM + '=' + payload + hash;
}

export function readShareParam(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get(SHARE_PARAM);
}

// Native Web Share, with a guard against a well-known browser bug: on iOS Safari
// and Firefox for Android the first navigator.share() promise never settles (the
// browser never reports the share sheet closing), so its internal "share in
// progress" flag stays set and every later call throws InvalidStateError ("an
// earlier share has not yet completed") until the page is reloaded. JS cannot
// reset that flag. We track our own in-flight guard so a repeat tap doesn't hang;
// well-behaved browsers settle the promise and keep sharing natively, while stuck
// browsers report 'stuck' so the caller can copy + hint that a refresh is needed.
let sharePending = false;

export type NativeShareResult = 'shared' | 'stuck' | 'fallback' | 'dismissed';

export async function tryNativeShare(url: string): Promise<NativeShareResult> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return 'fallback';
  }
  // A prior share is still in flight (the stuck state) — don't fire another
  // navigator.share (it would throw); let the caller copy + hint instead.
  if (sharePending) return 'stuck';
  sharePending = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = (): void => {
    sharePending = false;
    if (timer) clearTimeout(timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
  // The promise may never settle on the buggy browsers; clear the guard when the
  // user returns to the page (sheet dismissed) or after a timeout so later taps
  // can re-attempt native rather than being blocked on our side forever.
  const onVisible = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') clear();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }
  timer = setTimeout(clear, 120000);
  try {
    await navigator.share({ url });
    clear();
    return 'shared';
  } catch (err) {
    clear();
    // The user cancelling the share sheet rejects with AbortError. Report that as
    // 'dismissed' so callers skip the clipboard fallback — attempting writeText()
    // before focus returns to the document throws "Document is not focused".
    const name = (err as Error).name;
    if (name === 'InvalidStateError') return 'stuck';
    if (name === 'AbortError') return 'dismissed';
    return 'fallback';
  }
}

export function stripShareParam(): void {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const params = new URLSearchParams(location.search);
  if (!params.has(SHARE_PARAM)) return;
  params.delete(SHARE_PARAM);
  const next = params.toString();
  history.replaceState(null, '', location.pathname + (next ? '?' + next : '') + location.hash);
}
