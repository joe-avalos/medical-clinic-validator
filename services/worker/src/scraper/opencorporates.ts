import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page, CookieParam } from 'puppeteer';
import type { RawCompanyRecord } from '@medical-validator/shared';
import type { ScraperProvider, ScrapeStats } from './scraper-provider.js';
import { parseSearchResults } from './opencorporates-parser.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('scraper');

const puppeteer = puppeteerExtra as unknown as {
  use(plugin: unknown): void;
  launch(opts: Record<string, unknown>): Promise<Browser>;
};
puppeteer.use(StealthPlugin());

const OC_BASE = process.env.OC_BASE_URL || 'https://opencorporates.com';
const PAGE_TIMEOUT = Number(process.env.SCRAPER_PAGE_TIMEOUT_MS) || 15000;
const MAX_RETRIES = Number(process.env.SCRAPER_MAX_RETRIES) || 3;
const WORKER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COOKIES_PATH = join(WORKER_ROOT, process.env.OC_COOKIES_PATH || '.oc-cookies.json');

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, randomInt(500, 2000)));
}

function randomUserAgent(): string {
  return USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)];
}

export class OpenCorporatesProvider implements ScraperProvider {
  readonly providerName = 'opencorporates' as const;
  lastScrapeStats: ScrapeStats | null = null;
  private browser: Browser | null = null;
  private cookiesLoaded = false;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.connected) {
      const isHeadless = process.env.BROWSER_HEADLESS !== 'false';
      this.browser = await puppeteer.launch({
        headless: isHeadless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ...(isHeadless ? {} : { slowMo: 100 }),
      });
      this.cookiesLoaded = false;
    }
    return this.browser;
  }

  private loadCookiesFromFile(): CookieParam[] {
    try {
      const raw = readFileSync(COOKIES_PATH, 'utf-8');
      const cookies = JSON.parse(raw) as Array<{ name: string; value: string; domain: string; path?: string }>;
      const valid = cookies
        .filter((c) => typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string')
        // Puppeteer rejects cookies with empty or whitespace-only values
        .filter((c) => c.value.trim().length > 0)
        .map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
        }));
      log.info({ total: cookies.length, valid: valid.length, skipped: cookies.length - valid.length }, 'Cookies loaded from disk');
      return valid;
    } catch (err) {
      throw new Error(`STALE_COOKIES: Failed to load cookies from ${COOKIES_PATH} — refresh by running: npm run cookie:refresh`);
    }
  }

  private async injectCookies(page: Page, force = false): Promise<void> {
    if (this.cookiesLoaded && !force) return;
    const cookies = this.loadCookiesFromFile();
    await page.setCookie(...cookies);
    this.cookiesLoaded = true;
    log.info({ force, cookieCount: cookies.length }, 'Session cookies injected');
  }

  private buildSearchUrl(normalizedName: string, jurisdiction?: string): string {
    const params = new URLSearchParams({
      q: normalizedName,
      type: 'companies',
      utf8: '✓',
    });
    if (jurisdiction) {
      params.set('jurisdiction_code', jurisdiction);
    }
    return `${OC_BASE}/companies?${params.toString()}`;
  }

  async search(normalizedName: string, jurisdiction?: string): Promise<RawCompanyRecord[]> {
    const b = await this.getBrowser();
    const page = await b.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT);

    // Randomized fingerprint
    await page.setViewport({
      width: randomInt(1280, 1400),
      height: randomInt(700, 800),
    });
    await page.setUserAgent(randomUserAgent());

    try {
      const url = this.buildSearchUrl(normalizedName, jurisdiction);
      let lastError: Error | null = null;
      const stats: ScrapeStats = { attempts: 0, errors: [] };

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        stats.attempts = attempt;
        try {
          // Re-inject cookies on every attempt (re-reads from disk in case cookie:refresh ran)
          await this.injectCookies(page, attempt > 1);
          await randomDelay();

          log.info({ attempt, url: url.replace(/q=[^&]+/, 'q=***') }, 'Navigating to search page');
          await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });

          const finalUrl = page.url();
          const title = await page.evaluate(() => document.title);
          log.info({ attempt, finalUrl, title }, 'Page loaded');

          if (title.includes('403') || title.includes('Forbidden')) {
            throw new Error('Blocked by HAProxy (403 Forbidden)');
          }

          const hasCaptcha = await page.$('.g-recaptcha, [data-sitekey], #captcha');
          if (hasCaptcha) {
            throw new Error('STALE_COOKIES: CAPTCHA detected — refresh cookies by running: npm run cookie:refresh');
          }

          if (finalUrl.includes('/users/sign_in')) {
            throw new Error('STALE_COOKIES: Session expired — refresh cookies by running: npm run cookie:refresh');
          }

          const html = await page.content();
          const results = parseSearchResults(html);
          log.info({ attempt, resultsCount: results.length }, 'Parse complete');
          this.lastScrapeStats = stats;
          return results;
        } catch (err) {
          lastError = err as Error;
          stats.errors.push(lastError.message);
          const isStale = lastError.message.includes('STALE_COOKIES');
          log.warn(
            { attempt, maxRetries: MAX_RETRIES, err: lastError.message, isStale },
            'Scrape attempt failed',
          );
          if (isStale) {
            // Force cookie re-read from disk on next attempt
            this.cookiesLoaded = false;
          }
          if (attempt < MAX_RETRIES) {
            await randomDelay();
          }
        }
      }

      this.lastScrapeStats = stats;
      throw lastError || new Error('Scrape failed after retries');
    } finally {
      await page.close();
    }
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.cookiesLoaded = false;
    }
  }
}

// Backward-compat exports — delegates to a singleton instance
const _instance = new OpenCorporatesProvider();

export async function scrapeOpenCorporates(
  normalizedName: string,
  jurisdiction?: string,
): Promise<RawCompanyRecord[]> {
  return _instance.search(normalizedName, jurisdiction);
}

export async function closeBrowser(): Promise<void> {
  return _instance.cleanup();
}