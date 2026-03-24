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
const OC_EMAIL = process.env.OC_EMAIL || '';
const OC_PASSWORD = process.env.OC_PASSWORD || '';

async function main() {
  console.log('Opening browser — log in to OpenCorporates, then come back here.\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: 50,
  });

  const page = await browser.newPage();
  await page.goto(`${OC_BASE}/users/sign_in`, { waitUntil: 'networkidle2' });

  // Auto-fill credentials from .env
  if (OC_EMAIL) {
    const emailField = await page.$('input[type="email"], input[name*="email"], #user_email');
    if (emailField) {
      await emailField.click({ clickCount: 3 });
      await emailField.type(OC_EMAIL);
      console.log(`Email pre-filled: ${OC_EMAIL}`);
    }
  }
  if (OC_PASSWORD) {
    const passField = await page.$('input[type="password"], input[name*="password"], #user_password');
    if (passField) {
      await passField.click({ clickCount: 3 });
      await passField.type(OC_PASSWORD);
      console.log('Password pre-filled: ****');
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
    writeFileSync(COOKIES_PATH, JSON.stringify(filtered, null, 2));
    console.log(`\nSaved ${filtered.length} cookies to ${COOKIES_PATH}`);
    console.log('Cookie names:', filtered.map((c) => c.name).join(', '));
  }

  await browser.close();
}

main().catch(console.error);
