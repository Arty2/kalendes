import type { Block, CalendarColor, DisplayEvent, FeedCategory, FindReplaceRule, MatchPosition, ParsedEvent, StyleVariant } from './types';
import { snippetFromText } from './format';

export function makeRule(partial: Partial<FindReplaceRule> = {}): FindReplaceRule {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    find: partial.find ?? '',
    replace: partial.replace ?? '',
    style: partial.style ?? 'none',
    category: partial.category ?? 'none',
    ...(partial.color ? { color: partial.color } : {}),
    ...(partial.block && partial.block !== 'none' ? { block: partial.block } : {}),
    ...(partial.position && partial.position !== 'any' ? { position: partial.position } : {}),
  };
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

// A rule is active when its Find is non-empty, or it anchors to start/end (where
// an empty Find is a deliberate "insert here"). 'any' with an empty Find is inert.
function ruleActive(rule: FindReplaceRule): boolean {
  return !!rule.find || positionOf(rule) !== 'any';
}

function ruleMatchesEvent(event: ParsedEvent, rule: FindReplaceRule): boolean {
  const pos = positionOf(rule);
  return (
    fieldMatches(event.title, rule.find, pos) ||
    fieldMatches(event.description, rule.find, pos) ||
    fieldMatches(event.location, rule.find, pos)
  );
}


export function applyRules(events: ParsedEvent[], rules: FindReplaceRule[]): DisplayEvent[] {
  return events.map((event) => decorate(event, rules));
}

export function matchingRulesFor(event: ParsedEvent, rules: FindReplaceRule[]): FindReplaceRule[] {
  const out: FindReplaceRule[] = [];
  for (const rule of rules) {
    if (rule.disabled) continue;
    if (!ruleActive(rule)) continue;
    if (ruleMatchesEvent(event, rule)) out.push(rule);
  }
  return out;
}

export function decorate(event: ParsedEvent, rules: FindReplaceRule[]): DisplayEvent {
  let title = event.title;
  let description = event.description;
  let location = event.location;
  let styleVariant: StyleVariant = 'none';
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
      fieldMatches(title, rule.find, pos) ||
      fieldMatches(description, rule.find, pos) ||
      fieldMatches(location, rule.find, pos);
    if (matched) {
      matchedFilter = true;
      title = applyAnchored(title, rule.find, rule.replace, pos);
      // An empty-Find insert (start/end) only prepends/appends to the title;
      // a real Find still rewrites every field it anchors in.
      if (rule.find) {
        description = applyAnchored(description, rule.find, rule.replace, pos);
        location = applyAnchored(location, rule.find, rule.replace, pos);
      }
      if (styleVariant === 'none' && rule.style !== 'none') {
        styleVariant = rule.style;
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
  return {
    ...event,
    displayTitle: title,
    displayDescription: description,
    displayDescriptionSnippet: snippetFromText(description),
    displayLocation: location,
    styleVariant,
    hidden: styleVariant === 'hidden',
    ruleCategory,
    ruleColor,
    ruleBlock,
    matchedFilter,
  };
}
