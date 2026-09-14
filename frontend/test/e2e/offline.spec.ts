// AT-501/502/503/615/616: offline capture, queue badge, reconnect sync,
// vitals validation parity.
import { expect, test } from '@playwright/test';

const demoPassword = (staffId: string): string => `GridVault-Demo-${staffId}!`;

async function login(page, staffId: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/SN-7742|Staff ID/i).fill(staffId);
  await page.getByPlaceholder(/Password/i).fill(demoPassword(staffId));
  await page.getByRole('button', { name: /Secure login to GridVault/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

async function openVitalsTab(page): Promise<void> {
  await page.goto('/dashboard/patient/HOSP-LOS-2025-081');
  await page.getByRole('tab', { name: /^Vitals$/i }).click();
  await expect(page.getByLabel(/Record vitals/i)).toBeVisible({ timeout: 15000 });
}

test('AT-615: outage toggle shows the amber bar, queue badge and Sync now', async ({ page }) => {
  await login(page, 'SN-7742');
  await page.getByLabel(/Simulate grid outage/i).check();
  await expect(page.getByText(/Offline · Local cache active/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/0 queued/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Sync now/i })).toBeVisible();
  await page.getByLabel(/Simulate grid outage/i).uncheck();
});

test('AT-501/AT-502: offline dossier renders from reachability loss; vitals queue with an unsynced tag', async ({
  page,
  context
}) => {
  await login(page, 'SN-7742');
  await openVitalsTab(page);
  await context.setOffline(true);
  await expect(page.getByText(/Offline · Local cache active/i)).toBeVisible({ timeout: 15000 });
  await page.getByLabel(/Heart rate/i).fill('88');
  await page.getByLabel(/Blood pressure/i).fill('130/85');
  await page.getByLabel(/SpO2/i).fill('97');
  await page.getByLabel(/Temperature/i).fill('37.0');
  await page.getByRole('button', { name: /Queue offline/i }).click();
  await expect(page.getByText(/1 queued/i)).toBeVisible({ timeout: 15000 });
  const unsynced = page.getByText(/unsynced/i);
  await expect(unsynced.first()).toBeVisible();
  await expect(page.getByText(/heart_rate: 88/i)).toBeVisible();
  await context.setOffline(false);
});

test('AT-503: reconnect auto-syncs the queue and the value lands server-side', async ({
  page,
  context
}) => {
  await login(page, 'SN-7742');
  await openVitalsTab(page);
  await context.setOffline(true);
  await expect(page.getByText(/Offline · Local cache active/i)).toBeVisible({ timeout: 15000 });
  await page.getByLabel(/Heart rate/i).fill('87');
  await page.getByLabel(/Blood pressure/i).fill('128/84');
  await page.getByLabel(/SpO2/i).fill('97');
  await page.getByLabel(/Temperature/i).fill('36.9');
  await page.getByRole('button', { name: /Queue offline/i }).click();
  await expect(page.getByText(/1 queued/i)).toBeVisible({ timeout: 15000 });
  await context.setOffline(false);
  // One heartbeat success flips back and drains the queue in order: the
  // amber bar clears and the confirmation names the synced count.
  await expect(page.getByText(/Offline · Local cache active/i)).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByText(/Synced 1/i)).toBeVisible({ timeout: 20000 });
  await page.reload();
  await page.getByRole('tab', { name: /^Vitals$/i }).click();
  await expect(page.getByText(/87/).first()).toBeVisible({ timeout: 15000 });
});

test('AT-616: out-of-range vitals are rejected client-side with the server message', async ({
  page
}) => {
  await login(page, 'SN-7742');
  await openVitalsTab(page);
  await page.getByLabel(/Heart rate/i).fill('999');
  await page.getByLabel(/Blood pressure/i).fill('120/80');
  await page.getByLabel(/SpO2/i).fill('98');
  await page.getByLabel(/Temperature/i).fill('36.8');
  await page.getByRole('button', { name: /Save vitals/i }).click();
  await expect(page.getByText(/outside clinically valid ranges.*heart_rate/i)).toBeVisible({
    timeout: 15000
  });
});
