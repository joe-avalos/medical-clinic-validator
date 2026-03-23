import { describe, it, expect, afterEach, vi } from 'vitest';

describe('createScraperProvider', () => {
  const originalEnv = process.env.SCRAPER_PROVIDER;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SCRAPER_PROVIDER = originalEnv;
    } else {
      delete process.env.SCRAPER_PROVIDER;
    }
    vi.resetModules();
  });

  it('defaults to opencorporates-api provider', async () => {
    delete process.env.SCRAPER_PROVIDER;
    const { createScraperProvider } = await import('../scraper-provider.js');
    const provider = createScraperProvider();
    expect(provider).toBeDefined();
    expect(provider.search).toBeTypeOf('function');
  });

  it('creates mock provider when SCRAPER_PROVIDER=mock', async () => {
    process.env.SCRAPER_PROVIDER = 'mock';
    const { createScraperProvider } = await import('../scraper-provider.js');
    const provider = createScraperProvider();
    expect(provider).toBeDefined();
    expect(provider.search).toBeTypeOf('function');
  });

  it('creates opencorporates provider when SCRAPER_PROVIDER=opencorporates', async () => {
    process.env.SCRAPER_PROVIDER = 'opencorporates';
    const { createScraperProvider } = await import('../scraper-provider.js');
    const provider = createScraperProvider();
    expect(provider).toBeDefined();
    expect(provider.search).toBeTypeOf('function');
    expect(provider.cleanup).toBeTypeOf('function');
  });

  it('throws on unknown provider type', async () => {
    process.env.SCRAPER_PROVIDER = 'google';
    const { createScraperProvider } = await import('../scraper-provider.js');
    expect(() => createScraperProvider()).toThrow('Unknown scraper provider: google');
  });
});