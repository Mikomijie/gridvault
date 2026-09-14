// AT-903: axe-core scans on landing, login, dashboard, dossier and the
// break-glass modal. Zero violations is the WCAG 2.2 AA gate for the
// screens that exist; new screens join this file as they land.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const demoPassword = (staffId: string): string => `GridVault-Demo-${staffId}!`;

async function login(page, staffId: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/SN-7742|Staff ID/i).fill(staffId);
  await page.getByPlaceholder(/Password/i).fill(demoPassword(staffId));
  await page.getByRole('button', { name: /Secure login to GridVault/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

async function expectNoViolations(page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`), label).toEqual([]);
}

test('AT-903: axe scans are clean on landing and login', async ({ page }) => {
  await page.goto('/');
  await expectNoViolations(page, 'landing');
  await page.goto('/login');
  await expectNoViolations(page, 'login');
});

test('AT-903: axe scans are clean on dashboard, dossier and the break-glass modal', async ({
  page
}) => {
  await login(page, 'SN-7742');
  await expectNoViolations(page, 'dashboard');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-082');
  await expect(page.getByRole('tab', { name: /Protected data/i })).toBeVisible({ timeout: 15000 });
  await expectNoViolations(page, 'dossier');
  await page.goto('/dashboard/security');
  await expect(page.getByText(/Security console/i)).toBeVisible({ timeout: 15000 });
  await expectNoViolations(page, 'security');
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Log out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, 'GV-9042');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-081');
  await page.getByRole('button', { name: /Emergency Clinical Override/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
  await expectNoViolations(page, 'break-glass modal');
});
