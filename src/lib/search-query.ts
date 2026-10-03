import { matchDate, parseDateQuery, type DateOrder } from './date-words';
import { MS_PER_DAY } from './time';
import type { DisplayEvent } from './types';

// The search field's small query language, on top of the fuzzy text match:
//   "exact phrase"     must appear as typed (any case) in title, notes or place
//   in:work            only calendars whose name contains "work" (repeat = any of)
//   loc:athens         location contains "athens" (repeat = all of)
//   after:2026-11      starts on or after that day
//   before:fri         starts before that day
// Quotes group words in an operator too (in:"Team calendar"). Operator dates take
// every form the date parser knows (2026-11-02, 2026-11, 9 oct, fri, +2w, …).
// Whatever is left is the fuzzy text.
export type SearchQuery = {
  text: string;
  phrases: string[];
  calendars: string[];
  locations: string[];
  afterMs: number | null;
  beforeMs: number | null;
};

const OPERATOR = /^(in|cal|loc|location|after|from|before|until):(.*)$/i;

// Split into words, keeping "quoted runs" (and op:"quoted runs") together.
function tokenize(q: string): Array<{ text: string; quoted: boolean }> {
  const out: Array<{ text: string; quoted: boolean }> = [];
  const re = /(\S*?)"([^"]*)"?|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[3] != null) out.push({ text: m[3], quoted: false });
    else out.push({ text: (m[1] ?? '') + m[2], quoted: true });
  }
  return out;
}

function operatorDate(value: string, todayMs: number, order: DateOrder): number | null {
  const whole = parseDateQuery(value, todayMs, order);
  if (whole != null) return whole;
  const m = matchDate([value.toLowerCase()], 0, todayMs, order, true);
  return m ? m.ms : null;
}

export function parseSearchQuery(raw: string, todayMs: number, order: DateOrder): SearchQuery {
  const q: SearchQuery = { text: '', phrases: [], calendars: [], locations: [], afterMs: null, beforeMs: null };
  const words: string[] = [];
  for (const tok of tokenize(raw)) {
    const op = OPERATOR.exec(tok.text);
    if (op) {
      const key = op[1]!.toLowerCase();
      const value = op[2]!.trim();
      if (!value) continue; // "in:" still being typed
      if (key === 'in' || key === 'cal') q.calendars.push(value.toLowerCase());
      else if (key === 'loc' || key === 'location') q.locations.push(value.toLowerCase());
      else {
        const ms = operatorDate(value, todayMs, order);
        if (ms == null) {
          words.push(tok.text);
        } else if (key === 'after' || key === 'from') {
          q.afterMs = ms;
        } else {
          q.beforeMs = ms;
        }
      }
      continue;
    }
    if (tok.quoted) {
      if (tok.text.trim()) q.phrases.push(tok.text.trim().toLowerCase());
      continue;
    }
    words.push(tok.text);
  }
  q.text = words.join(' ').trim();
  return q;
}

export function hasOperators(q: SearchQuery): boolean {
  return (
    q.phrases.length > 0 ||
    q.calendars.length > 0 ||
    q.locations.length > 0 ||
    q.afterMs != null ||
    q.beforeMs != null
  );
}

function contains(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle);
}

// The operator half of a query, as a predicate. The fuzzy text is matched
// separately (Fuse) over whatever passes this.
export function queryFilter(
  q: SearchQuery,
  feedName: (feedId: string) => string,
): (ev: DisplayEvent) => boolean {
  return (ev) => {
    if (q.afterMs != null && ev.start.getTime() < q.afterMs) return false;
    // "before" a day excludes that day: an event must start before its midnight.
    if (q.beforeMs != null && ev.start.getTime() >= q.beforeMs) return false;
    if (q.calendars.length > 0) {
      const name = feedName(ev.feedId).toLowerCase();
      if (!q.calendars.some((c) => name.includes(c))) return false;
    }
    for (const loc of q.locations) {
      if (!contains(ev.displayLocation, loc) && !contains(ev.location, loc)) return false;
    }
    for (const p of q.phrases) {
      const hit =
        contains(ev.displayTitle, p) ||
        contains(ev.title, p) ||
        contains(ev.displayDescription, p) ||
        contains(ev.description, p) ||
        contains(ev.displayLocation, p) ||
        contains(ev.location, p);
      if (!hit) return false;
    }
    return true;
  };
}

// Does an event overlap the day span [startMs, endMs] (both UTC midnights,
// end inclusive)?
export function overlapsDays(ev: DisplayEvent, startMs: number, endMs: number): boolean {
  return ev.end.getTime() > startMs && ev.start.getTime() < endMs + MS_PER_DAY;
}
