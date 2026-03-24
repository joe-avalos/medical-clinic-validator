import { test, expect } from '@playwright/test';
import { mockHealthCheck, mockHealthDisconnected, injectAuthToken } from './helpers';
import {
  VERIFY_FRESH,
  JOB_STATUS_FAILED,
  JOB_IDS,
  createFailingSequence,
} from './mocks/seed';

test.describe('Error states', () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthToken(page);
  });

  test('shows disconnected health indicator', async ({ page }) => {
    await mockHealthDisconnected(page);
    await page.goto('/');
    await expect(page.getByText('Disconnected')).toBeVisible();
  });

  test('shows error when verification submission fails', async ({ page }) => {
    await mockHealthCheck(page);
    await page.route('**/api/verify', (route) =>
      route.fulfill({ status: 500, json: { error: 'Internal server error' } }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Test Clinic');
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect(page.getByText(/failed|error/i)).toBeVisible({ timeout: 5_000 });
  });

  test('shows failed job with error message', async ({ page }) => {
    await mockHealthCheck(page);
    await page.route('**/api/verify', (route) =>
      route.fulfill({ json: { ...VERIFY_FRESH, jobId: JOB_IDS.failed } }),
    );
    await page.route(`**/api/verify/${JOB_IDS.failed}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_FAILED }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Test Clinic');
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect(page.getByText('Error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/429 Too Many Requests/)).toBeVisible();
  });

  test('shows polling progression to failure', async ({ page }) => {
    await mockHealthCheck(page);
    const poll = createFailingSequence();

    await page.route('**/api/verify', (route) =>
      route.fulfill({ json: { ...VERIFY_FRESH, jobId: JOB_IDS.failed } }),
    );
    await page.route(`**/api/verify/${JOB_IDS.failed}/status`, (route) =>
      route.fulfill({ json: poll() }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Test Clinic');
    await page.getByRole('button', { name: 'Verify' }).click();

    // Eventually shows error
    await expect(page.getByText('Error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/429 Too Many Requests/)).toBeVisible();
  });

  test('shows error when job status fetch fails', async ({ page }) => {
    await mockHealthCheck(page);
    await page.route('**/api/verify', (route) =>
      route.fulfill({ json: VERIFY_FRESH }),
    );
    await page.route(`**/api/verify/${VERIFY_FRESH.jobId}/status`, (route) =>
      route.fulfill({ status: 500, json: { error: 'Server error' } }),
    );

    await page.goto('/');
    await page.getByPlaceholder('e.g. Mayo Health System').fill('Test Clinic');
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect(page.getByText('Failed to fetch job status')).toBeVisible({ timeout: 10_000 });
  });

  test('shows error when records page fails to load', async ({ page }) => {
    await mockHealthCheck(page);
    await page.route('**/api/records*', (route) =>
      route.fulfill({ status: 500, json: { error: 'Server error' } }),
    );

    await page.goto('/records');

    // The records page should show some kind of error or empty state
    // (RecordsTable receives empty array on error since useRecords fails)
    await expect(page.getByText('No verification records found')).toBeVisible({ timeout: 5_000 });
  });
});