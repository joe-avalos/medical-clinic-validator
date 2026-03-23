import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIES_PATH = join(__dirname, '.oc-cookies.json');

async function main() {
  console.log('Opening browser — log in to OpenCorporates, then come back here.\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: 50,
  });

  const page = await browser.newPage();
  await page.goto('https://opencorporates.com/users/sign_in', { waitUntil: 'networkidle2' });

  console.log('Waiting for you to log in...');
  console.log('After login, the page should redirect. Press ENTER here when done.');

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
