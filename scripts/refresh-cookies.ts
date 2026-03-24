import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

config({ path: resolve(ROOT, '.env') });

const COOKIES_PATH = resolve(
  ROOT,
  'services/worker',
  process.env.OC_COOKIES_PATH || '.oc-cookies.json',
);
const OC_BASE = process.env.OC_BASE_URL || 'https://opencorporates.com';
const OC_EMAIL = process.env.OC_EMAIL;
const OC_PASSWORD = process.env.OC_PASSWORD;

function waitForEnter(prompt: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(prompt, () => {
      rl.close();
      res();
    }),
  );
}

async function main(): Promise<void> {
  if (!OC_EMAIL || !OC_PASSWORD) {
    console.warn('WARNING: OC_EMAIL or OC_PASSWORD not set in .env — credentials will not be pre-filled');
  }

  console.log('Launching browser (visible mode)...\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
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

    // Auto-fill email and password from .env
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

    console.log('\n=== ACTION REQUIRED ===');
    console.log('1. Credentials have been pre-filled — click Sign In');
    console.log('2. Solve any CAPTCHA if prompted');
    console.log('3. Once you see the dashboard/search page, come back here');
    console.log('=======================\n');

    await waitForEnter('Press Enter when logged in... ');

    const cookies = await page.cookies();
    const filtered = cookies
      .filter((c) => c.domain.includes('opencorporates'))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
      }));

    const session = filtered.find((c) => c.name === '_openc_session');
    const captcha = filtered.find((c) => c.name === 'solved_captcha');

    if (!session) {
      console.warn('\nWARNING: _openc_session cookie not found — login may have failed');
    }
    if (!captcha) {
      console.warn('WARNING: solved_captcha cookie not found — CAPTCHA may not have been solved');
    }

    writeFileSync(COOKIES_PATH, JSON.stringify(filtered, null, 2), { mode: 0o600 });
    console.log(`\nSaved ${filtered.length} cookies to ${COOKIES_PATH}`);

    if (session) console.log('  _openc_session: present');
    if (captcha) console.log('  solved_captcha: present');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Cookie refresh failed:', err);
  process.exit(1);
});