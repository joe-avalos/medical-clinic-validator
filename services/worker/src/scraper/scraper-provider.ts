import type { RawCompanyRecord } from '@medical-validator/shared';
import { MockScraperProvider } from './mock-provider.js';
import { OCApiProvider } from './oc-api-provider.js';
import { OpenCorporatesProvider } from './opencorporates.js';

export interface ScraperProvider {
  search(name: string, jurisdiction?: string): Promise<RawCompanyRecord[]>;
  cleanup?(): Promise<void>;
}

type ProviderType = 'mock' | 'opencorporates-api' | 'opencorporates';

export function createScraperProvider(type?: ProviderType): ScraperProvider {
  const provider = type ?? (process.env.SCRAPER_PROVIDER as ProviderType | undefined) ?? 'opencorporates-api';

  switch (provider) {
    case 'mock':
      return new MockScraperProvider();
    case 'opencorporates-api':
      return new OCApiProvider();
    case 'opencorporates':
      return new OpenCorporatesProvider();
    default:
      throw new Error(`Unknown scraper provider: ${provider}`);
  }
}