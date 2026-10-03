import { matchDate, matchDuration, matchTime, type Clock, type DateOrder } from './date-words';

// Typed quick entry for the add-event title: "Lunch w/ Ana fri 13-14 @Taverna"
// reads as a title plus a date, a time range and a location. Words the parser
// used are tagged by kind so the form can drop from the title only the ones it
// actually applied (a field the user set by hand keeps its words in the title).

export type QuickKind = 'date' | 'time' | 'location';

export type QuickAdd = {
  date: number | null; // UTC midnight of the day
  start: Clock | null;
  end: Clock | null; // null: start plus `minutes`, else the form's default length
  minutes: number | null; // from "for 30m"
  location: string | null;
  // The input split into words, each with the kind that consumed it (null = title).
  words: Array<{ text: string; kind: QuickKind | null }>;
};

export function parseQuickAdd(text: string, todayMs: number, order: DateOrder): QuickAdd {
  const raw = text.split(/\s+/).filter(Boolean);
  const lower = raw.map((w) => w.toLowerCase());
  const kinds: Array<QuickKind | null> = raw.map(() => null);
  const out: QuickAdd = { date: null, start: null, end: null, minutes: null, location: null, words: [] };

  // Location: everything from the first word starting with "@" to the end, minus
  // any date/time words found in it below.
  const at = raw.findIndex((w) => w.startsWith('@'));
  const locEnd = raw.length;

  for (let i = 0; i < raw.length; ) {
    if (out.date == null) {
      const d = matchDate(lower, i, todayMs, order);
      if (d) {
        out.date = d.ms;
        for (let k = i; k < i + d.length; k++) kinds[k] = 'date';
        i += d.length;
        continue;
      }
    }
    if (out.start == null) {
      const t = matchTime(lower, i);
      if (t) {
        out.start = t.start;
        out.end = t.end;
        for (let k = i; k < i + t.length; k++) kinds[k] = 'time';
        i += t.length;
        continue;
      }
    }
    if (out.minutes == null) {
      const dur = matchDuration(lower, i);
      if (dur && dur.minutes > 0) {
        out.minutes = dur.minutes;
        for (let k = i; k < i + dur.length; k++) kinds[k] = 'time';
        i += dur.length;
        continue;
      }
    }
    i++;
  }

  if (at >= 0) {
    const loc: string[] = [];
    for (let k = at; k < locEnd; k++) {
      if (kinds[k] != null) continue;
      kinds[k] = 'location';
      loc.push(k === at ? raw[k]!.slice(1) : raw[k]!);
    }
    const joined = loc.join(' ').trim();
    if (joined) out.location = joined;
    else for (let k = at; k < locEnd; k++) if (kinds[k] === 'location') kinds[k] = null;
  }

  // A duration with no start time has nothing to measure from.
  if (out.start == null && out.minutes != null) {
    out.minutes = null;
    for (let k = 0; k < kinds.length; k++) if (kinds[k] === 'time') kinds[k] = null;
  }

  out.words = raw.map((w, k) => ({ text: w, kind: kinds[k]! }));
  return out;
}

// The title once the applied kinds' words are taken out; never empty-handed —
// a title made only of a date ("tomorrow") keeps its words.
export function quickTitle(q: QuickAdd, applied: ReadonlySet<QuickKind>): string {
  const kept = q.words.filter((w) => w.kind == null || !applied.has(w.kind)).map((w) => w.text);
  const title = kept.join(' ').replace(/\s+([,.;:])/g, '$1').replace(/[\s,;:–—-]+$/, '').trim();
  return title || q.words.map((w) => w.text).join(' ');
}

export function hasQuickFields(q: QuickAdd): boolean {
  return q.date != null || q.start != null || q.location != null;
}
