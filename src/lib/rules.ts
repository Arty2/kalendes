import type { Block, CalendarColor, DisplayEvent, DurationUnit, FeedCategory, FindReplaceRule, MatchPosition, ParsedEvent, RuleDuration, StyleVariant } from './types';
import { snippetFromText } from './format';
import { placeFromTitle, writePlace } from './place';

export function makeRule(partial: Partial<FindReplaceRule> = {}): FindReplaceRule {
  return {
    // 6 base36 chars (36^6 ≈ 2.2e9) — ample for a handful of user rules, and
    // shorter than the old slice(2) so rule ids weigh less in share links (`i`).
    // Pad first: a random fractional part is usually ~11 chars but can be short.
    id: partial.id ?? (Math.random().toString(36).slice(2) + '000000').slice(0, 6),
    find: partial.find ?? '',
    style: partial.style ?? 'none',
    category: partial.category ?? 'none',
    // Absent replace = matte (match + decorate only); the default for a new rule.
    ...(partial.replace !== undefined ? { replace: partial.replace } : {}),
    ...(partial.color ? { color: partial.color } : {}),
    ...(partial.block && partial.block !== 'none' ? { block: partial.block } : {}),
    ...(partial.position && partial.position !== 'any' ? { position: partial.position } : {}),
    ...(partial.duration ? { duration: partial.duration } : {}),
  };
}

// Days per unit of a filter's length (see DURATION_UNITS).
export const DAYS_PER_UNIT: Record<DurationUnit, number> = { days: 1, weeks: 7, months: 30 };
export const MAX_DURATION_DAYS = 9999;

/** A length in days, as shown: in the largest unit it fills exactly (42 → 6 weeks). */
export function durationInUnits(days: number): { count: number; unit: DurationUnit } {
  if (days % DAYS_PER_UNIT.months === 0) return { count: days / DAYS_PER_UNIT.months, unit: 'months' };
  if (days % DAYS_PER_UNIT.weeks === 0) return { count: days / DAYS_PER_UNIT.weeks, unit: 'weeks' };
  return { count: days, unit: 'days' };
}

/** A length typed as a count of units, in days; null unless a whole count of at least 1. */
export function durationDays(count: number, unit: DurationUnit): number | null {
  if (!Number.isInteger(count) || count < 1) return null;
  return Math.min(count * DAYS_PER_UNIT[unit], MAX_DURATION_DAYS);
}

// A filter's length condition, or undefined when it isn't a valid one.
export function normalizeRuleDuration(d: unknown): RuleDuration | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const { than, days } = d as Partial<RuleDuration>;
  if (than !== 'shorter' && than !== 'longer') return undefined;
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return undefined;
  return { than, days: Math.min(Math.round(days), MAX_DURATION_DAYS) };
}

function replaceAll(haystack: string, find: string, replace: string): string {
  if (!find) return haystack;
  return haystack.split(find).join(replace);
}

// Does this field satisfy the rule's anchor? 'any' needs the substring present;
// 'start'/'end' need the field to begin/end with Find — and an empty Find always
// satisfies those, which is what lets an empty-Find rule insert text.
function fieldMatches(field: string, find: string, pos: MatchPosition): boolean {
  if (pos === 'start') return field.startsWith(find);
  if (pos === 'end') return field.endsWith(find);
  return !!find && field.includes(find);
}

// Apply the rule to one field, honoring the anchor. 'start'/'end' replace (or,
// with an empty Find, insert) at that end; 'any' replaces every occurrence.
function applyAnchored(field: string, find: string, replace: string, pos: MatchPosition): string {
  if (pos === 'start') {
    return field.startsWith(find) ? replace + field.slice(find.length) : field;
  }
  if (pos === 'end') {
    return field.endsWith(find) ? field.slice(0, field.length - find.length) + replace : field;
  }
  return replaceAll(field, find, replace);
}

function positionOf(rule: FindReplaceRule): MatchPosition {
  return rule.position ?? 'any';
}

// A rule is active when its Find is non-empty, it anchors to start/end (where
// an empty Find is a deliberate "insert here"), or it has a length condition.
// 'any' with an empty Find and no length is inert.
function ruleActive(rule: FindReplaceRule): boolean {
  return !!rule.find || positionOf(rule) !== 'any' || !!rule.duration;
}

