import { describe, it, expect } from 'vitest';
import { normalizeCompanyName } from '../normalize.js';

describe('normalizeCompanyName', () => {
  it('lowercases the name', () => {
    expect(normalizeCompanyName('Mayo Health System')).toBe('mayo health system');
  });

  it('trims whitespace', () => {
    expect(normalizeCompanyName('  Mayo Health System  ')).toBe('mayo health system');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeCompanyName('Mayo   Health   System')).toBe('mayo health system');
  });

  it('strips punctuation', () => {
    expect(normalizeCompanyName('Mayo Health System, Inc.')).toBe('mayo health system inc');
  });

  it('preserves hyphens', () => {
    expect(normalizeCompanyName('Albert Lea Medical Center - Mayo')).toBe(
      'albert lea medical center - mayo',
    );
  });

  it('handles empty string', () => {
    expect(normalizeCompanyName('')).toBe('');
  });

  it('handles already normalized name', () => {
    expect(normalizeCompanyName('mayo health system')).toBe('mayo health system');
  });
});
