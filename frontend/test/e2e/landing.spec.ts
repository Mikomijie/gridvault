// AT-601: landing page loads clean with compliance-honest claims.
import { expect, test } from '@playwright/test';

test('AT-601: landing page loads with no console errors and compliance-matrix claims', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/');
  await expect(page).toHaveTitle(/GridVault/);
  expect(errors).toEqual([]);
  const text = (await page.content()) ?? '';
  for (const banned of ['ISO 27001', '45+ hospital', 'Class-1', 'Federal Ministry of Health Certified']) {
    expect(text).not.toContain(banned);
  }
  expect(text).toMatch(/COMPLIANCE|No certification claimed|NDPA 2023/);
});
