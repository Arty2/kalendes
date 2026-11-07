import { formatPlace, parsePlace, placeGroup, placeKey, writePlace } from './place';

describe('parsePlace', () => {
  it('reads Space, Venue (Locale)', () => {
    expect(parsePlace('Main Stage, Music Hall (Athens)')).toEqual({ space: 'Main Stage', venue: 'Music Hall', locale: 'Athens' });
  });

  it('splits a hyphen or en dash only with spaces around it', () => {
    expect(parsePlace('Stage – Hall')).toEqual({ space: 'Stage', venue: 'Hall', locale: '' });
    expect(parsePlace('Hall 2–3, Annex')).toEqual({ space: 'Hall 2–3', venue: 'Annex', locale: '' });
    expect(parsePlace('Saint-Denis - Stade (Paris)')).toEqual({ space: 'Saint-Denis', venue: 'Stade', locale: 'Paris' });
    expect(parsePlace('Stage –Hall')).toEqual({ space: '', venue: 'Stage –Hall', locale: '' });
    expect(parsePlace('– Hall')).toEqual({ space: '', venue: 'Hall', locale: '' });
  });

  it('splits at , spaced – / · and keeps the space as written', () => {
    expect(parsePlace('Room 4 / Floor 2 – Music Hall')).toEqual({ space: 'Room 4 / Floor 2', venue: 'Music Hall', locale: '' });
    expect(parsePlace('Stage · Hall (Patras)')).toEqual({ space: 'Stage', venue: 'Hall', locale: 'Patras' });
    expect(parsePlace('Stage, Hall, (Patras)')).toEqual({ space: 'Stage', venue: 'Hall', locale: 'Patras' });
    // A plain hyphen is part of a name.
    expect(parsePlace('Saint-Denis')).toEqual({ space: '', venue: 'Saint-Denis', locale: '' });
  });

  it('keeps a tight comma, slash or middle dot in a name', () => {
    expect(parsePlace('Hall 1,2, Music Hall (Athens)')).toEqual({ space: 'Hall 1,2', venue: 'Music Hall', locale: 'Athens' });
    expect(parsePlace('Hall 1,2 (Athens)')).toEqual({ space: '', venue: 'Hall 1,2', locale: 'Athens' });
    expect(parsePlace('Upper/Lower Foyer, Hall')).toEqual({ space: 'Upper/Lower Foyer', venue: 'Hall', locale: '' });
    expect(parsePlace('Studio·A / Hall')).toEqual({ space: 'Studio·A', venue: 'Hall', locale: '' });
    expect(placeGroup('Hall 1,2 (Athens)', 'venue')).toBe('Hall 1,2 (Athens)');
    expect(writePlace('Hall 1,2, Music Hall (Athens)')).toBe('Hall 1,2, Music Hall (Athens)');
  });

  it('ignores empty parts', () => {
    expect(parsePlace('Main Stage, - Music Hall (Athens)')).toEqual({ space: 'Main Stage', venue: 'Music Hall', locale: 'Athens' });
    expect(parsePlace('A, , B · / Hall')).toEqual({ space: 'A, B', venue: 'Hall', locale: '' });
    expect(parsePlace(', Hall,')).toEqual({ space: '', venue: 'Hall', locale: '' });
    expect(parsePlace(' , – ')).toEqual({ space: '', venue: '', locale: '' });
    expect(parsePlace(', (Athens)')).toEqual({ space: '', venue: '', locale: 'Athens' });
    // A spaced hyphen splits too; an em dash as well.
    expect(parsePlace('Stage - Hall')).toEqual({ space: 'Stage', venue: 'Hall', locale: '' });
    expect(parsePlace('Stage — Hall')).toEqual({ space: 'Stage', venue: 'Hall', locale: '' });
  });

  it('takes the locale only from the last, outermost brackets at the very end', () => {
    expect(parsePlace('Room 2 (Upper) (Harbour Hall)').locale).toBe('Harbour Hall');
    expect(parsePlace('Room 2 (Upper) (Harbour Hall)').venue).toBe('Room 2 (Upper)');
    expect(parsePlace('Yard (Mill (East Wing))').locale).toBe('Mill (East Wing)');
    expect(parsePlace('  Loft  (Harbour Hall)  ').locale).toBe('Harbour Hall');
    expect(parsePlace('Room (Harbour Hall) annex').locale).toBe('');
    expect(parsePlace('Room )Hall)').locale).toBe('');
    expect(parsePlace('Room ()').locale).toBe('');
    expect(parsePlace('Harbour Hall').locale).toBe('');
  });

  it('keeps brackets and web addresses whole', () => {
    expect(parsePlace('Room 2 (Upper/Lower) (Harbour Hall)')).toEqual({ space: '', venue: 'Room 2 (Upper/Lower)', locale: 'Harbour Hall' });
    expect(parsePlace('https://zoom.us/j/123')).toEqual({ space: '', venue: 'https://zoom.us/j/123', locale: '' });
    expect(writePlace('https://zoom.us/j/123')).toBe('https://zoom.us/j/123');
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

  it('drops empty parts when showing a location', () => {
    expect(writePlace('Main Stage, - Music Hall (Athens)')).toBe('Main Stage, Music Hall (Athens)');
    expect(writePlace('Stage / , Hall')).toBe('Stage / Hall');
    expect(writePlace(', Hall,')).toBe('Hall');
    expect(writePlace(', (Athens)')).toBe('Athens');
    expect(writePlace(' , – ')).toBe('');
    expect(writePlace('Theatre, , Delphi (Delphi)')).toBe('Theatre, Delphi');
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
