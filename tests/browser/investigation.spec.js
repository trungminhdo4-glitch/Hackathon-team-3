import { test, expect } from '@playwright/test';

for (const [scenario, verdict, score] of [
  ['credible', 'green', 100], ['contradiction', 'red', 0],
  ['timeout', 'yellow', 0], ['fabricated', 'yellow', 40],
]) {
  test(`renders the ${scenario} investigation returned by the API`, async ({ page }) => {
    if (scenario === 'timeout') await page.setViewportSize({ width: 375, height: 780 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Fixture mode' }).click();
    await page.getByLabel('Fixture scenario').selectOption(scenario);
    await page.getByLabel('Product URL').fill('https://demo.example/');
    let release;
    if (scenario === 'credible') {
      const ready = new Promise(resolve => { release = resolve; });
      await page.route('**/api/investigate', async route => { await ready; await route.continue(); });
    }
    const response = page.waitForResponse(r => r.url().endsWith('/api/investigate'));
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    if (release) {
      try { await expect(page.getByRole('button', { name: 'Investigating…' })).toBeDisabled(); }
      finally { release(); }
    }
    const report = await (await response).json();
    expect(report.verdict).toBe(verdict);
    expect(report.score).toBe(score);
    const labels = { green: 'Credible based on available evidence', red: 'Material red flags found', yellow: 'Not enough or mixed evidence' };
    await expect(page.getByText(labels[verdict], { exact: true })).toBeVisible();
    for (const check of report.checks) {
      const row = page.getByRole('article').filter({ has: page.getByRole('heading', { name: check.label }) });
      await expect(row.getByText(check.status, { exact: true })).toBeVisible();
      await expect(row.getByText(`${check.points} / ${check.maxPoints}`, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(report.interpretation, { exact: true })).toBeVisible();
    for (const source of report.sources) {
      await expect(page.locator('a').filter({ visible: true }).and(page.locator(`[href="${source.url}"]`)).first()).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('live failure offers retry and never displays a scored report', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Live research' }).click();
  await page.getByLabel('Product URL').fill('https://demo.example/');
  await page.getByRole('button', { name: 'Investigate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  const response = page.waitForResponse(r => r.url().endsWith('/api/investigate'));
  await page.getByRole('button', { name: 'Retry' }).click();
  expect((await (await response).json()).score).toBeNull();
});

test('session history restores original reports and citations without another investigation', async ({ page, context }) => {
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/investigate')) requests++; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Fixture mode' }).click();
  for (const [scenario, url, verdict] of [
    ['credible', 'https://first.example/', 'Credible based on available evidence'],
    ['contradiction', 'https://second.example/', 'Material red flags found'],
  ]) {
    await page.getByLabel('Fixture scenario').selectOption(scenario);
    await page.getByLabel('Product URL').fill(url);
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await expect(page.getByText(verdict, { exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByText('Material red flags found', { exact: true })).toBeVisible();
  await page.getByText('Session history').click();
  await page.getByRole('button', { name: /first\.example/ }).click();
  await expect(page.getByText('Credible based on available evidence', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Synthetic partner integration guide' })).toBeVisible();
  await expect(page.getByLabel('Fixture scenario')).toHaveValue('credible');
  expect(requests).toBe(2);
  const anotherTab = await context.newPage();
  await anotherTab.goto('/');
  await anotherTab.getByText('Session history').click();
  await expect(anotherTab.getByText('Completed reports will appear here for this tab.')).toBeVisible();
});
