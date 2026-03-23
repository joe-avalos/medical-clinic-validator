import * as cheerio from 'cheerio';
import type { RawCompanyRecord } from '@medical-validator/shared';
import { parseOCDate } from './parse-date.js';

const MAX_RESULTS = 5;
const OC_BASE = 'https://opencorporates.com';
const STATUS_CLASSES = ['active', 'inactive', 'dissolved', 'suspended', 'terminated', 'merged'];

/**
 * Parses OpenCorporates /companies search results HTML into structured records.
 */
export function parseSearchResults(html: string): RawCompanyRecord[] {
  const $ = cheerio.load(html);
  const records: RawCompanyRecord[] = [];

  $('ul#companies > li.search-result').each((i, el) => {
    if (i >= MAX_RESULTS) return false;

    const $el = $(el);
    const $link = $el.find('a.company_search_result');

    const href = $link.attr('href') || '';
    const segments = href.split('/').filter(Boolean);
    // href = /companies/<jurisdiction>/<companyNumber>
    const jurisdiction = segments[1] || '';
    const companyNumber = segments[2] || '';
    const name = $link.text().trim();

    // Status from li class names
    const classes = ($el.attr('class') || '').split(/\s+/);
    const statusFromClass = classes.find((c) => STATUS_CLASSES.includes(c)) || 'unknown';

    // Status labels
    const statusLabels = $el
      .find('span.status.label')
      .map((_, s) => $(s).text().trim())
      .get();

    // Dates
    const startDateRaw = $el.find('span.start_date').first().text().trim() || null;
    const endDateRaw = $el.find('span.end_date').first().text().trim() || null;

    // Address — text content excluding nested <a> tags
    const $address = $el.find('span.address').first();
    let address: string | undefined;
    if ($address.length) {
      $address.find('a').remove();
      address = $address.text().trim() || undefined;
    }

    // Previous names
    const previousNames = $el.find('span.slight_highlight').first().text().trim() || null;

    const record: RawCompanyRecord = {
      companyNumber,
      name,
      jurisdiction,
      status: statusFromClass,
      incorporationDate: parseOCDate(startDateRaw),
      address,
      openCorporatesUrl: `${OC_BASE}${href}`,
      rawApiSnapshot: {
        classes,
        statusLabels,
        startDate: startDateRaw,
        endDate: endDateRaw,
        previousNames,
        rawHtml: $.html($el),
      },
    };

    records.push(record);
  });

  return records;
}
