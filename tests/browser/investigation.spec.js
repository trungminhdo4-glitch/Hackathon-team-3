import { test, expect } from '@playwright/test';

const verdictLabels = { green: 'Core promise supported', red: 'Material risk', yellow: 'Material caveat', insufficient: 'Insufficient evidence' };
const statusLabels = { supported: 'Supported', partly_supported: 'Partly supported', contradicted: 'Contradicted', unverified: 'Unverified' };

for (const [scenario, subject, verdict] of [
  ['credible', 'Orbit Desk', 'green'], ['contradiction', 'https://contradicted.example/', 'red'],
  ['tier', 'https://tier.example/', 'yellow'], ['timeout', 'https://partial.example/', 'insufficient'],
  ['fabricated', 'https://uncited.example/', 'insufficient'],
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
    expect(report.rubricVersion).toBe(2);
    expect(report).not.toHaveProperty('score');
    await expect(page.locator('.report .badge')).toHaveText(verdictLabels[verdict]);
    const criteria = page.getByRole('region', { name: 'Evaluation criteria' });
    await expect(criteria.getByRole('article')).toHaveCount(6);
    await expect(page.locator('.report .score, .report .points')).toHaveCount(0);
    for (const check of report.checks) {
      const row = criteria.getByRole('article').filter({ has: page.getByRole('heading', { name: check.label, exact: true }) });
      await expect(row.getByText(statusLabels[check.status], { exact: true }).first()).toBeVisible();
      if (check.claim) await expect(row.getByText(check.claim, { exact: true }).first()).toBeVisible();
      await expect(row.getByText(check.explanation, { exact: true }).first()).toBeVisible();
      await expect(row.locator('.consequence').filter({ hasText: check.consequence }).first()).toBeVisible();
      for (const id of check.evidenceIds) {
        const source = report.sources.find(s => s.id === id);
        await expect(row.locator('a').and(page.locator(`[href="${source.url}"]`)).first()).toBeVisible();
      }
    }
    await expect(page.getByText(report.interpretation, { exact: true })).toBeVisible();
    for (const id of report.verdictEvidenceIds) {
      const source = report.sources.find(s => s.id === id);
      await expect(page.locator('.verdict-sources a').and(page.locator(`[href="${source.url}"]`)).first()).toBeVisible();
    }
    const accounts = page.getByRole('region', { name: 'Customer reviews and testimony' });
    if (scenario === 'credible') {
      const review = report.testimony[0];
      await expect(accounts.getByText(review.text, { exact: false }).first()).toBeVisible();
      await expect(accounts.getByText(/Casey Lee/).first()).toBeVisible();
      const source = report.sources.find(s => s.id === review.evidence[0].sourceId);
      await expect(accounts.getByRole('link', { name: source.title }).first()).toHaveAttribute('href', source.url);
    } else if (!report.testimony.length) {
      await expect(accounts.getByText(/no first-hand customer account/i)).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('live failure offers retry and stays distinct from an insufficient-evidence report', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Product, company, or URL').fill('https://failed.example/');
  await page.getByRole('button', { name: 'Investigate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  const response = page.waitForResponse(r => r.url().endsWith('/api/investigate'));
  await page.getByRole('button', { name: 'Retry' }).click();
  expect((await response).ok()).toBe(false);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Insufficient evidence', { exact: true })).toHaveCount(0);
});

test('session history restores original reports and citations without another investigation', async ({ page, context }) => {
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/investigate')) requests++; });
  await page.goto('/');
  const question = 'Does Orbit Desk require a commercial license for business use?';
  for (const [subject, focus, verdict] of [
    ['Orbit Desk', question, verdictLabels.green],
    ['https://contradicted.example/', '', verdictLabels.red],
  ]) {
    await page.getByLabel('Product, company, or URL').fill(subject);
    await page.getByLabel('Product question').fill(focus);
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await expect(page.locator('.report .badge')).toHaveText(verdict);
  }
  await page.reload();
  await expect(page.locator('.report .badge')).toHaveText(verdictLabels.red);
  await page.getByText('Session history').click();
  await page.getByRole('button', { name: /Does Orbit Desk require a commercial license/i }).click();
  await expect(page.locator('.report .badge')).toHaveText(verdictLabels.green);
  await expect(page.getByLabel('Product question')).toHaveValue(question);
  await expect(page.getByLabel('Product, company, or URL')).toHaveValue('Orbit Desk');
  await expect(page.getByText('Orbit Desk requires a commercial license for business use.', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Orbit Desk deployment review/ }).first()).toBeVisible();
  expect(requests).toBe(2);
  const anotherTab = await context.newPage();
  await anotherTab.goto('/');
  await anotherTab.getByText('Session history').click();
  await expect(anotherTab.getByText('Completed reports will appear here for this tab.')).toBeVisible();
});

test('rechecking an earlier report saves a new assessment alongside the original', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('saaslens.history.v1', JSON.stringify([{ id: 'earlier', report: {
      inputUrl: 'https://orbit.example/', subject: 'Orbit Desk', productName: 'Orbit Desk',
      verdict: 'yellow', score: 20, interpretation: 'Earlier assessment.', checks: [], sources: [], limitations: [],
    } }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Evaluate with current rubric' }).click();
  await expect(page.locator('.report .badge')).toHaveText(verdictLabels.green);
  await page.getByText('Session history').click();
  await page.getByRole('button', { name: /Orbit Desk.*20\/100/ }).click();
  await expect(page.getByText('Earlier assessment.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Evaluate with current rubric' })).toBeVisible();
});
