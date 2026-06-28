import type { Block, CalendarColor, DisplayEvent, FeedCategory, FindReplaceRule, ParsedEvent, StyleVariant } from './types';
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
  };
}

function replaceAll(haystack: string, find: string, replace: string): string {
  if (!find) return haystack;
  return haystack.split(find).join(replace);
}


export function applyRules(events: ParsedEvent[], rules: FindReplaceRule[]): DisplayEvent[] {
  return events.map((event) => decorate(event, rules));
}

export function matchingRulesFor(event: ParsedEvent, rules: FindReplaceRule[]): FindReplaceRule[] {
  const out: FindReplaceRule[] = [];
  for (const rule of rules) {
    if (rule.disabled) continue;
    if (!rule.find) continue;
    if (
      event.title.includes(rule.find) ||
      event.description.includes(rule.find) ||
      event.location.includes(rule.find)
    ) {
      out.push(rule);
    }
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
  for (const rule of rules) {
    if (rule.disabled) continue;
    if (!rule.find) continue;
    const inTitle = title.includes(rule.find);
    const inDesc = description.includes(rule.find);
    const inLoc = location.includes(rule.find);
    const matched = inTitle || inDesc || inLoc;
    if (matched) {
      title = replaceAll(title, rule.find, rule.replace);
      description = replaceAll(description, rule.find, rule.replace);
      location = replaceAll(location, rule.find, rule.replace);
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
  };
}
