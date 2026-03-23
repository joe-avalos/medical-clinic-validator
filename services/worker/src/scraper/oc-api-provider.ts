import type { RawCompanyRecord } from '@medical-validator/shared';
import type { ScraperProvider } from './scraper-provider.js';

const OC_API_BASE = process.env.OC_API_BASE_URL || 'https://api.opencorporates.com';
const OC_API_TOKEN = process.env.OC_API_TOKEN || '';

interface OCCompany {
  name: string;
  company_number: string;
  jurisdiction_code: string;
  current_status: string;
  incorporation_date: string | null;
  registered_address_in_full: string | null;
  opencorporates_url: string;
  [key: string]: unknown;
}

export class OCApiProvider implements ScraperProvider {
  async search(name: string, jurisdiction?: string): Promise<RawCompanyRecord[]> {
    const params = new URLSearchParams({ q: name });
    if (jurisdiction) params.set('jurisdiction_code', jurisdiction);
    if (OC_API_TOKEN) params.set('api_token', OC_API_TOKEN);

    const url = `${OC_API_BASE}/v0.4/companies/search?${params.toString()}`;
    console.log(`[oc-api] Fetching ${url.replace(OC_API_TOKEN, '***')}`);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`OpenCorporates API returned ${res.status}: ${res.statusText}`);
    }

    const json = await res.json() as {
      results: { companies: Array<{ company: OCCompany }> };
    };

    const companies = json.results.companies;

    return companies.map(({ company }) => ({
      companyNumber: company.company_number,
      name: company.name,
      jurisdiction: company.jurisdiction_code,
      status: company.current_status || 'unknown',
      incorporationDate: company.incorporation_date ?? undefined,
      address: company.registered_address_in_full ?? undefined,
      openCorporatesUrl: company.opencorporates_url,
      rawApiSnapshot: company,
    }));
  }
}