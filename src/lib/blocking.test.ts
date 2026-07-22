import { describe, it, expect } from 'vitest';
import { swatchHatch } from './blocking';

describe('swatchHatch', () => {
  it('is none unless blocking is global/local', () => {
    expect(swatchHatch('none', 'bold')).toBe('none');
    expect(swatchHatch('off', 'bold')).toBe('none');
  });

  it('encodes the block scope: global → thick, local → thin (regardless of style)', () => {
    expect(swatchHatch('global', undefined)).toBe('thick');
    expect(swatchHatch('global', 'none')).toBe('thick');
    expect(swatchHatch('global', 'bold')).toBe('thick');
    expect(swatchHatch('global', 'dashed')).toBe('thick');
    expect(swatchHatch('local', undefined)).toBe('thin');
    expect(swatchHatch('local', 'bold')).toBe('thin');
    expect(swatchHatch('local', 'muted')).toBe('thin');
  });

  it('never hatches for struck/hidden styles, even when blocking is on', () => {
    expect(swatchHatch('global', 'striked')).toBe('none');
    expect(swatchHatch('global', 'hidden')).toBe('none');
    expect(swatchHatch('local', 'striked')).toBe('none');
    expect(swatchHatch('local', 'hidden')).toBe('none');
  });
});
