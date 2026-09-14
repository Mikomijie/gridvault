// AT-115: idle lock hides PHI; PIN restores; hard lock returns to login.
import { expect, test } from '@playwright/test';

const demoPassword = (staffId: string): string => `GridVault-Demo-${staffId}!`;

test('AT-115: three idle minutes lock the terminal and the PIN restores it', async ({ page }) => {
  // Idle 6 s + PIN + hard lock at 25 s: needs longer than the 30 s default.
  test.setTimeout(120000);
  await page.goto('/login');
  await page.getByPlaceholder(/SN-7742|Staff ID/i).fill('SN-7742');
  await page.getByPlaceholder(/Password/i).fill(demoPassword('SN-7742'));
  await page.getByRole('button', { name: /Secure login to GridVault/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  await page.goto('/dashboard/patient/HOSP-LOS-2025-082');
  await expect(page.getByText(/Amara Okafor/i).first()).toBeVisible({ timeout: 15000 });

  // Idle past the 6 s test lock: overlay up, PHI gone from the DOM text.
  await expect(page.getByText(/Terminal locked/i)).toBeVisible({ timeout: 15000 });
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toContain('Amara Okafor');
  expect(text).not.toContain('HOSP-LOS-2025-082');

  // PIN restores the session without a fresh login.
  await page.getByLabel(/PIN/i).fill('220774');
  await page.getByRole('button', { name: /Unlock/i }).click();
  await expect(page.getByText(/Amara Okafor/i).first()).toBeVisible({ timeout: 15000 });

  // Hard lock purges the session back to /login.
  await expect(page).toHaveURL(/\/login/, { timeout: 60000 });
});
