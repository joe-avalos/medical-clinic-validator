import { type Page } from '@playwright/test';
import { HEALTH_OK } from './mocks/seed';

/**
 * Intercept all API calls with sensible defaults so the app
 * boots without needing a real backend.
 */
export async function mockHealthCheck(page: Page) {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: HEALTH_OK }),
  );
}

/**
 * Block the health endpoint so Layout shows "Disconnected".
 */
export async function mockHealthDisconnected(page: Page) {
  await page.route('**/api/health', (route) =>
    route.fulfill({ status: 503, json: { error: 'unhealthy' } }),
  );
}

/**
 * Set a fake JWT so the axios interceptor has a token to attach.
 */
export async function injectAuthToken(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('mv_token', 'e2e-test-token');
  });
}