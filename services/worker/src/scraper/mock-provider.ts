import type { RawCompanyRecord } from '@medical-validator/shared';
import type { ScraperProvider } from './scraper-provider.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('mock-scraper');

const FIXTURES: Record<string, RawCompanyRecord[]> = {
  default: [
    {
      companyNumber: '0f23674b',
      name: 'MAYO HEALTH SYSTEM',
      jurisdiction: 'us_mn',
      status: 'active',
      incorporationDate: '1905-12-13',
      address: '211 S Newton, Albert Lea, MN, 56007',
      openCorporatesUrl: 'https://opencorporates.com/companies/us_mn/0f23674b',
      rawApiSnapshot: { source: 'mock', scenario: 'default' },
    },
  ],
  empty: [],
  dissolved: [
    {
      companyNumber: 'D9981234',
      name: 'SUNSET MEDICAL GROUP INC',
      jurisdiction: 'us_ca',
      status: 'dissolved',
      incorporationDate: '1998-06-15',
      address: '456 Palm Dr, Los Angeles, CA, 90001',
      openCorporatesUrl: 'https://opencorporates.com/companies/us_ca/D9981234',
      rawApiSnapshot: { source: 'mock', scenario: 'dissolved' },
    },
  ],
  multi: [
    {
      companyNumber: '0f23674b',
      name: 'MAYO HEALTH SYSTEM',
      jurisdiction: 'us_mn',
      status: 'active',
      incorporationDate: '1905-12-13',
      address: '211 S Newton, Albert Lea, MN, 56007',
      openCorporatesUrl: 'https://opencorporates.com/companies/us_mn/0f23674b',
      rawApiSnapshot: { source: 'mock', scenario: 'multi' },
    },
    {
      companyNumber: 'X1122334',
      name: 'MAYO CLINIC ROCHESTER',
      jurisdiction: 'us_mn',
      status: 'active',
      incorporationDate: '1919-01-01',
      address: '200 First St SW, Rochester, MN 55905',
      openCorporatesUrl: 'https://opencorporates.com/companies/us_mn/X1122334',
      rawApiSnapshot: { source: 'mock', scenario: 'multi' },
    },
    {
      companyNumber: 'Z5566778',
      name: 'MAYO HEALTH SERVICES LLC',
      jurisdiction: 'us_mn',
      status: 'inactive',
      incorporationDate: '2010-03-22',
      openCorporatesUrl: 'https://opencorporates.com/companies/us_mn/Z5566778',
      rawApiSnapshot: { source: 'mock', scenario: 'multi' },
    },
  ],
};

function resolveScenario(name: string): string {
  const scenario = process.env.MOCK_SCRAPER_SCENARIO;
  if (scenario && scenario in FIXTURES) return scenario;

  // Name-pattern fallback
  if (name.includes('dissolved') || name.includes('sunset')) return 'dissolved';
  if (name.includes('empty') || name.includes('nonexistent')) return 'empty';
  if (name.includes('multi') || name.includes('mayo')) return 'multi';

  return 'default';
}

export class MockScraperProvider implements ScraperProvider {
  async search(name: string, _jurisdiction?: string): Promise<RawCompanyRecord[]> {
    const scenario = resolveScenario(name);
    log.info({ scenario, name }, 'Returning mock fixture');
    return FIXTURES[scenario];
  }
}