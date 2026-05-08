import type { DisplayEvent, FindReplaceRule, ParsedEvent, StyleVariant } from './types';

export function makeRule(partial: Partial<FindReplaceRule> = {}): FindReplaceRule {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    find: partial.find ?? '',
    replace: partial.replace ?? '',
    style: partial.style ?? 'none',
  };
}

function replaceAll(haystack: string, find: string, replace: string): string {
  if (!find) return haystack;
  return haystack.split(find).join(replace);
}

function snippet(description: string): string {
  const normalized = description.replace(/\\n/g, '\n').replace(/\\,/g, ',');
  const firstLine = normalized.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return firstLine.length > 80 ? firstLine.slice(0, 79) + '…' : firstLine;
}

export function applyRules(events: ParsedEvent[], rules: FindReplaceRule[]): DisplayEvent[] {
  return events.map((event) => decorate(event, rules));
}

export function decorate(event: ParsedEvent, rules: FindReplaceRule[]): DisplayEvent {
  let title = event.title;
  let description = event.description;
  let location = event.location;
  let styleVariant: StyleVariant = 'none';
  for (const rule of rules) {
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
    }
  }
  return {
    ...event,
    displayTitle: title,
    displayDescription: description,
    displayDescriptionSnippet: snippet(description),
    displayLocation: location,
    styleVariant,
    hidden: styleVariant === 'hidden',
  };
}
