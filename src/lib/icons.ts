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
