import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RawCompanyRecordSchema } from '@medical-validator/shared';

// Mock logger
vi.mock('../../shared/logger.js', () => {
  const noop = vi.fn();
  const childLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => childLogger };
  return { createLogger: () => childLogger };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function buildApiResponse(companies: Array<Record<string, unknown>>) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      results: {
        companies: companies.map((c) => ({ company: c })),
      },
    }),
  };
}

const SAMPLE_OC_COMPANY = {
  name: 'MAYO HEALTH SYSTEM',
  company_number: '0f23674b',
  jurisdiction_code: 'us_mn',
  current_status: 'Active',
  incorporation_date: '1905-12-13',
  registered_address_in_full: '211 S Newton, Albert Lea, MN, 56007',
  opencorporates_url: 'https://opencorporates.com/companies/us_mn/0f23674b',
};

describe('OCApiProvider', () => {
  let OCApiProvider: any;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    const mod = await import('../oc-api-provider.js');
    OCApiProvider = mod.OCApiProvider;
  });

  it('maps API response to RawCompanyRecord', async () => {
    mockFetch.mockResolvedValue(buildApiResponse([SAMPLE_OC_COMPANY]));

    const provider = new OCApiProvider();
    const results = await provider.search('mayo health system');

    expect(results.length).toBe(1);
    expect(results[0].companyNumber).toBe('0f23674b');
    expect(results[0].name).toBe('MAYO HEALTH SYSTEM');
    expect(results[0].jurisdiction).toBe('us_mn');
    expect(results[0].status).toBe('Active');
    expect(results[0].incorporationDate).toBe('1905-12-13');
    expect(results[0].address).toBe('211 S Newton, Albert Lea, MN, 56007');
    expect(results[0].openCorporatesUrl).toContain('opencorporates.com');
    expect(results[0].rawApiSnapshot).toEqual(SAMPLE_OC_COMPANY);
  });

  it('conforms to RawCompanyRecordSchema', async () => {
    mockFetch.mockResolvedValue(buildApiResponse([SAMPLE_OC_COMPANY]));

    const provider = new OCApiProvider();
    const results = await provider.search('mayo');

    for (const record of results) {
      expect(() => RawCompanyRecordSchema.parse(record)).not.toThrow();
    }
  });

  it('passes jurisdiction as query param when provided', async () => {
    mockFetch.mockResolvedValue(buildApiResponse([]));

    const provider = new OCApiProvider();
    await provider.search('test', 'us_mn');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('jurisdiction_code=us_mn');
  });

  it('omits jurisdiction param when not provided', async () => {
    mockFetch.mockResolvedValue(buildApiResponse([]));

    const provider = new OCApiProvider();
    await provider.search('test');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('jurisdiction_code');
  });

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    const provider = new OCApiProvider();
    await expect(provider.search('test')).rejects.toThrow('429');
  });

  it('returns all results without capping', async () => {
    const sixCompanies = Array.from({ length: 6 }, (_, i) => ({
      ...SAMPLE_OC_COMPANY,
      company_number: `co-${i}`,
      name: `Company ${i}`,
    }));
    mockFetch.mockResolvedValue(buildApiResponse(sixCompanies));

    const provider = new OCApiProvider();
    const results = await provider.search('test');
    expect(results.length).toBe(6);
  });
});