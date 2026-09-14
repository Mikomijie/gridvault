// AT-604..AT-609: nurse dashboard scope, dossier redaction, clerk denial,
// break-glass journey and emergency-access end.
import { expect, test } from '@playwright/test';

const demoPassword = (staffId: string): string => `GridVault-Demo-${staffId}!`;

async function login(page, staffId: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/SN-7742|Staff ID/i).fill(staffId);
  await page.getByPlaceholder(/Password/i).fill(demoPassword(staffId));
  await page.getByRole('button', { name: /Secure login to GridVault/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

test('AT-604: nurse dashboard shows only Ward A patients', async ({ page }) => {
  await login(page, 'SN-7742');
  await expect(page.getByText(/patients in scope/i)).toBeVisible({ timeout: 15000 });
  const body = (await page.content()) ?? '';
  expect(body).toContain('ward_a');
  expect(body).not.toContain('ICU-02');
});

test('AT-605: nurse opens the Protected data tab with visible values and no edit controls', async ({
  page
}) => {
  await login(page, 'SN-7742');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-082');
  await page.getByRole('tab', { name: /Protected data/i }).click();
  await expect(page.getByRole('tabpanel')).toContainText(/hiv_status/i);
  // Values render as text, never as inputs: the nurse reads, not writes.
  expect(await page.getByRole('tabpanel').locator('input, textarea, select').count()).toBe(0);
});

test('AT-606: clerk queue dossier shows lock chips and no values in the DOM', async ({ page }) => {
  await login(page, 'RC-1029');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-081');
  await expect(page.getByText(/Restricted to clinical staff/i).first()).toBeVisible({ timeout: 15000 });
  const content = (await page.content()) ?? '';
  expect(content).not.toContain('Reactive (Confirmed)');
  expect(content).not.toContain('Hb SS');
  expect(content).not.toContain('Hb AS');
});

test('AT-607: clerk out-of-queue attempt explains the denial without a break-glass offer', async ({
  page
}) => {
  await login(page, 'RC-1029');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-082');
  await expect(page.getByText(/Chart unavailable/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/CLERK_OUT_OF_QUEUE/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Emergency Clinical Override/i })).toHaveCount(0);
});

test('AT-608/AT-609: doctor break-glass opens the chart, then End re-locks it', async ({ page }) => {
  await login(page, 'GV-9042');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-081');
  await expect(page.getByText(/WARD_MISMATCH/i)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Emergency Clinical Override/i }).click();
  await page.getByLabel(/Clinical justification/i).selectOption('ACUTE_TRAUMA_UNCONSCIOUS');
  await page.getByLabel(/Confirm with your PIN/i).fill('220042');
  await page.getByRole('button', { name: /Confirm emergency override/i }).click();
  // Chart readable with the red banner carrying audit index and countdown.
  await expect(page.getByText(/Chinedu Nnamdi/i).first()).toBeVisible({ timeout: 15000 });
  await page.getByRole('tab', { name: /Clinical/i }).click();
  await expect(page.getByText(/appendectomy/i).first()).toBeVisible({ timeout: 15000 });
  const banner = page.getByRole('alert').first();
  await expect(banner).toContainText(/audit \d+/i);
  await expect(banner).toContainText(/:/);
  // End emergency access: banner clears and the chart re-locks.
  await page.getByRole('button', { name: /End emergency access/i }).click();
  await expect(banner).toHaveCount(0);
  await page.goto('/dashboard');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-081');
  await expect(page.getByText(/Chart unavailable|WARD_MISMATCH/i).first()).toBeVisible({ timeout: 15000 });
});
