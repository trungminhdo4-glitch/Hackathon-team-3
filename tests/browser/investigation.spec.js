import { test, expect } from '@playwright/test';

for (const [scenario, subject, verdict, score] of [
  ['credible', 'Orbit Desk', 'green', 100], ['contradiction', 'https://reserved.example/', 'red', 0],
  ['timeout', 'https://partial.example/', 'yellow', 0], ['fabricated', 'https://uncited.example/', 'yellow', 40],
]) {
  test(`renders the ${scenario} investigation returned by the API`, async ({ page }) => {
    if (scenario === 'timeout') await page.setViewportSize({ width: 375, height: 780 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Fixture mode' })).toHaveCount(0);
    await page.getByLabel('Product, company, or URL').fill(subject);
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
    await page.getByText('Evidence and scoring', { exact: true }).click();
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
  await page.getByLabel('Product, company, or URL').fill('https://failed.example/');
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
  const question = 'Does Orbit Desk require a commercial license for business use?';
  for (const [subject, focus, verdict] of [
    ['Orbit Desk', question, 'Credible based on available evidence'],
    ['https://reserved.example/', '', 'Material red flags found'],
  ]) {
    await page.getByLabel('Product, company, or URL').fill(subject);
    await page.getByLabel('Product question').fill(focus);
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await expect(page.getByText(verdict, { exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByText('Material red flags found', { exact: true })).toBeVisible();
  await page.getByText('Session history').click();
  await page.getByRole('button', { name: /Orbit Desk/i }).click();
  await expect(page.getByText('Credible based on available evidence', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Product question')).toHaveValue(question);
  await expect(page.getByLabel('Product, company, or URL')).toHaveValue('Orbit Desk');
  await expect(page.getByText('Orbit Desk requires a commercial license for business use.', { exact: true }).first()).toBeVisible();
  await page.getByText('Evidence and scoring', { exact: true }).click();
  await expect(page.getByRole('link', { name: /Synthetic partner integration guide/ }).first()).toBeVisible();
  expect(requests).toBe(2);
  const anotherTab = await context.newPage();
  await anotherTab.goto('/');
  await anotherTab.getByText('Session history').click();
  await expect(anotherTab.getByText('Completed reports will appear here for this tab.')).toBeVisible();
});
