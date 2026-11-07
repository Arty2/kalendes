import { formatPlace, localeOf, parsePlace, placeGroup, placeKey, writePlace } from './place';

describe('parsePlace', () => {
  it('reads Space, Venue (Locale)', () => {
    expect(parsePlace('Main Stage, Music Hall (Athens)')).toEqual({ space: 'Main Stage', venue: 'Music Hall', locale: 'Athens' });
  });

  it('splits at , – / · and keeps the space as written', () => {
    expect(parsePlace('Room 4 / Floor 2 – Music Hall')).toEqual({ space: 'Room 4 / Floor 2', venue: 'Music Hall', locale: '' });
    expect(parsePlace('Stage · Hall (Patras)')).toEqual({ space: 'Stage', venue: 'Hall', locale: 'Patras' });
    expect(parsePlace('Stage, Hall, (Patras)')).toEqual({ space: 'Stage', venue: 'Hall', locale: 'Patras' });
    // A plain hyphen is part of a name.
    expect(parsePlace('Saint-Denis')).toEqual({ space: '', venue: 'Saint-Denis', locale: '' });
  });

  it('takes the locale only from the last, outermost brackets at the very end', () => {
    expect(localeOf('Room 2 (Upper) (Harbour Hall)')).toBe('Harbour Hall');
    expect(parsePlace('Room 2 (Upper) (Harbour Hall)').venue).toBe('Room 2 (Upper)');
    expect(localeOf('Yard (Mill (East Wing))')).toBe('Mill (East Wing)');
    expect(localeOf('  Loft  (Harbour Hall)  ')).toBe('Harbour Hall');
    expect(localeOf('Room (Harbour Hall) annex')).toBe('');
    expect(localeOf('Room )Hall)')).toBe('');
    expect(localeOf('Room ()')).toBe('');
    expect(localeOf('Harbour Hall')).toBe('');
  });

  it('reads a bare locale and an empty location', () => {
    expect(parsePlace('(Athens)')).toEqual({ space: '', venue: '', locale: 'Athens' });
    expect(parsePlace('')).toEqual({ space: '', venue: '', locale: '' });
  });
});

describe('formatPlace / writePlace', () => {
  it('leaves out missing parts and names a locale equal to the venue once', () => {
    expect(formatPlace({ space: 'Main Stage', venue: 'Music Hall', locale: 'Athens' })).toBe('Main Stage, Music Hall (Athens)');
    expect(formatPlace({ space: '', venue: '', locale: 'Athens' })).toBe('Athens');
    expect(formatPlace({ space: '', venue: 'Delphi', locale: 'delphi' })).toBe('Delphi');
    expect(formatPlace({ space: '', venue: 'Music Hall', locale: '' })).toBe('Music Hall');
  });

  it('shows a location as written, but for those two cases', () => {
    expect(writePlace('(Athens)')).toBe('Athens');
    expect(writePlace('Delphi (Delphi)')).toBe('Delphi');
    expect(writePlace('Theatre / Delphi (Delphi)')).toBe('Theatre / Delphi');
    const same = 'Main Stage, Music Hall (Athens)';
    expect(writePlace(same)).toBe(same);
    expect(writePlace('Stage – Hall')).toBe('Stage – Hall');
  });
});

describe('placeGroup', () => {
  it('groups by Venue (Locale) or by locale, each falling back to the other', () => {
    expect(placeGroup('Main Stage, Music Hall (Athens)', 'venue')).toBe('Music Hall (Athens)');
    expect(placeGroup('Main Stage, Music Hall (Athens)', 'locale')).toBe('Athens');
    expect(placeGroup('Delphi', 'locale')).toBe('Delphi');
    expect(placeGroup('(Athens)', 'venue')).toBe('Athens');
    expect(placeGroup('', 'venue')).toBe('');
  });

  it('keys trimmed, case-folded text', () => {
    expect(placeKey('  Room   A ')).toBe('room a');
  });
});
