// AT-623: cold boot with the network disabled still renders the GridVault
// app shell from the service worker cache, instead of the browser's own
// "no internet" page. Runs against the production build (see
// playwright.config.ts 'chromium-shell' project, port 4173) because that
// is the one JS/CSS bundle a real deployment ships and the worker can
// precache — the dev server's unbundled module-per-file graph predates
// the worker's own registration and was never a realistic offline target.
//
// This does NOT reach an authenticated dashboard: access tokens live only
// in memory (AT-627) and a full reload always needs POST /api/auth/refresh
// to mint a new one. With the network truly gone that call cannot succeed,
// and re-authenticating from a stale local cache without the server would
// mean showing one staff member's roster to whoever reboots the shared
// ward terminal next — a confidentiality break the deny-by-default rule
// (AGENTS.md #2/#3) does not allow trading for offline convenience. The
// cached-roster fallback (frontend/src/lib/cache.js) is real and tested,
// but it serves an already-authenticated session whose API calls are
// failing (resilience.spec.ts), not an unauthenticated cold boot.
import { expect, test } from '@playwright/test';

test('AT-623: cold boot with the network disabled renders the shell, not a browser error page', async ({
  page,
  context
}) => {
  await page.goto('/login');
  await expect(page.getByPlaceholder(/SN-7742|Staff ID/i)).toBeVisible({ timeout: 15000 });

  await page.waitForFunction(
    () => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined,
    { timeout: 20000 }
  );
  // The shell loaded before the worker took control, same as any first
  // visit; one more online visit lets the worker's fetch handler cache it.
  await page.reload();
  await expect(page.getByPlaceholder(/SN-7742|Staff ID/i)).toBeVisible({ timeout: 15000 });

  await context.setOffline(true);
  await page.reload();

  // The GridVault shell rendered (form, labels, branding) — not a browser
  // interstitial (which carries none of this markup).
  await expect(page.getByPlaceholder(/SN-7742|Staff ID/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /Secure login to GridVault/i })).toBeVisible();
  await context.setOffline(false);
});
