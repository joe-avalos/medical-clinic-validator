import { test, expect } from '@playwright/test';
import { mockHealthCheck, injectAuthToken } from './helpers';
import {
  RECORDS_PAGE_1,
  RECORDS_PAGE_2,
  RECORDS_FILTERED_HIGH,
  RECORDS_FILTERED_LOW,
  RECORDS_EMPTY,
  JOB_STATUS_COMPLETED,
  JOB_STATUS_MULTI_RESULT,
  RECORDS,
  JOB_IDS,
} from './mocks/seed';

test.describe('Records page', () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthToken(page);
    await mockHealthCheck(page);
  });

  test('renders records table with data', async ({ page }) => {
    await page.route('**/api/records*', (route) =>
      route.fulfill({ json: RECORDS_PAGE_1 }),
    );

    await page.goto('/records');

    await expect(page.getByText('Verification Records')).toBeVisible();
    await expect(page.getByText('6 records')).toBeVisible();
    await expect(page.getByText('Mayo Health System')).toBeVisible();
    await expect(page.getByText('Kaiser Permanente')).toBeVisible();
    await expect(page.getByText('Sunrise Medical Clinic LLC')).toBeVisible();
  });

  test('shows table column headers', async ({ page }) => {
    await page.route('**/api/records*', (route) =>
      route.fulfill({ json: RECORDS_PAGE_1 }),
    );

    await page.goto('/records');

    await expect(page.getByRole('columnheader', { name: 'Company' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Jurisdiction' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Risk' })).toBeVisible();
  });

  test('shows risk badges with correct labels', async ({ page }) => {
    await page.route('**/api/records*', (route) =>
      route.fulfill({ json: RECORDS_PAGE_1 }),
    );

    await page.goto('/records');

    const table = page.getByRole('table');
    await expect(table.getByText('High Risk')).toBeVisible();
    await expect(table.getByText('Caution')).toBeVisible();
    await expect(table.getByText('Verified').first()).toBeVisible();
  });

  test('shows empty state when no records', async ({ page }) => {
    await page.route('**/api/records*', (route) =>
      route.fulfill({ json: RECORDS_EMPTY }),
    );

    await page.goto('/records');

    await expect(page.getByText('No verification records found')).toBeVisible();
    await expect(page.getByText('Submit a verification to get started')).toBeVisible();
  });

  test('filters records by risk level', async ({ page }) => {
    await page.route('**/api/records*', (route) => {
      const url = new URL(route.request().url());
      const riskLevel = url.searchParams.get('riskLevel');
      if (riskLevel === 'HIGH') {
        return route.fulfill({ json: RECORDS_FILTERED_HIGH });
      }
      if (riskLevel === 'LOW') {
        return route.fulfill({ json: RECORDS_FILTERED_LOW });
      }
      return route.fulfill({ json: RECORDS_PAGE_1 });
    });

    await page.goto('/records');
    await expect(page.getByText('6 records')).toBeVisible();

    // Filter to HIGH
    await page.getByRole('combobox').selectOption('HIGH');
    await expect(page.getByText('1 record')).toBeVisible();
    await expect(page.getByText('Sunrise Medical Clinic LLC')).toBeVisible();

    // Filter to LOW
    await page.getByRole('combobox').selectOption('LOW');
    await expect(page.getByText('2 records')).toBeVisible();
    await expect(page.getByText('Mayo Health System').first()).toBeVisible();
  });

  test('shows Load More button and paginates', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/records*', (route) => {
      requestCount++;
      if (requestCount === 1) {
        return route.fulfill({ json: RECORDS_PAGE_1 });
      }
      return route.fulfill({ json: RECORDS_PAGE_2 });
    });

    await page.goto('/records');

    const loadMore = page.getByRole('button', { name: 'Load More' });
    await expect(loadMore).toBeVisible();
    await loadMore.click();

    // Second page should have loaded
    expect(requestCount).toBe(2);
  });

  test('navigates to detail page when clicking a company', async ({ page }) => {
    await page.route('**/api/records*', (route) =>
      route.fulfill({ json: RECORDS_PAGE_1 }),
    );
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto('/records');
    await page.getByText('Mayo Health System').click();

    await expect(page).toHaveURL(
      new RegExp(`/records/${RECORDS.mayo.jobId}/${RECORDS.mayo.companyNumber}`),
    );
  });
});

test.describe('Detail page', () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthToken(page);
    await mockHealthCheck(page);
  });

  test('renders full record details', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto(`/records/${JOB_IDS.fresh}/${RECORDS.mayo.companyNumber}`);

    await expect(page.getByRole('heading', { name: 'Mayo Health System' })).toBeVisible();
    await expect(page.getByText('AI Assessment')).toBeVisible();
    await expect(page.getByText(/actively registered in Minnesota/)).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText('Health System', { exact: true })).toBeVisible();
    await expect(page.getByText('Verified')).toBeVisible(); // LOW risk badge
  });

  test('shows risk flags for high-risk records', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.multiResult}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_MULTI_RESULT }),
    );

    await page.goto(`/records/${JOB_IDS.multiResult}/${RECORDS.dissolved.companyNumber}`);

    await expect(page.getByText('Risk Flags')).toBeVisible();
    await expect(page.getByText('Entity dissolved in 2022')).toBeVisible();
    await expect(page.getByText('No active officers on record')).toBeVisible();
  });

  test('shows raw audit data in collapsible section', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto(`/records/${JOB_IDS.fresh}/${RECORDS.mayo.companyNumber}`);

    const summary = page.getByText('Raw Audit Data');
    await expect(summary).toBeVisible();
    await summary.click();
    await expect(page.getByText(/opencorporates\.com/)).toBeVisible();
  });

  test('shows source record HTML preview when rawHtml is present', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto(`/records/${JOB_IDS.fresh}/${RECORDS.mayo.companyNumber}`);

    await expect(page.getByText('Source Record Preview')).toBeVisible();
    await expect(page.locator('.oc-preview').getByText('MAYO HEALTH SYSTEM')).toBeVisible();
    await expect(page.locator('.oc-preview').getByText('22 Jul 1919')).toBeVisible();
  });

  test('shows record not found for invalid company number', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto(`/records/${JOB_IDS.fresh}/NONEXISTENT`);

    await expect(page.getByText('Record not found')).toBeVisible();
  });

  test('shows back link to records', async ({ page }) => {
    await page.route(`**/api/verify/${JOB_IDS.fresh}/status`, (route) =>
      route.fulfill({ json: JOB_STATUS_COMPLETED }),
    );

    await page.goto(`/records/${JOB_IDS.fresh}/${RECORDS.mayo.companyNumber}`);

    const backLink = page.getByText('← Records');
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL('/records');
  });
});