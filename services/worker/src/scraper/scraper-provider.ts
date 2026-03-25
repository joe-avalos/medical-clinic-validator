import type { RawCompanyRecord } from '@medical-validator/shared';
import { MockScraperProvider } from './mock-provider.js';
import { OCApiProvider } from './oc-api-provider.js';
import { OpenCorporatesProvider } from './opencorporates.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('scraper-provider');

export interface ScrapeStats {
  attempts: number;
  errors: string[];
}

export interface ScraperProvider {
  readonly providerName: ProviderType;
  lastScrapeStats: ScrapeStats | null;
  search(name: string, jurisdiction?: string): Promise<RawCompanyRecord[]>;
  cleanup?(): Promise<void>;
}

export type ProviderType = 'mock' | 'opencorporates-api' | 'opencorporates';

export function createScraperProvider(type?: ProviderType): ScraperProvider {
  const envRaw = process.env.SCRAPER_PROVIDER;
  const resolved = type ?? (envRaw as ProviderType | undefined) ?? 'opencorporates-api';

  log.info(
    { requested: type ?? null, envVar: envRaw ?? '(unset)', resolved },
    'Creating scraper provider',
  );

  let provider: ScraperProvider;
  const common = { lastScrapeStats: null };
  switch (resolved) {
    case 'mock':
      provider = Object.assign(new MockScraperProvider(), { providerName: 'mock' as const, ...common });
      break;
    case 'opencorporates-api':
      provider = Object.assign(new OCApiProvider(), { providerName: 'opencorporates-api' as const, ...common });
      break;
    case 'opencorporates':
      provider = Object.assign(new OpenCorporatesProvider(), { providerName: 'opencorporates' as const, ...common });
      break;
    default:
      throw new Error(`Unknown scraper provider: ${resolved}`);
  }

  log.info({ providerName: provider.providerName }, 'Scraper provider created');
  return provider;
}