import { describe, it, expect, afterEach, vi } from 'vitest';
import { RawCompanyRecordSchema } from '@medical-validator/shared';

// Mock logger
vi.mock('../../shared/logger.js', () => {
  const noop = vi.fn();
  const childLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => childLogger };
  return { createLogger: () => childLogger };
});

import { MockScraperProvider } from '../mock-provider.js';

describe('MockScraperProvider', () => {
  const originalScenario = process.env.MOCK_SCRAPER_SCENARIO;

  afterEach(() => {
    if (originalScenario !== undefined) {
      process.env.MOCK_SCRAPER_SCENARIO = originalScenario;
    } else {
      delete process.env.MOCK_SCRAPER_SCENARIO;
    }
  });

  it('returns default fixture for unknown names', async () => {
    delete process.env.MOCK_SCRAPER_SCENARIO;
    const provider = new MockScraperProvider();
    const results = await provider.search('acme health corp');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('MAYO HEALTH SYSTEM');
  });

  it('returns empty array for empty scenario', async () => {
    process.env.MOCK_SCRAPER_SCENARIO = 'empty';
    const provider = new MockScraperProvider();
    const results = await provider.search('anything');
    expect(results).toEqual([]);
  });

  it('returns dissolved fixture for dissolved scenario', async () => {
    process.env.MOCK_SCRAPER_SCENARIO = 'dissolved';
    const provider = new MockScraperProvider();
    const results = await provider.search('anything');
    expect(results.length).toBe(1);
    expect(results[0].status).toBe('dissolved');
  });

  it('returns multi results via name pattern matching', async () => {
    delete process.env.MOCK_SCRAPER_SCENARIO;
    const provider = new MockScraperProvider();
    const results = await provider.search('mayo health system');
    expect(results.length).toBe(3);
  });

  it('returns records conforming to RawCompanyRecordSchema', async () => {
    delete process.env.MOCK_SCRAPER_SCENARIO;
    const provider = new MockScraperProvider();
    const results = await provider.search('mayo health system');
    for (const record of results) {
      expect(() => RawCompanyRecordSchema.parse(record)).not.toThrow();
    }
  });
});