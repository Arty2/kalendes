import { describe, it, expect } from 'vitest';
import { guessTimezoneFromName } from './tz-guess';

describe('guessTimezoneFromName', () => {
  it('matches Athens / Greek calendars', () => {
    expect(guessTimezoneFromName('Greek Bank Holidays')).toBe('Europe/Athens');
    expect(guessTimezoneFromName('Athens Conferences')).toBe('Europe/Athens');
  });

  it('matches USA / New York calendars', () => {
    expect(guessTimezoneFromName('USA Bank Holidays')).toBe('America/New_York');
    expect(guessTimezoneFromName('Office NYC')).toBe('America/New_York');
  });

  it('matches London / UK', () => {
    expect(guessTimezoneFromName('London office')).toBe('Europe/London');
    expect(guessTimezoneFromName('UK Holidays')).toBe('Europe/London');
  });

  it('matches Tokyo / Japan', () => {
    expect(guessTimezoneFromName('Tokyo Sprints')).toBe('Asia/Tokyo');
    expect(guessTimezoneFromName('Japan Holidays')).toBe('Asia/Tokyo');
  });

  it('returns null for non-geographic names', () => {
    expect(guessTimezoneFromName("Mom's birthdays")).toBeNull();
    expect(guessTimezoneFromName('Foo')).toBeNull();
    expect(guessTimezoneFromName('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(guessTimezoneFromName('PARIS Office')).toBe('Europe/Paris');
  });
});
