import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Workspace access key').fill(process.env.PLATFORM_API_TOKEN!);
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'A little curiosity. A lot of clarity.' })).toBeVisible();
});
test('workspace uses live counts, prompt composer and history', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole('button', { name: /Turn an API into a dataset/ }).click();
  await expect(page.getByLabel('Describe your dataset')).toHaveValue(/https:\/\/jsonplaceholder/);
  await expect(page.getByRole('button', { name: 'Create dataset' })).toBeEnabled();
  await mkdir('reports/ui', { recursive: true });
  await page.screenshot({ path: 'reports/ui/workspace-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /Run history/ }).click();
  await page.getByLabel('Search runs').fill('no-such-dataset');
  await expect(page.getByText('No runs found')).toBeVisible();
  expect(errors).toEqual([]);
});
test('persisted results have provenance, downloads and working inspection', async ({ page, request }) => {
  const response = await request.get('/api/dashboard', { headers: { authorization: `Bearer ${process.env.PLATFORM_API_TOKEN}` } });
  const dashboard = await response.json();
  const job = dashboard.execution_results.find((j: { status: string }) => j.status === 'completed');
  expect(job, 'Run npm run test:stack to create a live completed dataset first').toBeTruthy();
  await page.getByRole('button', { name: `Open run ${job.execution_id}` }).click();
  await expect(page.getByRole('heading', { name: 'Your dataset', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect record 1', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View original source' })).toHaveAttribute('href', /^https:\/\//);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  for (const format of ['CSV','JSON']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: format, exact: true }).click();
    const result = await download;
    expect(result.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
    expect(await result.failure()).toBeNull();
  }
  await page.screenshot({ path: 'reports/ui/dataset-desktop.png', fullPage: true, animations: 'disabled' });
});
test('mobile layout stays within viewport and navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'reports/ui/workspace-mobile.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: /Run history/ }).click();
  await expect(page.getByRole('heading', { name: 'Run history' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Workspace access key')).toBeVisible();
});