const DAY_MS = 86_400_000;

// Does the event's length (start to end) meet the rule's condition? No
// condition = any length.
function durationMatches(event: ParsedEvent, d: RuleDuration | undefined): boolean {
  if (!d) return true;
  const ms = event.end.getTime() - event.start.getTime();
  return d.than === 'longer' ? ms > d.days * DAY_MS : ms < d.days * DAY_MS;
}

// Does the rule's text condition hold on an event's title, description or
// location? An empty 'any' Find on a rule with a length asks nothing of the
// text. (Fields as arguments, not an array: this runs per event per rule.)
function textMatches(rule: FindReplaceRule, title: string, description: string, location: string): boolean {
  const pos = positionOf(rule);
  if (!rule.find && pos === 'any') return !!rule.duration;
  return (
    fieldMatches(title, rule.find, pos) ||
    fieldMatches(description, rule.find, pos) ||
    fieldMatches(location, rule.find, pos)
  );
}


export function applyRules(events: ParsedEvent[], rules: FindReplaceRule[]): DisplayEvent[] {
  return events.map((event) => decorate(event, rules));
}

export function matchingRulesFor(event: ParsedEvent, rules: FindReplaceRule[]): FindReplaceRule[] {
  const out: FindReplaceRule[] = [];
  const { title, location } = placeFromTitle(event.title, event.location);
  for (const rule of rules) {
    if (rule.disabled) continue;
    if (!ruleActive(rule)) continue;
    if (durationMatches(event, rule.duration) && textMatches(rule, title, event.description, location)) out.push(rule);
  }
  return out;
}

export function decorate(event: ParsedEvent, rules: FindReplaceRule[]): DisplayEvent {
  // A location written into the title ("Concert @ Hall") is read out of it
  // first, so rules and places see it where it belongs.
  let { title, location } = placeFromTitle(event.title, event.location);
  let description = event.description;
  let styleVariant: StyleVariant = 'none';
  let styledByLengthOnly = false;
  let thin = false;
  let ruleCategory: FeedCategory | null = null;
  let ruleColor: CalendarColor | null = null;
  let ruleBlock: Block | null = null;
  let matchedFilter = false;
  for (const rule of rules) {
    if (rule.disabled) continue;
    if (!ruleActive(rule)) continue;
    const pos = positionOf(rule);
    // Match against the running (already-rewritten) fields so rules chain.
    const matched =
      durationMatches(event, rule.duration) && textMatches(rule, title, description, location);
    if (matched) {
      matchedFilter = true;
      // Matte rules (no replace) match and decorate but never rewrite text.
      if (rule.replace !== undefined) {
        title = applyAnchored(title, rule.find, rule.replace, pos);
        // An empty-Find insert (start/end) only prepends/appends to the title;
        // a real Find still rewrites every field it anchors in.
        if (rule.find) {
          description = applyAnchored(description, rule.find, rule.replace, pos);
          location = applyAnchored(location, rule.find, rule.replace, pos);
        }
      }
      // Thin stacks with the look another rule (or the calendar) gives.
      if (rule.style === 'thin') thin = true;
      else if (styleVariant === 'none' && rule.style !== 'none') {
        styleVariant = rule.style;
        styledByLengthOnly = !rule.find && pos === 'any';
      }
      if (ruleCategory === null && (rule.category ?? 'none') !== 'none') {
        ruleCategory = rule.category;
      }
      if (ruleColor === null && rule.color) {
        ruleColor = rule.color;
      }
      if (ruleBlock === null && rule.block && rule.block !== 'none') {
        ruleBlock = rule.block;
      }
    }
  }
  // A cancelled event reads struck through unless a filter that matched its
  // text styled it: one that matched only its length (the long-run default)
  // mustn't hide that it's off.
  if (event.cancelled && (styleVariant === 'none' || styledByLengthOnly)) styleVariant = 'striked';
  return {
    ...event,
    displayTitle: title,
    displayDescription: description,
    displayDescriptionSnippet: snippetFromText(description),
    displayLocation: writePlace(location),
    styleVariant,
    ...(thin && styleVariant !== 'hidden' ? { thin: true as const } : {}),
    hidden: styleVariant === 'hidden',
    ruleCategory,
    ruleColor,
    ruleBlock,
    matchedFilter,
  };
}
