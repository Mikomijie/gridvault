// AT-610/611/612/613/614: security console journeys as the admin.
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const demoPassword = (staffId: string): string => `GridVault-Demo-${staffId}!`;

async function login(page, staffId: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/SN-7742|Staff ID/i).fill(staffId);
  await page.getByPlaceholder(/Password/i).fill(demoPassword(staffId));
  await page.getByRole('button', { name: /Secure login to GridVault/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

test('AT-610: ledger inspector renders rows with truncated hashes and filters', async ({ page }) => {
  await login(page, 'AD-0012');
  await page.goto('/dashboard/security');
  await expect(page.getByText(/LOGIN/i).first()).toBeVisible({ timeout: 15000 });
  const hashes = page.locator('td[title]');
  expect(await hashes.count()).toBeGreaterThan(0);
  const firstHash = (await hashes.first().innerText()) ?? '';
  expect(firstHash).toMatch(/^[0-9a-f]{8}…[0-9a-f]{6}$/);
  await page.getByPlaceholder(/Filter by action/i).fill('LOGIN');
  await page.getByRole('button', { name: /^Apply$/i }).click();
  await expect(page.getByRole('cell', { name: 'LOGIN' }).first()).toBeVisible({ timeout: 15000 });
});

test('AT-611: Verify chain shows a HEALTHY banner with count and duration', async ({ page }) => {
  await login(page, 'AD-0012');
  await page.goto('/dashboard/security');
  await page.getByRole('tab', { name: /Verify chain/i }).click();
  await page.getByRole('button', { name: /^Verify chain$/i }).click();
  await expect(page.getByText(/HEALTHY: \d+ entries in \d+ ms/i)).toBeVisible({ timeout: 15000 });
});

test('AT-613: Run abuse demonstration raises a live alert card without reload', async ({ page }) => {
  await login(page, 'AD-0012');
  await page.goto('/dashboard/security');
  await page.getByRole('tab', { name: /Abuse alerts/i }).click();
  const before = await page.locator('li', { hasText: 'RULE-ABUSE-01' }).count();
  await page.getByRole('button', { name: /Run abuse demonstration/i }).click();
  await expect(page.locator('li', { hasText: 'RULE-ABUSE-01' })).toHaveCount(before + 1, { timeout: 15000 });
  const card = page.locator('li', { hasText: 'RULE-ABUSE-01' }).first();
  await expect(card).toContainText(/RC-1029/);
  await expect(card).toContainText(/CRITICAL/);
});

test('AT-614: CMO acknowledges a grant from the review queue', async ({ page }) => {
  // A nurse creates a genuine grant first (care path, not a fixture).
  await login(page, 'SN-7742');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-084');
  await page.getByRole('button', { name: /Emergency Clinical Override/i }).click();
  await page.getByLabel(/Clinical justification/i).selectOption('ACUTE_TRAUMA_UNCONSCIOUS');
  await page.getByLabel(/Confirm with your PIN/i).fill('220774');
  await page.getByRole('button', { name: /Confirm emergency override/i }).click();
  await expect(page.getByText(/Chinedu|Babatunde|Amara|Funke|Tolu|Yusuf|Grace|Kabiru|Adaeze|Ibrahim|Blessing|Peter/i).first()).toBeVisible({
    timeout: 15000
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Log out/i }).click();
  await expect(page).toHaveURL(/\/login/);

  await login(page, 'GV-9101');
  await page.goto('/dashboard/security');
  await page.getByRole('tab', { name: /Override review/i }).click();
  const row = page.locator('li', { hasText: 'SN-7742' }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole('button', { name: /Acknowledge/i }).click();
  await expect(page.getByText(/acknowledged and written to the ledger/i)).toBeVisible({ timeout: 15000 });
});

test('AT-612: after demo:tamper, Verify chain names the break and highlights the row', async ({ page }) => {
  await login(page, 'AD-0012');
  await page.goto('/dashboard/security');
  execFileSync('npx', ['tsx', 'backend/src/cli/gv.ts', 'demo:tamper', '--index', '3', '--field', 'staff_id'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_PATH: './data/gridvault.db' },
    stdio: 'pipe',
    timeout: 120000
  });
  await page.getByRole('tab', { name: /Verify chain/i }).click();
  await page.getByRole('button', { name: /^Verify chain$/i }).click();
  await expect(page.getByText(/TAMPERED: index 3 \(HASH_MISMATCH\)/i)).toBeVisible({ timeout: 15000 });
  await page.getByRole('tab', { name: /^Ledger$/i }).click();
  await page.getByPlaceholder(/Filter by staff ID/i).fill('ATTACKER');
  await page.getByRole('button', { name: /^Apply$/i }).click();
  const row = page.locator('tr', { hasText: 'ATTACKER' }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
});
