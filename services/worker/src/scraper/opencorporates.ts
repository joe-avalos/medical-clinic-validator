import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteer, { type Browser, type Page, type CookieParam } from 'puppeteer';
import type { RawCompanyRecord } from '@medical-validator/shared';
import { parseSearchResults } from './opencorporates-parser.js';

const OC_BASE = process.env.OC_BASE_URL || 'https://opencorporates.com';
const PAGE_TIMEOUT = Number(process.env.SCRAPER_PAGE_TIMEOUT_MS) || 15000;
const MAX_RETRIES = Number(process.env.SCRAPER_MAX_RETRIES) || 3;
const COOKIES_PATH = process.env.OC_COOKIES_PATH || join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '.oc-cookies.json',
);

let browser: Browser | null = null;
let cookiesLoaded = false;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    const isHeadless = process.env.BROWSER_HEADLESS !== 'false';
    browser = await puppeteer.launch({
      headless: isHeadless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(isHeadless ? {} : { slowMo: 100 }),
    });
    cookiesLoaded = false;
  }
  return browser;
}

function loadCookiesFromFile(): CookieParam[] {
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

async function injectCookies(page: Page): Promise<void> {
  if (cookiesLoaded) return;

  const cookies = loadCookiesFromFile();
  await page.setCookie(...cookies);
  cookiesLoaded = true;
  console.log('[scraper] Session cookies injected');
}

function buildSearchUrl(normalizedName: string, jurisdiction?: string): string {
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

/**
 * Scrapes OpenCorporates search results for a company name.
 * Uses pre-exported session cookies for authentication.
 */
export async function scrapeOpenCorporates(
  normalizedName: string,
  jurisdiction?: string,
): Promise<RawCompanyRecord[]> {
  const b = await getBrowser();
  const page = await b.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT);
  await page.setViewport({ width: 1280, height: 720 });

  try {
    await injectCookies(page);

    const url = buildSearchUrl(normalizedName, jurisdiction);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });

        // Check for 403 / blocked
        const status = await page.evaluate(() => document.title);
        if (status.includes('403') || status.includes('Forbidden')) {
          throw new Error('Blocked by HAProxy (403 Forbidden)');
        }

        // Check for CAPTCHA on results page
        const hasCaptcha = await page.$('.g-recaptcha, [data-sitekey], #captcha');
        if (hasCaptcha) {
          throw new Error('CAPTCHA detected on results page');
        }

        // Check for redirect to login (session expired)
        if (page.url().includes('/users/sign_in')) {
          throw new Error('Session expired — update cookies in .oc-cookies.json');
        }

        const html = await page.content();
        return parseSearchResults(html);
      } catch (err) {
        lastError = err as Error;
        console.warn(`[scraper] Attempt ${attempt}/${MAX_RETRIES} failed:`, (err as Error).message);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    throw lastError || new Error('Scrape failed after retries');
  } finally {
    await page.close();
  }
}

/**
 * Closes the browser. Call on worker shutdown.
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    cookiesLoaded = false;
  }
}
