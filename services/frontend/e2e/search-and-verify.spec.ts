import { test, expect } from '@playwright/test';
import { mockHealthCheck, injectAuthToken } from './helpers';
import {
  VERIFY_FRESH,
  JOB_STATUS_COMPLETED,
  RECORDS,
  createPollingSequence,
} from './mocks/seed';

test.describe('Search and Verify flow', () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthToken(page);
    await mockHealthCheck(page);
  });

  test('renders the search page with hero and form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Verify a Provider')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. Mayo Health System')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. us_mn')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify' })).toBeVisible();
  });

  test('shows how-it-works steps', async ({ page }) => {
    await page.goto('/');
    const main = page.getByRole('main');
    await expect(main.getByText('Search')).toBeVisible();
    await expect(main.getByText('Analyze')).toBeVisible();
    await expect(main.getByText('Store')).toBeVisible();
  });

  test('verify button is disabled until 2+ characters', async ({ page }) => {
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Verify' });
    await expect(button).toBeDisabled();

    await page.getByPlaceholder('e.g. Mayo Health System').fill('A');
    await expect(button).toBeDisabled();

    await page.getByPlaceholder('e.g. Mayo Health System').fill('Ab');
    await expect(button).toBeEnabled();
  });

  test('submits verification and navigates to progress page', async ({ page }) => {
    await page.route('**/api/verify', (route) =>
      route.fulfill({ json: VERIFY_FRESH }),
    );
    await page.route(`**/api/verify/${VERIFY_FRESH.jobId}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Mayo Health System');
    await page.getByPlaceholder('e.g. us_mn').fill('us_mn');
    await page.getByRole('button', { name: 'Verify' }).click();

    // Should navigate to progress page
    await expect(page).toHaveURL(new RegExp(`/verify/${VERIFY_FRESH.jobId}`));
    await expect(page.getByText('Verification Progress')).toBeVisible();
  });

  test('shows polling progression: queued → processing → completed', async ({ page }) => {
    const poll = createPollingSequence();

    await page.route('**/api/verify', (route) =>
      route.fulfill({ json: VERIFY_FRESH }),
    );
    await page.route(`**/api/verify/${VERIFY_FRESH.jobId}/status`, (route) =>
      route.fulfill({ json: poll() }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Mayo Health System');
    await page.getByRole('button', { name: 'Verify' }).click();

    // Should see Queued step
    await expect(page.getByText('Queued')).toBeVisible();

    // Eventually reaches completed and shows results count
    await expect(page.getByText(/result.*found/i)).toBeVisible({ timeout: 15_000 });
  });

  test('auto-redirects to job results page on fresh completion', async ({ page }) => {
    await page.route('**/api/verify', (route) =>
      route.fulfill({ json: VERIFY_FRESH }),
    );
    await page.route(`**/api/verify/${VERIFY_FRESH.jobId}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Mayo Health System');
    await page.getByRole('button', { name: 'Verify' }).click();

    // Should auto-redirect to job results page after ~1.5s
    await expect(page).toHaveURL(
      new RegExp(`/verify/${VERIFY_FRESH.jobId}/results`),
      { timeout: 10_000 },
    );
    await expect(page.getByText('Verification Results')).toBeVisible();
    await expect(page.getByText('Mayo Health System')).toBeVisible();
  });

  test('shows connected health indicator', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Connected')).toBeVisible();
  });
});