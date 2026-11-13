// Writing to localStorage, for what the app can't get back: settings and the
// events people wrote themselves. The feed events cache (storage.ts) shares the
// same quota and is only a copy of what the network has, so when storage is
// full it gives way.

export const EVENTS_CACHE_KEY = 'calendar-timeline:events';

export function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    // Spec name, Firefox's legacy name, and the legacy numeric code (22).
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22)
  );
}

/**
 * Store `value` under `key`; whether it was stored. A full store drops the
 * feed events cache and tries once more: a cache written to the brim would
 * otherwise make every later save of a setting or a local event fail, quietly,
 * until the reload that shows them gone. (The cache is written again by the
 * next refresh, with its own eviction.) No storage at all counts as stored:
 * there is nothing to lose that a save could have kept.
 */
export function setItemDurably(key: string, value: string): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isQuotaError(err)) return false;
  }
  try {
    localStorage.removeItem(EVENTS_CACHE_KEY);
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
