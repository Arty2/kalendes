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

// What splits the space from the venue.
const PLACE_SEPARATOR = /[,–/·]/;

/**
 * Reads a location. The locale is only ever the bracketed group at its very
 * end; the rest splits at `,` `–` `/` `·`, its last part being the venue and
 * anything before it the space. Brackets earlier on are part of a name.
 */
export function parsePlace(text: string): Place {
  const s = text.trim();
  const open = localeOpen(s);
  const locale = open < 0 ? '' : s.slice(open + 1, -1).trim();
  const rest = (open < 0 ? s : s.slice(0, open)).trim();
  const parts = rest.split(PLACE_SEPARATOR);
  // The venue is the last non-empty part; a trailing separator doesn't empty it.
  let v = parts.length - 1;
  while (v > 0 && !parts[v]!.trim()) v--;
  const venue = parts[v]!.trim();
  // The space keeps its own spelling, separators and all.
  let cut = 0;
  for (let i = 0; i < v; i++) cut += parts[i]!.length + 1;
  const space = rest.slice(0, cut).replace(/[\s,–/·]+$/, '').trim();
  return { space, venue, locale };
}

/** The locale of a location, or '' if it names none. */
export function localeOf(text: string): string {
  return parsePlace(text).locale;
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
 * A location as shown: the text as written, except that a bare locale loses its
 * brackets ("(Athens)" reads "Athens") and a locale that repeats the venue is
 * dropped ("Delphi (Delphi)" reads "Delphi"). Returns the text itself when
 * neither applies.
 */
export function writePlace(text: string): string {
  const s = text.trim();
  const open = localeOpen(s);
  if (open < 0) return text;
  const head = s.slice(0, open).trim();
  const locale = s.slice(open + 1, -1).trim();
  if (!head) return locale;
  if (placeKey(parsePlace(s).venue) === placeKey(locale)) return head;
  return text;
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
