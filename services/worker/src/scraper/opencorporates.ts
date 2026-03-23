import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page, CookieParam } from 'puppeteer';
import type { RawCompanyRecord } from '@medical-validator/shared';
import type { ScraperProvider } from './scraper-provider.js';
import { parseSearchResults } from './opencorporates-parser.js';

const puppeteer = puppeteerExtra as unknown as {
  use(plugin: unknown): void;
  launch(opts: Record<string, unknown>): Promise<Browser>;
};
puppeteer.use(StealthPlugin());

const OC_BASE = process.env.OC_BASE_URL || 'https://opencorporates.com';
const PAGE_TIMEOUT = Number(process.env.SCRAPER_PAGE_TIMEOUT_MS) || 15000;
const MAX_RETRIES = Number(process.env.SCRAPER_MAX_RETRIES) || 3;
const COOKIES_PATH = process.env.OC_COOKIES_PATH || join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '.oc-cookies.json',
);

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
      return cookies
        .filter((c) => typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string')
        .map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
        }));
    } catch (err) {
      throw new Error(`Failed to load cookies from ${COOKIES_PATH}: ${(err as Error).message}`);
    }
  }

  private async injectCookies(page: Page): Promise<void> {
    if (this.cookiesLoaded) return;
    const cookies = this.loadCookiesFromFile();
    await page.setCookie(...cookies);
    this.cookiesLoaded = true;
    console.log('[scraper] Session cookies injected');
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
      await this.injectCookies(page);
      await randomDelay();

      const url = this.buildSearchUrl(normalizedName, jurisdiction);
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });

          const title = await page.evaluate(() => document.title);
          if (title.includes('403') || title.includes('Forbidden')) {
            throw new Error('Blocked by HAProxy (403 Forbidden)');
          }

          const hasCaptcha = await page.$('.g-recaptcha, [data-sitekey], #captcha');
          if (hasCaptcha) {
            throw new Error('CAPTCHA detected on results page');
          }

          if (page.url().includes('/users/sign_in')) {
            throw new Error('Session expired — update cookies in .oc-cookies.json');
          }

          const html = await page.content();
          return parseSearchResults(html);
        } catch (err) {
          lastError = err as Error;
          console.warn(`[scraper] Attempt ${attempt}/${MAX_RETRIES} failed:`, (err as Error).message);
          if (attempt < MAX_RETRIES) {
            await randomDelay();
          }
        }
      }

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