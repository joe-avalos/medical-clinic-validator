import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

config({ path: resolve(ROOT, '.env') });

const COOKIES_PATH = join(__dirname, '.oc-cookies.json');
const OC_BASE = process.env.OC_BASE_URL || 'https://opencorporates.com';
const OC_EMAIL = process.env.OC_EMAIL;
const OC_PASSWORD = process.env.OC_PASSWORD;

async function main(): Promise<void> {
  if (!OC_EMAIL || !OC_PASSWORD) {
    console.warn('WARNING: OC_EMAIL or OC_PASSWORD not set in .env — credentials will not be pre-filled');
  }

  console.log('Opening browser — log in to OpenCorporates, then come back here.\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: 50,
  });

  try {
    const page = await browser.newPage();
    await page.goto(`${OC_BASE}/users/sign_in`, { waitUntil: 'networkidle2' });

    // Dismiss cookie consent banner (page may reload after)
    try {
      const rejectBtn = await page.$('button.cky-btn-reject');
      if (rejectBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {}),
          rejectBtn.click(),
        ]);
        console.log('Cookie consent rejected');
        // Wait for login form to be ready after potential reload
        await page.waitForSelector('#user_email', { timeout: 5000 });
      }
    } catch (err) {
      console.warn('Could not dismiss cookie banner:', (err as Error).message);
    }

    // Auto-fill credentials from .env
    if (OC_EMAIL) {
      try {
        const emailField = await page.$('#user_email');
        if (emailField) {
          await emailField.click({ clickCount: 3 });
          await emailField.type(OC_EMAIL);
          console.log('Email pre-filled');
        }
      } catch (err) {
        console.warn('Could not pre-fill email:', (err as Error).message);
      }
    }
    if (OC_PASSWORD) {
      try {
        const passField = await page.$('#user_password');
        if (passField) {
          await passField.click({ clickCount: 3 });
          await passField.type(OC_PASSWORD);
          console.log('Password pre-filled');
        }
      } catch (err) {
        console.warn('Could not pre-fill password:', (err as Error).message);
      }
    }

    console.log('\nCredentials pre-filled — click Sign In and solve any CAPTCHA.');
    console.log('After login, press ENTER here when done.');

    await new Promise<void>((resolve) => {
      process.stdin.setRawMode?.(false);
      process.stdin.resume();
      process.stdin.once('data', () => resolve());
    });

    const cookies = await page.cookies('https://opencorporates.com');
    const filtered = cookies
      .filter((c) => c.name === '_openc_session' || c.domain.includes('opencorporates'))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
      }));

    if (filtered.length === 0) {
      console.error('No OpenCorporates cookies found. Did you log in?');
    } else {
      writeFileSync(COOKIES_PATH, JSON.stringify(filtered, null, 2), { mode: 0o600 });
      console.log(`\nSaved ${filtered.length} cookies to ${COOKIES_PATH}`);
      console.log('Cookie names:', filtered.map((c) => c.name).join(', '));
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Cookie extraction failed:', err);
  process.exit(1);
});