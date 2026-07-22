import { describe, it, expect } from 'vitest';
import { swatchHatch } from './blocking';

describe('swatchHatch', () => {
  it('is none unless blocking is global/local', () => {
    expect(swatchHatch('none', 'bold')).toBe('none');
    expect(swatchHatch('off', 'bold')).toBe('none');
    expect(swatchHatch('global', 'bold')).toBe('thick');
    expect(swatchHatch('local', 'bold')).toBe('thick');
  });

  it('picks density from the style when blocking is on', () => {
    expect(swatchHatch('global', undefined)).toBe('thick');
    expect(swatchHatch('global', 'none')).toBe('thick');
    expect(swatchHatch('global', 'outline')).toBe('thick');
    expect(swatchHatch('global', 'inverted')).toBe('thick');
    expect(swatchHatch('local', 'dashed')).toBe('thin');
    expect(swatchHatch('local', 'muted')).toBe('thin');
    expect(swatchHatch('global', 'striked')).toBe('none');
    expect(swatchHatch('global', 'hidden')).toBe('none');
  });
});
