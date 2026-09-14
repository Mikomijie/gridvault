// AT-617/618/620/621/626/627: handover, keyboard, tablet, token
// refresh, copy resistance and storage hygiene.
import { expect, test } from '@playwright/test';

const demoPassword = (staffId: string): string => `GridVault-Demo-${staffId}!`;

async function login(page, staffId: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/SN-7742|Staff ID/i).fill(staffId);
  await page.getByPlaceholder(/Password/i).fill(demoPassword(staffId));
  await page.getByRole('button', { name: /Secure login to GridVault/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

async function assertEmptyStorage(page): Promise<void> {
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage }
  }));
  expect(storage, 'no PHI or tokens in web storage').toEqual({ local: {}, session: {} });
}

test('AT-617: SBAR handover print view carries the full watermark', async ({ page }) => {
  await login(page, 'SN-7742');
  await page.goto('/dashboard/handover');
  await expect(page.getByText(/SBAR handover/i)).toBeVisible({ timeout: 15000 });
  // Watermark: staff name, staff id, terminal and timestamp (shown both
  // as the diagonal print mark and as machine-readable text).
  await expect(page.getByText(/CHIOMA OKONKWO/i).first()).toBeVisible();
  await expect(page.getByText(/SN-7742/).first()).toBeVisible();
  await expect(page.getByText(/ward-terminal-/).first()).toBeVisible();
  await expect(page.getByText(/CONFIDENTIAL/).first()).toBeVisible();
  await expect(page.getByText(/Situation|Background|Assessment/i).first()).toBeVisible();
});

test('AT-618: keyboard-only roster to saved vitals with visible focus order', async ({ page }) => {
  await login(page, 'SN-7742');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-081');
  await page.getByRole('tab', { name: /^Vitals$/i }).focus();
  await page.keyboard.press('Enter');
  // Walk the whole tab order by keyboard only, recording inputs as they
  // receive focus: the four vitals fields must appear consecutively in
  // DOM order somewhere in the cycle (no keyboard traps, no skips).
  const seen: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => (document.activeElement as HTMLInputElement)?.name ?? '');
    if (name !== '') seen.push(name);
  }
  const run = seen.join(',');
  expect(run).toContain('heart_rate,blood_pressure,spo2,temperature');
  // Now operate the form end to end without touching the mouse: tab back
  // to the first field, fill stepwise, tab to Save, confirm with Enter.
  let foundFirst = false;
  for (let i = 0; i < 60; i++) {
    const name = await page.evaluate(() => (document.activeElement as HTMLInputElement)?.name ?? '');
    if (name === 'heart_rate') {
      foundFirst = true;
      break;
    }
    await page.keyboard.press('Tab');
  }
  expect(foundFirst, 'keyboard reaches the first vitals field').toBe(true);
  await page.keyboard.type('86');
  await page.keyboard.press('Tab');
  await page.keyboard.type('122/82');
  await page.keyboard.press('Tab');
  await page.keyboard.type('97');
  await page.keyboard.press('Tab');
  await page.keyboard.type('36.7');
  let foundSave = false;
  for (let i = 0; i < 30; i++) {
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.tagName}:${el.textContent?.slice(0, 24)}` : '';
    });
    if (label.startsWith('BUTTON:Save vitals')) {
      foundSave = true;
      break;
    }
    await page.keyboard.press('Tab');
  }
  expect(foundSave, 'keyboard reaches Save vitals').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Vitals recorded/i)).toBeVisible({ timeout: 15000 });
});

test('AT-620: tablet portrait has no horizontal scroll and glove-sized targets', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await login(page, 'SN-7742');
  for (const url of ['/dashboard', '/dashboard/patient/HOSP-LOS-2025-081']) {
    await page.goto(url);
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(
      () => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth + 1
    );
    expect(overflow, `no horizontal scroll on ${url}`).toBe(true);
    const small = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('button, a, input, select, textarea')) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const input = el as HTMLInputElement;
        if ((input.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio')) || input.type === 'hidden') {
          if (rect.width < 20 || rect.height < 20) {
            bad.push(`${input.tagName}:${input.type}:${Math.round(rect.width)}x${Math.round(rect.height)}`);
          }
          continue;
        }
        if (rect.width < 44 || rect.height < 44) {
          bad.push(`${el.tagName}:${(el.textContent ?? '').slice(0, 24)}:${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }
      return bad;
    });
    expect(small, `touch targets on ${url}`).toEqual([]);
  }
});

