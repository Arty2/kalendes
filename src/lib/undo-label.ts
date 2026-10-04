import type { DateFormat, Locale, ParsedEvent, TimeFormat, Timezone } from './types';
import type { DragChange } from './event-drag';
import { formatDate, formatRange, formatTime, zonedDateProxy } from './format';

// What the undo bar says a reschedule did, from the change and the events as
// they ended up: "Moved “Dentist” to 2026-10-06 10:00 — 11:00",
// "Resized 3 events to 2026-10-06 — 08". The first (earliest) event names the
// destination; a group sharing one title (a merged run) reads as that title.
export function describeReschedule(
  change: DragChange,
  changed: ParsedEvent[],
  fmt: { dateFormat: DateFormat; locale: Locale; timeFormat: TimeFormat; timezone: Timezone },
): string {
  const verb = change.kind === 'resize-days' || change.kind === 'resize-end' ? 'Resized' : 'Moved';
  if (changed.length === 0) return verb;
  const titles = new Set(changed.map((e) => e.title.trim()));
  const subject = titles.size === 1 ? `“${[...titles][0] || 'Untitled'}”` : `${changed.length} events`;
  const first = changed.reduce((a, b) => (b.start.getTime() < a.start.getTime() ? b : a));
  let when: string;
  if (first.allDay) {
    when = formatRange(first.start, first.end, fmt.dateFormat, fmt.locale);
  } else {
    const day = formatDate(zonedDateProxy(first.start, fmt.timezone), fmt.dateFormat, fmt.locale);
    when = `${day} ${formatTime(first.start, fmt.timeFormat, fmt.timezone)} — ${formatTime(first.end, fmt.timeFormat, fmt.timezone)}`;
  }
  return `${verb} ${subject} to ${when}`;
}
