// AT-622: a backend 500 degrades to a retry affordance rather than a blank
// screen. AT-623 (offline cold boot from the service worker) lives in
// offline-shell.spec.ts, run against a production build (see
// playwright.config.ts) — the dev server serves the app as dozens of
// unbundled ES module requests that predate the service worker's own
// registration, so it never represents what a deployed terminal caches.
import { expect, test } from '@playwright/test';

const demoPassword = (staffId: string): string => `GridVault-Demo-${staffId}!`;

async function login(page, staffId: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/SN-7742|Staff ID/i).fill(staffId);
  await page.getByPlaceholder(/Password/i).fill(demoPassword(staffId));
  await page.getByRole('button', { name: /Secure login to GridVault/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

test('AT-622: a 500 from the roster API shows a retry, never a blank screen', async ({ page }) => {
  // Fail the very first roster fetch (before login) so there is no cached
  // roster to gracefully fall back to (frontend/src/lib/cache.js): this
  // isolates the true "backend is down" case from AT-623's cached path.
  await page.route('**/api/patients*', (route) => {
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
  });
  await login(page, 'SN-7742');
  await expect(page.getByText(/Could not load the roster/i)).toBeVisible({ timeout: 15000 });
  const retry = page.getByRole('button', { name: /Retry/i });
  await expect(retry).toBeVisible();
  // Not a white screen: the page shell, nav and retry affordance are present.
  await expect(page.locator('body')).not.toBeEmpty();
  await page.unroute('**/api/patients*');
  await retry.click();
  await expect(page.getByText(/Could not load the roster/i)).toHaveCount(0, { timeout: 15000 });
});

test('the roster falls back to the encrypted cache when the API is unreachable mid-session', async ({ page }) => {
  // Complements AT-623: an already-authenticated terminal whose records
  // subsystem drops mid-shift still shows the last roster it saw, via
  // frontend/src/lib/cache.js, without needing a reload (which would lose
  // the in-memory access token and force a fresh login).
  await login(page, 'SN-7742');
  await expect(page.getByText(/Assigned Inpatients Under Your Direct Care/i).first()).toBeVisible({
    timeout: 15000
  });
  await page.route('**/api/patients*', (route) => {
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'degraded' }) });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  // A route-intercepted 503 still lets /api/auth/refresh succeed (only the
  // roster endpoint is intercepted), so the reload re-authenticates and
  // DashboardPage's roster fetch is the one that fails and falls back.
  await expect(page.getByText(/Showing the last cached roster while offline/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Assigned Inpatients Under Your Direct Care/i).first()).toBeVisible();
  await page.unroute('**/api/patients*');
});
