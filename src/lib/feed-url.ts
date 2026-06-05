// Users often paste a Google Calendar *embed* or *share* link rather than its
// ICS feed URL. Those links carry the calendar id (in the `src` query param,
// or base64-encoded in `cid`), and Google publishes a fixed public iCal feed
// for any publicly-shared calendar. Rewrite such links to that feed URL so the
// normal fetch+parse pipeline works; leave everything else untouched.

const GOOGLE_HOSTS = new Set(['calendar.google.com', 'www.google.com', 'google.com']);

function googleIcalUrl(calendarId: string): string {
  return (
    'https://calendar.google.com/calendar/ical/' +
    encodeURIComponent(calendarId) +
    '/public/basic.ics'
  );
}

// `cid` is base64 (sometimes URL-safe) of the calendar id. Decode tolerantly.
function decodeCid(cid: string): string | null {
  if (typeof atob !== 'function') return null;
  try {
    const normalized = cid.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized);
    // A real calendar id contains '@' (…@group.calendar.google.com or a gmail
    // address). If it doesn't, the cid wasn't a plain id we can use.
    return decoded.includes('@') ? decoded : null;
  } catch {
    return null;
  }
}

// True when the URL is a Google iCal feed (e.g. the rewritten
// …/calendar/ical/<id>/public/basic.ics). Used to tailor a 404 message, since
// Google only serves this feed for calendars whose sharing is set to public.
export function isGoogleCalendarFeed(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return (
      GOOGLE_HOSTS.has(url.hostname.toLowerCase()) &&
      url.pathname.includes('/calendar/ical/')
    );
  } catch {
    return false;
  }
}

export function normalizeFeedUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const host = url.hostname.toLowerCase();
  if (!GOOGLE_HOSTS.has(host)) return trimmed;

  // Already an ICS feed — leave it alone.
  if (url.pathname.includes('/calendar/ical/')) return trimmed;

  const src = url.searchParams.get('src');
  if (src && src.trim()) return googleIcalUrl(src.trim());

  const cid = url.searchParams.get('cid');
  if (cid && cid.trim()) {
    const id = decodeCid(cid.trim());
    if (id) return googleIcalUrl(id);
  }

  return trimmed;
}
