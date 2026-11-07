// An event's place, read from its location text in three parts:
// "Space, Venue (Locale)" — e.g. "Main Stage, Music Hall (Athens)".

export type Place = {
  // Anything before the venue ("Main Stage"); '' if none.
  space: string;
  // The last part before the locale ("Music Hall"); '' if none.
  venue: string;
  // The bracketed part at the very end ("Athens"); '' if none.
  locale: string;
};

/** Grouping key for a place's text: trimmed, spaces collapsed, case-folded. */
export function placeKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Where the trailing bracketed locale opens: the last, outermost group the text
// ends with ("Hall (Annex (North))" opens at "(Annex"). -1 without one, with
// unbalanced brackets, or with an empty one.
function localeOpen(s: string): number {
  if (!s.endsWith(')')) return -1;
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i];
    if (c === ')') depth++;
    else if (c === '(' && --depth === 0) return s.slice(i + 1, -1).trim() ? i : -1;
  }
  return -1;
}

// What splits a location's parts: `,` `–` `—` `/` `·`, or a hyphen with spaces
// around it (a bare one is part of a name: "Saint-Denis").
const PLACE_SEPARATOR = /\s+-\s+|[,–—/·]/g;

// A location that is a web address, kept whole.
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\//i;

// How many brackets are open at index `end` of `s`.
function bracketDepth(s: string, end: number): number {
  let depth = 0;
  for (let i = 0; i < end; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && depth > 0) depth--;
  }
  return depth;
}

// A location (locale cut off) split into its non-empty parts, each with the
// separator that follows it: a run of separators around empty parts (", –",
// "Stage, , Hall") counts as its first one. `gapless` is false when such a run,
// or a leading or trailing separator, was dropped.
function splitParts(rest: string): { parts: string[]; seps: string[]; gapless: boolean } {
  const parts: string[] = [];
  const seps: string[] = [];
  let gapless = true;
  let at = 0;
  let pending = ''; // the separator after the last kept part, until the next one
  const take = (raw: string, sep: string): void => {
    const part = raw.trim();
    if (part) {
      if (parts.length > 0) seps.push(pending);
      else if (pending) gapless = false; // a leading separator
      parts.push(part);
      pending = sep;
    } else {
      if (parts.length > 0 || sep) gapless = false;
      if (!pending) pending = sep;
    }
  };
  // A web address is one part ("https://zoom.us/j/1" has no venue in it).
  const matches = URL_LIKE.test(rest) ? [] : rest.matchAll(PLACE_SEPARATOR);
  for (const m of matches) {
    // Separators inside brackets belong to a name: "Room (Upper/Lower)".
    if (bracketDepth(rest, m.index) > 0) continue;
    take(rest.slice(at, m.index), m[0]);
    at = m.index + m[0].length;
  }
  take(rest.slice(at), '');
  if (pending) gapless = false; // a trailing separator
  return { parts, seps, gapless };
}

// Writes a separator found in a location: a comma hugs the part before it, the
// rest stand between spaces.
function joinPart(sep: string): string {
  const c = sep.trim() || '-';
  return c === ',' ? ', ' : ` ${c} `;
}

/**
 * Reads a location. The locale is only ever the bracketed group at its very
 * end; the rest splits at `,` `–` `—` `/` `·` (or a spaced hyphen), its last
 * part being the venue and anything before it the space. Empty parts are
 * ignored, and brackets earlier on are part of a name.
 */
export function parsePlace(text: string): Place {
  const s = text.trim();
  const open = localeOpen(s);
  const locale = open < 0 ? '' : s.slice(open + 1, -1).trim();
  const { parts, seps } = splitParts(open < 0 ? s : s.slice(0, open));
  const venue = parts[parts.length - 1] ?? '';
  // The space keeps its own separators.
  let space = parts[0] ?? '';
  for (let i = 1; i < parts.length - 1; i++) space += joinPart(seps[i - 1]!) + parts[i];
  if (parts.length < 2) space = '';
  return { space, venue, locale };
}

/**
 * Writes a place's parts as "Space, Venue (Locale)", leaving out the missing
 * ones, and naming the locale once when it is the venue ("Delphi").
 */
export function formatPlace({ space, venue, locale }: Place): string {
  const head = [space, venue].filter(Boolean).join(', ');
  if (!locale) return head;
  if (!head || placeKey(venue) === placeKey(locale)) return head || locale;
  return `${head} (${locale})`;
}

/**
 * A location as shown: the text as written, less what's missing — empty parts
 * drop out ("Stage, – Hall" reads "Stage, Hall"), a bare locale loses its
 * brackets ("(Athens)" reads "Athens"), and a locale that repeats the venue is
 * dropped ("Delphi (Delphi)" reads "Delphi"). Returns the text itself when
 * none of that applies.
 */
export function writePlace(text: string): string {
  const s = text.trim();
  const open = localeOpen(s);
  const rest = open < 0 ? s : s.slice(0, open);
  const { parts, seps, gapless } = splitParts(rest);
  let head = rest.trim();
  if (!gapless) {
    head = parts[0] ?? '';
    for (let i = 1; i < parts.length; i++) head += joinPart(seps[i - 1]!) + parts[i];
  }
  if (open < 0) return gapless ? text : head;
  const locale = s.slice(open + 1, -1).trim();
  if (!head) return locale;
  if (placeKey(parts[parts.length - 1]!) === placeKey(locale)) return head;
  return gapless ? text : `${head} (${locale})`;
}

/** What a row split by sub-lanes groups on: the venue, or the locale. */
export type BandGrouping = 'venue' | 'locale';

/**
 * The band a location goes in, as labelled: "Venue (Locale)" by venue (so two
 * halls of one name in different towns stay apart), the locale by locale. A
 * missing part falls back to the other, so "Delphi" and "Theatre (Delphi)"
 * share the Delphi locale band; '' for no location at all.
 */
export function placeGroup(text: string, by: BandGrouping): string {
  const p = parsePlace(text);
  if (by === 'locale') return p.locale || p.venue;
  return formatPlace({ space: '', venue: p.venue, locale: p.locale });
}
