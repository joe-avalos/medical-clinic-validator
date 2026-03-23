import { describe, it, expect } from 'vitest';
import { parseOCDate } from '../parse-date.js';

describe('parseOCDate', () => {
  it('parses "13 Dec 1905" to ISO date', () => {
    expect(parseOCDate('13 Dec 1905')).toBe('1905-12-13');
  });

  it('parses "1 Jan 1919" (single-digit day)', () => {
    expect(parseOCDate('1 Jan 1919')).toBe('1919-01-01');
  });

  it('parses "22 Aug 1986"', () => {
    expect(parseOCDate('22 Aug 1986')).toBe('1986-08-22');
  });

  it('parses "15 Mar 2020"', () => {
    expect(parseOCDate('15 Mar 2020')).toBe('2020-03-15');
  });

  it('parses "5 Jun 2010" (single-digit day)', () => {
    expect(parseOCDate('5 Jun 2010')).toBe('2010-06-05');
  });

  it('parses "30 Nov 2022"', () => {
    expect(parseOCDate('30 Nov 2022')).toBe('2022-11-30');
  });

  it('returns undefined for empty string', () => {
    expect(parseOCDate('')).toBeUndefined();
  });

  it('returns undefined for null/undefined input', () => {
    expect(parseOCDate(undefined)).toBeUndefined();
    expect(parseOCDate(null as unknown as string)).toBeUndefined();
  });

  it('returns undefined for unparseable date', () => {
    expect(parseOCDate('not a date')).toBeUndefined();
  });

  it('handles all 12 months', () => {
    const months = [
      ['Jan', '01'], ['Feb', '02'], ['Mar', '03'], ['Apr', '04'],
      ['May', '05'], ['Jun', '06'], ['Jul', '07'], ['Aug', '08'],
      ['Sep', '09'], ['Oct', '10'], ['Nov', '11'], ['Dec', '12'],
    ] as const;

    for (const [abbr, num] of months) {
      expect(parseOCDate(`1 ${abbr} 2000`)).toBe(`2000-${num}-01`);
    }
  });
});
