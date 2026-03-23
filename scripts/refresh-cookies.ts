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
  process.env.OC_COOKIES_PATH || 'services/worker/.oc-cookies.json',
);
const OC_BASE = process.env.OC_BASE_URL || 'https://opencorporates.com';

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
  console.log('Launching browser (visible mode)...\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  await page.goto(`${OC_BASE}/users/sign_in`, { waitUntil: 'networkidle2' });

  console.log('=== ACTION REQUIRED ===');
  console.log('1. Log in to OpenCorporates in the browser window');
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

  writeFileSync(COOKIES_PATH, JSON.stringify(filtered, null, 2));
  console.log(`\nSaved ${filtered.length} cookies to ${COOKIES_PATH}`);

  if (session) console.log(`  _openc_session: ${session.value.slice(0, 20)}...`);
  if (captcha) console.log(`  solved_captcha: ${captcha.value.slice(0, 20)}...`);

  await browser.close();
}

main().catch((err) => {
  console.error('Cookie refresh failed:', err);
  process.exit(1);
});