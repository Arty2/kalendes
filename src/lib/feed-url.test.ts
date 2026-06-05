import { describe, expect, it } from 'vitest';
import { normalizeFeedUrl, isGoogleCalendarFeed } from './feed-url';

const CAL_ID = 'ashbulayev.com_jbpb04ipob0bmmcmps252tekbs@group.calendar.google.com';
const ICS =
  'https://calendar.google.com/calendar/ical/' +
  'ashbulayev.com_jbpb04ipob0bmmcmps252tekbs%40group.calendar.google.com/public/basic.ics';

describe('normalizeFeedUrl', () => {
  it('rewrites a Google embed URL (the share link) to the public ICS feed', () => {
    const embed =
      'https://calendar.google.com/calendar/embed?src=' +
      encodeURIComponent(CAL_ID) +
      '&ctz=Europe%2FAthens';
    expect(normalizeFeedUrl(embed)).toBe(ICS);
  });

  it('handles the /calendar/u/0/embed account-scoped variant', () => {
    const embed =
      'https://calendar.google.com/calendar/u/0/embed?src=' + encodeURIComponent(CAL_ID);
    expect(normalizeFeedUrl(embed)).toBe(ICS);
  });

  it('uses the first src when several are present', () => {
    const embed =
      'https://calendar.google.com/calendar/embed?src=' +
      encodeURIComponent(CAL_ID) +
      '&src=' +
      encodeURIComponent('en.greek%23holiday@group.v.calendar.google.com');
    expect(normalizeFeedUrl(embed)).toBe(ICS);
  });

  it('decodes a cid share link to the public ICS feed', () => {
    const cid = btoa(CAL_ID);
    const link = 'https://calendar.google.com/calendar/u/0?cid=' + encodeURIComponent(cid);
    expect(normalizeFeedUrl(link)).toBe(ICS);
  });

  it('leaves an already-ICS Google feed URL unchanged', () => {
    expect(normalizeFeedUrl(ICS)).toBe(ICS);
  });

  it('leaves non-Google feed URLs unchanged', () => {
    const ical = 'https://p01-calendars.icloud.com/published/2/abcDEF123.ics';
    expect(normalizeFeedUrl(ical)).toBe(ical);
  });

  it('trims surrounding whitespace', () => {
    const embed =
      '  https://calendar.google.com/calendar/embed?src=' + encodeURIComponent(CAL_ID) + '  ';
    expect(normalizeFeedUrl(embed)).toBe(ICS);
  });

  it('returns non-URL input unchanged without throwing', () => {
    expect(normalizeFeedUrl('not a url')).toBe('not a url');
    expect(normalizeFeedUrl('  spaced  ')).toBe('spaced');
  });

  it('leaves a Google embed URL without a usable id unchanged', () => {
    const noId = 'https://calendar.google.com/calendar/embed';
    expect(normalizeFeedUrl(noId)).toBe(noId);
  });
});

describe('isGoogleCalendarFeed', () => {
  it('recognizes a Google iCal feed URL', () => {
    expect(isGoogleCalendarFeed(ICS)).toBe(true);
  });

  it('ignores a Google embed (non-feed) URL', () => {
    const embed =
      'https://calendar.google.com/calendar/embed?src=' + encodeURIComponent(CAL_ID);
    expect(isGoogleCalendarFeed(embed)).toBe(false);
  });

  it('ignores non-Google feed URLs', () => {
    expect(
      isGoogleCalendarFeed('https://p01-calendars.icloud.com/published/2/abc.ics'),
    ).toBe(false);
  });

  it('returns false for non-URL input without throwing', () => {
    expect(isGoogleCalendarFeed('not a url')).toBe(false);
  });
});