test('AT-621: expired access token refreshes silently without losing input', async ({ page }) => {
  test.setTimeout(180000);
  await login(page, 'SN-7742');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-081');
  await page.getByRole('tab', { name: /^Vitals$/i }).click();
  await page.getByLabel(/Heart rate/i).fill('93');
  // Access tokens live one minute in E2E: outlive it, then save. The
  // refresh-and-retry must succeed with the typed value intact. Mouse
  // movement every few seconds holds off the idle/hard lock timers while
  // wall-clock expiry still happens.
  for (let i = 0; i < 17; i++) {
    await page.mouse.move(100 + i * 5, 200);
    await page.waitForTimeout(4000);
  }
  await page.getByLabel(/Blood pressure/i).fill('124/80');
  await page.getByLabel(/SpO2/i).fill('98');
  await page.getByLabel(/Temperature/i).fill('36.8');
  await page.getByRole('button', { name: /Save vitals|Queue offline/i }).click();
  await expect(page.getByText(/Vitals recorded/i)).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/\/dashboard\/patient\//);
});

test('AT-626: copying a sensitive field leaves the clipboard empty', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page, 'SN-7742');
  await page.goto('/dashboard/patient/HOSP-LOS-2025-082');
  await page.getByRole('tab', { name: /Protected data/i }).click();
  const value = page.getByText(/Non-reactive|Hb AS|G2 P1/i).first();
  await expect(value).toBeVisible({ timeout: 15000 });
  await value.click({ clickCount: 3 });
  await page.keyboard.press('ControlOrMeta+c');
  await page.waitForTimeout(500);
  const clipboard = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return 'UNREADABLE';
    }
  });
  expect(clipboard === '' || clipboard === 'UNREADABLE').toBe(true);
});

test('AT-627: web storage stays empty across login, dossier, grant and sync', async ({
  page,
  context
}) => {
  await login(page, 'GV-9042');
  await assertEmptyStorage(page);
  await page.goto('/dashboard/patient/HOSP-LOS-2025-081');
  await expect(page.getByText(/WARD_MISMATCH/i)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Emergency Clinical Override/i }).click();
  await page.getByLabel(/Clinical justification/i).selectOption('ACUTE_TRAUMA_UNCONSCIOUS');
  await page.getByLabel(/Confirm with your PIN/i).fill('220042');
  await page.getByRole('button', { name: /Confirm emergency override/i }).click();
  await expect(page.getByText(/Chinedu Nnamdi/i).first()).toBeVisible({ timeout: 15000 });
  await assertEmptyStorage(page);
  await page.getByRole('tab', { name: /^Vitals$/i }).click();
  await page.getByLabel(/Heart rate/i).fill('90');
  await page.getByLabel(/Blood pressure/i).fill('126/82');
  await page.getByLabel(/SpO2/i).fill('97');
  await page.getByLabel(/Temperature/i).fill('37.1');
  await page.getByRole('button', { name: /Save vitals/i }).click();
  await expect(page.getByText(/Vitals recorded/i)).toBeVisible({ timeout: 15000 });
  await assertEmptyStorage(page);
  await context.setOffline(true);
  await expect(page.getByText(/Offline · Local cache active/i)).toBeVisible({ timeout: 15000 });
  const idb = await page.evaluate(async () => JSON.stringify(await indexedDB.databases()));
  expect(idb).toContain('gridvault-offline');
  await assertEmptyStorage(page);
});
