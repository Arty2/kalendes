// Pure helpers for the calendar add/edit form in Settings.
import type { FeedCategory } from './types';

// Guess a calendar's Type from its name (or URL) for the "Auto" option.
// 'none' when nothing matches; the form then defaults to Events.
export function detectFeedCategory(name: string): FeedCategory {
  const n = name.toLowerCase();
  if (/holiday|holidays/.test(n)) return 'holidays';
  if (/observ/.test(n)) return 'observances';
  if (/announc|news/.test(n)) return 'announcements';
  if (/guest|birthday|anniversar/.test(n)) return 'guests';
  if (/travel|trip|flight|abroad|international/.test(n)) return 'travel-international';
  if (/domestic/.test(n)) return 'travel-local';
  if (/event|calendar|schedule|agenda/.test(n)) return 'events';
  return 'none';
}

// The first free "<base> N" (N from 1) among the existing names.
export function nextIncrementalName(base: string, existing: Iterable<string>): string {
  const names = new Set(existing);
  let n = 1;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
