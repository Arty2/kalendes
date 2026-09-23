import { detectFeedCategory, nextIncrementalName } from './feed-form';

describe('detectFeedCategory', () => {
  it('reads the type from the name, first match wins', () => {
    expect(detectFeedCategory('Greek Holidays')).toBe('holidays');
    expect(detectFeedCategory('Observances')).toBe('observances');
    expect(detectFeedCategory('Company news')).toBe('announcements');
    expect(detectFeedCategory('Birthdays')).toBe('guests');
    expect(detectFeedCategory('Flights')).toBe('travel-international');
    expect(detectFeedCategory('Domestic')).toBe('travel-local');
    expect(detectFeedCategory('Team calendar')).toBe('events');
    expect(detectFeedCategory('Holiday calendar')).toBe('holidays');
  });

  it('is none when nothing matches', () => {
    expect(detectFeedCategory('Alice')).toBe('none');
    expect(detectFeedCategory('')).toBe('none');
  });
});

describe('nextIncrementalName', () => {
  it('takes the first free number', () => {
    expect(nextIncrementalName('Calendar', [])).toBe('Calendar 1');
    expect(nextIncrementalName('Calendar', ['Calendar 1', 'Calendar 3'])).toBe('Calendar 2');
  });
});
