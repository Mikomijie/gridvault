// AT-602/AT-603: persona logins and wrong-password behaviour.
import { expect, test } from '@playwright/test';

const PERSONAS = ['GV-9042', 'SN-7742', 'RC-1029', 'AD-0012', 'GV-9101'];
const demoPassword = (staffId: string): string => `GridVault-Demo-${staffId}!`;

async function login(page, staffId: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/SN-7742|Staff ID/i).fill(staffId);
  await page.getByPlaceholder(/Password/i).fill(password);
  await page.getByRole('button', { name: /Secure login to GridVault/i }).click();
}

test('AT-602: login as each of the 5 personas reaches the dashboard roster', async ({ page }) => {
  for (const staffId of PERSONAS) {
    await login(page, staffId, demoPassword(staffId));
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.getByText(/Assigned Inpatients|Ward roster|No patients found/i).first()).toBeVisible({
      timeout: 15000
    });
    // Server identity, not client choice: the dashboard shows the record.
    await expect(page.getByText(staffId).first()).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: /Log out/i }).click();
    await expect(page).toHaveURL(/\/login/);
  }
});

test('AT-603: login with a wrong password shows an inline error, no navigation, no stored token', async ({
  page
}) => {
  await login(page, 'SN-7742', 'definitely-not-the-password');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/Login failed|temporarily locked/i)).toBeVisible();
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage }
  }));
  expect(storage).toEqual({ local: {}, session: {} });
});
