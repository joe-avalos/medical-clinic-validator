import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSearchResults } from '../clients/opencorporates-parser.js';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

describe('parseSearchResults', () => {
  describe('full results page', () => {
    const results = parseSearchResults(fixture('search-results.html'));

    it('extracts all search result items', () => {
      expect(results).toHaveLength(3);
    });

    it('extracts company name from anchor text', () => {
      expect(results[0].name).toBe('MAYO HEALTH SYSTEM');
      expect(results[1].name).toBe('ALBERT LEA MEDICAL CENTER - MAYO HEALTH SYSTEM');
    });

    it('extracts company number from href (last path segment)', () => {
      expect(results[0].companyNumber).toBe('0f23674b-1234');
      expect(results[1].companyNumber).toBe('abcd5678-9999');
    });

    it('extracts jurisdiction from href (second path segment)', () => {
      expect(results[0].jurisdiction).toBe('us_mn');
      expect(results[1].jurisdiction).toBe('us_mn');
      expect(results[2].jurisdiction).toBe('us_fl');
    });

    it('builds full OpenCorporates URL from href', () => {
      expect(results[0].openCorporatesUrl).toBe(
        'https://opencorporates.com/companies/us_mn/0f23674b-1234',
      );
    });

    it('extracts status from li class names', () => {
      expect(results[0].status).toBe('active');
      expect(results[1].status).toBe('inactive');
    });

    it('parses incorporation date to ISO 8601', () => {
      expect(results[0].incorporationDate).toBe('1905-12-13');
      expect(results[1].incorporationDate).toBe('1919-01-01');
      expect(results[2].incorporationDate).toBe('1986-08-22');
    });

    it('extracts address without map link text', () => {
      expect(results[0].address).toBe('211 S Newton, Albert Lea, MN, 56007');
    });

    it('includes rawApiSnapshot with audit data', () => {
      const snapshot = results[1].rawApiSnapshot;
      expect(snapshot).toHaveProperty('classes');
      expect(snapshot).toHaveProperty('statusLabels');
      expect(snapshot).toHaveProperty('startDate', '1 Jan 1919');
      expect(snapshot).toHaveProperty('endDate', '15 Mar 2020');
      expect(snapshot).toHaveProperty('previousNames', 'Previously: MAYO CLINIC ALBERT LEA');
    });

    it('includes rawHtml in snapshot for audit trail', () => {
      expect(results[0].rawApiSnapshot).toHaveProperty('rawHtml');
      expect(typeof results[0].rawApiSnapshot.rawHtml).toBe('string');
    });
  });

  describe('empty results page', () => {
    it('returns empty array when no results found', () => {
      const results = parseSearchResults(fixture('empty-results.html'));
      expect(results).toEqual([]);
    });
  });

  describe('partial data', () => {
    const results = parseSearchResults(fixture('partial-results.html'));

    it('handles missing status gracefully', () => {
      // First result has no status class beyond default "search-result company"
      expect(results[0].status).toBe('unknown');
    });

    it('handles missing address', () => {
      expect(results[0].address).toBeUndefined();
    });

    it('handles missing incorporation date', () => {
      expect(results[0].incorporationDate).toBeUndefined();
    });

    it('extracts dissolved status from li class', () => {
      expect(results[1].status).toBe('dissolved');
    });
  });

  describe('result limit', () => {
    it('returns at most 5 results', () => {
      // Build HTML with 8 results
      const items = Array.from({ length: 8 }, (_, i) =>
        `<li class="search-result company active">
          <a class="company_search_result" href="/companies/us_mn/company-${i}">Company ${i}</a>
          <span class="status label">active</span>
        </li>`
      ).join('\n');
      const html = `<ul id="companies">${items}</ul>`;

      const results = parseSearchResults(html);
      expect(results).toHaveLength(5);
    });
  });
});
