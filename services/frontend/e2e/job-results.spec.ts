import { test, expect } from '@playwright/test';
import { mockHealthCheck, injectAuthToken } from './helpers';
import {
  JOB_STATUS_COMPLETED,
  JOB_STATUS_MULTI_RESULT,
  JOB_IDS,
  RECORDS,
} from './mocks/seed';

test.describe('Job Results page', () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthToken(page);
    await mockHealthCheck(page);
  });

  test('renders results list with title and count', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.multiResult}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_MULTI_RESULT }),
    );

    await page.goto(`/verify/${JOB_IDS.multiResult}/results`);

    await expect(page.getByText('Verification Results')).toBeVisible();
    await expect(page.getByText(/3 entities found/)).toBeVisible();
  });

  test('sorts results by risk: HIGH first, then MEDIUM, then UNKNOWN', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.multiResult}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_MULTI_RESULT }),
    );

    await page.goto(`/verify/${JOB_IDS.multiResult}/results`);

    // Wait for all results to render
    await expect(page.getByText('Sunrise Medical Clinic LLC')).toBeVisible();

    // Get all company name elements (the font-semibold paragraph inside each card)
    const names = await page.locator('p.font-semibold.text-slate-200').allTextContents();

    // HIGH (Dissolved) should be first, MEDIUM (Kaiser) second, UNKNOWN (Northside) third
    expect(names[0]).toBe('Sunrise Medical Clinic LLC');
    expect(names[1]).toBe('Kaiser Permanente');
    expect(names[2]).toBe('Northside Wellness Partners');
  });

  test('shows risk badges for each result', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.multiResult}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_MULTI_RESULT }),
    );

    await page.goto(`/verify/${JOB_IDS.multiResult}/results`);

    await expect(page.getByText('High Risk')).toBeVisible();
    await expect(page.getByText('Caution')).toBeVisible();
    await expect(page.getByText('Unknown').first()).toBeVisible();
  });

  test('shows risk flags inline for flagged results', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.multiResult}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_MULTI_RESULT }),
    );

    await page.goto(`/verify/${JOB_IDS.multiResult}/results`);

    await expect(page.getByText('Entity dissolved in 2022')).toBeVisible();
    await expect(page.getByText('No active officers on record')).toBeVisible();
  });

  test('shows AI summary preview for each result', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto(`/verify/${JOB_IDS.fresh}/results`);

    await expect(page.getByText(/actively registered in Minnesota/)).toBeVisible();
  });

  test('navigates to detail page when clicking a result', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto(`/verify/${JOB_IDS.fresh}/results`);

    await page.getByText('Mayo Health System').click();

    await expect(page).toHaveURL(
      new RegExp(`/records/${JOB_IDS.fresh}/${RECORDS.mayo.companyNumber}`),
    );
  });

  test('shows single entity label for one result', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto(`/verify/${JOB_IDS.fresh}/results`);

    await expect(page.getByText(/1 entity found/)).toBeVisible();
  });

  test('has New search back link', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto(`/verify/${JOB_IDS.fresh}/results`);

    const backLink = page.getByText('← New search');
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL('/');
  });
});