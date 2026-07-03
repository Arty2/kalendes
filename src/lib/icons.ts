import type { FeedCategory, Travel } from './types';

// Button icons, inlined at build time as data URIs so they render instantly
// with zero network requests. Previously each icon was a separate
// /icons/<name>.svg file fetched lazily by the CSS mask the first time a button
// painted, so icons "popped in" after the rest of the UI. import.meta.glob with
// ?raw bundles every SVG's source into the JS instead.
const sources = import.meta.glob('../icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const ICON_URLS: Record<string, string> = {};
for (const [path, svg] of Object.entries(sources)) {
  const name = path.slice(path.lastIndexOf('/') + 1, -'.svg'.length);
  ICON_URLS[name] = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// The one place a calendar Type / travel tag maps to its charm icon, shared by
// the row headers, settings rows, pills, modal, and tray chips. Every concrete
// category has a distinct glyph; 'none' (Auto) deliberately has no charm.
export function categoryIcon(category: FeedCategory | undefined): string | null {
  switch (category) {
    case 'events': return 'calendar';
    case 'holidays': return 'category-holiday';
    case 'observances': return 'category-observances';
    case 'guests': return 'category-guests';
    case 'announcements': return 'category-announcements';
    default: return null;
  }
}

export function travelIcon(travel: Travel | undefined): string | null {
  switch (travel) {
    case 'international': return 'category-airplane';
    case 'local': return 'category-bus';
    default: return null;
  }
}
