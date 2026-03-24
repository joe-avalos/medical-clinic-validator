import { test, expect } from '@playwright/test';
import { mockHealthCheck, injectAuthToken } from './helpers';
import {
  VERIFY_CACHED,
  VERIFY_FRESH,
  JOB_STATUS_CACHED,
  JOB_STATUS_COMPLETED,
  JOB_IDS,
  RECORDS,
} from './mocks/seed';

test.describe('Cached result flow', () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthToken(page);
    await mockHealthCheck(page);
  });

  test('shows cached banner when result comes from cache', async ({ page }) => {
    await page.route('**/api/verify', (route) =>
      route.fulfill({ json: VERIFY_CACHED }),
    );
    await page.route(`**/api/verify/${JOB_IDS.cached}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_CACHED }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Mayo Health System');
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect(page.getByText('Cached Result')).toBeVisible();
    await expect(page.getByText(/Showing cached result from/)).toBeVisible();
  });

  test('shows View Results and Re-verify buttons for cached result', async ({ page }) => {
    await page.route('**/api/verify', (route) =>
      route.fulfill({ json: VERIFY_CACHED }),
    );
    await page.route(`**/api/verify/${JOB_IDS.cached}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_CACHED }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Mayo Health System');
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect(page.getByRole('button', { name: 'View Results' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-verify' })).toBeVisible();
  });

  test('View Results navigates to job results page', async ({ page }) => {
    await page.route('**/api/verify', (route) =>
      route.fulfill({ json: VERIFY_CACHED }),
    );
    await page.route(`**/api/verify/${JOB_IDS.cached}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_CACHED }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Mayo Health System');
    await page.getByRole('button', { name: 'Verify' }).click();

    await page.getByRole('button', { name: 'View Results' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/verify/${JOB_IDS.cached}/results`),
    );
    await expect(page.getByText('Verification Results')).toBeVisible();
  });

  test('Re-verify triggers a fresh verification', async ({ page }) => {
    let verifyCallCount = 0;

    await page.route('**/api/verify', (route) => {
      verifyCallCount++;
      if (verifyCallCount === 1) {
        return route.fulfill({ json: VERIFY_CACHED });
      }
      // Second call is the force refresh
      return route.fulfill({ json: VERIFY_FRESH });
    });
    await page.route(`**/api/verify/${JOB_IDS.cached}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_CACHED }),
    );
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Mayo Health System');
    await page.getByRole('button', { name: 'Verify' }).click();

    await page.getByRole('button', { name: 'Re-verify' }).click();

    // Should navigate to the new fresh job's progress page
    await expect(page).toHaveURL(new RegExp(`/verify/${JOB_IDS.fresh}`), { timeout: 10_000 });
  });

  test('does not auto-redirect for cached completed results', async ({ page }) => {
    await page.route('**/api/verify', (route) =>
      route.fulfill({ json: VERIFY_CACHED }),
    );
    await page.route(`**/api/verify/${JOB_IDS.cached}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_CACHED }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Mayo Health System');
    await page.getByRole('button', { name: 'Verify' }).click();

    // Wait a bit to confirm no auto-redirect
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(new RegExp(`/verify/${JOB_IDS.cached}`));
    await expect(page.getByRole('heading', { name: 'Cached Result' })).toBeVisible();
  });
});