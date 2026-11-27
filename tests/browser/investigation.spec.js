import { test, expect } from '@playwright/test';

const verdictLabels = { green: 'Green · Core promise supported', red: 'Red · Material risk', yellow: 'Yellow · Material caveat', gap: 'Yellow · Evidence gap' };
const statusLabels = { supported: 'Supported', partly_supported: 'Partly supported', contradicted: 'Contradicted', unverified: 'Unverified' };

for (const [scenario, subject, verdict] of [
  ['credible', 'Orbit Desk', 'green'], ['contradiction', 'https://contradicted.example/', 'red'],
  ['tier', 'https://tier.example/', 'yellow'], ['timeout', 'https://partial.example/', 'gap'],
  ['fabricated', 'https://uncited.example/', 'gap'],
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
      try {
        await expect(page.getByRole('button', { name: 'Investigating…' })).toBeDisabled();
        await page.getByRole('button', { name: 'Session history' }).click();
        await expect(page.getByRole('status')).toHaveText('Your investigation is still running in Single product.');
        await expect(page.getByRole('form', { name: 'Product investigation' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Single product' }).click();
        await expect(page.getByLabel('Product, company, or URL')).toHaveValue(subject);
      }
      finally { release(); }
    }
    const records = (await (await response).text()).trim().split('\n').map(line => JSON.parse(line));
    let report = records.at(-1).report;
    if (verdict === 'gap') {
      expect(report.verdict).toBeNull();
      expect(report.review.id).toBeTruthy();
      await expect(page.getByText('View or download dataset report')).toHaveCount(0);
      await expect(page.getByRole('heading', {name: 'Your input can guide the research'})).toBeVisible();
      const finalResponse = page.waitForResponse(r => r.url().endsWith('/api/investigate/review'));
      await page.getByRole('button', {name: 'Finish with current evidence'}).click();
      const lines = (await (await finalResponse).text()).trim().split('\n');
      report = JSON.parse(lines.at(-1)).report;
      expect(report.verdictBasis).toBe('evidence_gap');
      expect(report.reviewOutcome.action).toBe('finalize');
    }
    expect(report.verdict).toBe(verdict === 'gap' ? 'yellow' : verdict);
    expect(report.rubricVersion).toBe(2);
    expect(report).not.toHaveProperty('score');
    await expect(page.locator('.report .badge')).toHaveText(verdictLabels[verdict]);
    await expect(page.getByRole('heading', { name: 'Overall verdict' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your product question' })).toHaveCount(0);
    const criteria = page.getByRole('region', { name: 'Evaluation criteria' });
    await expect(criteria.getByRole('article')).toHaveCount(6);
    await expect(page.locator('.report .score, .report .points')).toHaveCount(0);
    const highlights = { credible: ['Strengths'], tier: ['Strengths', 'Cautions'], contradiction: ['Red flags'] };
    for (const name of ['Strengths', 'Cautions', 'Red flags']) {
      const group = page.getByRole('region', { name, exact: true });
      if (!(highlights[scenario] || []).includes(name)) {
        await expect(group).toHaveCount(0);
        continue;
      }
      const link = group.getByRole('link').first();
      await expect(link).toBeVisible();
      const target = await link.getAttribute('href');
      expect(target).toMatch(/^#finding-\d+$/);
      await link.click();
      await expect(criteria.locator(target)).toBeFocused();
      await expect(criteria.locator(target).getByRole('link').first()).toBeVisible();
    }
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
  await page.getByLabel('Assessment model').selectOption('gpt-4.1-mini');
  await page.getByLabel('Product, company, or URL').fill('https://failed.example/');
  await page.getByRole('button', { name: 'Investigate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  const response = page.waitForResponse(r => r.url().endsWith('/api/investigate'));
  await page.getByRole('button', { name: 'Retry' }).click();
  const retry = await response;
  expect(JSON.parse((await retry.text()).trim().split('\n').at(-1)).type).toBe('error');
  expect(retry.request().postDataJSON().model).toBe('gpt-4.1-mini');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Insufficient evidence', { exact: true })).toHaveCount(0);
});

test('session history restores original reports and citations without another investigation', async ({ page, context }) => {
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/investigate')) requests++; });
  await page.goto('/');
  const question = 'Does Orbit Desk require a commercial license for business use?';
  const select = page.getByRole('combobox', { name: 'Assessment model' });
  const meta = 'llama-3.3-70b-versatile';
  await expect(select.locator('optgroup')).toHaveCount(2);
  expect(await select.locator('optgroup').evaluateAll(groups => groups.map(group => group.label))).toEqual(['OpenAI', 'Meta']);
  for (const [subject, focus, verdict, choice] of [
    ['Orbit Desk', question, verdictLabels.green, meta],
    ['https://contradicted.example/', '', verdictLabels.red, 'gpt-4.1-mini'],
  ]) {
    await select.selectOption(choice);
    if (choice === meta) {
      await expect(page.getByText(/Meta assesses the retrieved passages via Groq/)).toBeVisible();
    } else {
      await expect(page.locator('.report').getByText('Assessment model · ' + meta)).toBeVisible();
    }
    await page.getByLabel('Product, company, or URL').fill(subject);
    await page.getByRole('textbox', { name: 'Product question', exact: true }).fill(focus);
    const sent = page.waitForRequest(request => request.url().endsWith('/api/investigate'));
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    expect((await sent).postDataJSON().model).toBe(choice);
    await expect(page.locator('.report .badge')).toHaveText(verdict);
    await expect(page.locator('.report').getByText('Assessment model · ' + choice)).toBeVisible();
  }
  await page.reload();
  await expect(page.locator('.report .badge')).toHaveText(verdictLabels.red);
  await expect(select).toHaveValue('gpt-6.2-sol');
  await expect(page.locator('.report').getByText('Assessment model · gpt-4.1-mini')).toBeVisible();
  await expect(page.getByRole('heading', {name:/Individual reports/})).toHaveCount(0);
  await page.getByRole('button', {name:'Session history'}).click();
  await expect(page.getByRole('heading', {name:'Individual reports (2)'})).toBeVisible();
  await expect(page.getByRole('form')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', {name:'Session history'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button', {name:'Single product'}).click();
  await select.selectOption('gpt-6.2-astra');
  await page.getByRole('button', {name:'Session history'}).click();
  await page.getByRole('button', { name: /Does Orbit Desk require a commercial license/i }).click();
  await expect(page.locator('.report .badge')).toHaveText(verdictLabels.green);
  await expect(select).toHaveValue('gpt-6.2-astra');
  await expect(page.locator('.report').getByText('OpenAI web search · gpt-4.1')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Product question', exact: true })).toHaveValue(question);
  await expect(page.getByLabel('Product, company, or URL')).toHaveValue('Orbit Desk');
  const answer = page.getByRole('region', { name: 'Your product question' });
  await expect(answer.getByText(question, { exact: true })).toBeVisible();
  await expect(answer.getByText('Orbit Desk requires a commercial license for business use.', { exact: true })).toBeVisible();
  await expect(page.locator('.report h3').first()).toHaveText('Overall verdict');
  await expect(page.getByRole('link', { name: /Orbit Desk deployment review/ }).first()).toBeVisible();
  expect(requests).toBe(2);
  const anotherTab = await context.newPage();
  await anotherTab.goto('/');
  await anotherTab.getByRole('button', {name:'Session history'}).click();
  await expect(anotherTab.getByText('Completed reports will appear here for this tab.')).toBeVisible();
});

test('recovers from a model-list failure and explains unavailable options', async ({ page, request }) => {
  const catalog = await (await request.get('/api/model')).json();
  const meta = catalog.models.find(option => option.provider === 'Meta');
  Object.assign(meta, { available: false, reason: 'Set GROQ_API_KEY on the server.' });
  let attempts = 0;
  await page.route('**/api/model', route => ++attempts === 1
    ? route.fulfill({ status: 503 })
    : route.fulfill({ json: catalog }));
  await page.goto('/');
  await page.getByLabel('Product, company, or URL').fill('Orbit Desk');
  await expect(page.getByRole('alert')).toHaveText('The model list could not be loaded.');
  await expect(page.getByRole('button', { name: 'Investigate', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reload models' }).click();
  await expect(page.getByLabel('Assessment model')).toHaveValue(catalog.model);
  await expect(page.getByRole('option', { name: 'Llama 3.3 70B (unavailable)' })).toBeDisabled();
  await expect(page.getByText(/Set GROQ_API_KEY on the server/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Investigate', exact: true })).toBeEnabled();
});

test('compares account models and shows search progress before and after the report arrives', async ({page}) => {
  await page.goto('/');
  await expect(page.getByText('Search tools · OpenAI web search and Tavily')).toBeVisible();
  await expect(page.getByLabel('Assessment model')).toHaveValue('gpt-6.2-sol');
  await expect(page.getByText('GPT-6.2 Sol assesses the evidence. GPT-6 Luna can search for missing sources.')).toBeVisible();
  await page.getByText('Compare models and see account access').click();
  await page.getByText(/OpenAI account model IDs/).click();
  await expect(page.getByText('text-embedding-3-small')).toBeVisible();
  await expect(page.getByRole('combobox', {name: 'Assessment model'}).locator('option', {hasText: 'embedding'})).toHaveCount(0);
  await page.getByLabel('Product, company, or URL').fill('Activity sample');
  await page.getByRole('button', {name: 'Investigate', exact: true}).click();
  await expect(page.getByRole('status')).toHaveText('gpt-6-luna · Searching for the partner integration guide');
  await expect(page.getByRole('button', {name: 'Investigating…'})).toBeDisabled();
  await expect(page.locator('.report .badge')).toHaveText(verdictLabels.green);
  await page.reload();
  await expect(page.locator('.report').getByText('Follow-up search · gpt-6-luna')).toBeVisible();
  await page.getByRole('button', { name:'Show activity for gpt-6-luna' }).click();
  await expect(page.getByRole('list', { name:'Activity for gpt-6-luna' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name:'Activity for gpt-6-luna' })).toContainText('Searching for the partner integration guide');
  await page.getByRole('button', { name:'Show all activity' }).click();
  await expect(page.locator('.research-activity li')).toHaveCount(2);
  await expect(page.locator('.research-activity li').first()).toContainText('Searching for the partner integration guide');
  await expect(page.locator('.research-activity li').first()).toContainText('gpt-6-luna');
  await expect(page.locator('.research-activity a')).toHaveAttribute('href', 'https://orbit.example/');
});

test('continues a saved draft with a human lead and exports the final verdict', async ({page}) => {
  await page.goto('/');
  await page.getByLabel('Product, company, or URL').fill('https://partial.example/');
  await page.getByRole('button', {name:'Investigate', exact:true}).click();
  const send = page.getByRole('button', {name:'Research my lead'});
  await expect(send).toBeDisabled();
  const lead = 'Check how the partner deployed the support queue.';
  await page.getByLabel('Research task or public source').fill(lead);
  await page.reload();
  await expect(page.getByLabel('Research task or public source')).toHaveValue(lead);
  const request = page.waitForRequest(r => r.url().endsWith('/api/investigate/review'));
  await send.click();
  const decision = (await request).postDataJSON();
  expect(decision).toMatchObject({action:'research',guidance:lead});
  await expect(page.locator('.report .badge')).toHaveText(verdictLabels.green);
  await expect(page.locator('.human-guidance')).toContainText(lead);
  await expect(page.getByRole('button', {name:'Research my lead'})).toHaveCount(0);
  await page.getByText('View or download dataset report', {exact:true}).click();
  await expect(page.getByRole('table').getByRole('cell').nth(2)).toHaveText('Green');
  await expect(page.getByRole('button', {name:'Download CSV'})).toBeVisible();
  await page.getByRole('button', {name:'Session history'}).click();
  await expect(page.locator('.session-history li')).toHaveCount(1);
});

test('a server-expired draft keeps its findings and offers a fresh investigation', async ({page}) => {
  await page.goto('/');
  await page.getByLabel('Product, company, or URL').fill('https://uncited.example/');
  await page.getByRole('button', {name:'Investigate', exact:true}).click();
  await page.route('**/api/investigate/review', route => route.fulfill({
    status:410, json:{error:'This review has expired. Start a new investigation to continue.'},
  }));
  await page.getByRole('button', {name:'Finish with current evidence'}).click();
  await expect(page.getByRole('heading', {name:'Review expired'})).toBeVisible();
  await expect(page.getByRole('region', {name:'Evaluation criteria'})).toBeVisible();
  await page.getByRole('button', {name:'Restart investigation'}).click();
  await expect(page.getByRole('heading', {name:'Your input can guide the research'})).toBeVisible();
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
  await page.getByRole('button', {name:'Session history'}).click();
  await page.getByRole('button', { name: /Orbit Desk.*20\/100/ }).click();
  await expect(page.getByText('Earlier assessment.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Evaluate with current rubric' })).toBeVisible();
});

test('views and downloads the same eight dataset fields and keeps original notes in the tab', async ({page, request}) => {
  const {readFile} = await import('node:fs/promises');
  const headers = ['product', 'vendor', 'overall', 'green_flags', 'yellow_flags', 'red_flags', 'reasoning', 'reviewer_notes_original'];
  await page.setViewportSize({width: 390, height: 800});
  await page.goto('/');
  const {model} = await (await request.get('/api/model')).json();
  await expect(page.getByRole('combobox', {name: 'Assessment model'})).toHaveValue(model);
  await page.getByLabel('Product, company, or URL').fill('Orbit Desk');
  await page.getByRole('button', {name: 'Investigate', exact: true}).click();
  const openExport = page.getByText('View or download dataset report', {exact: true});
  await openExport.click();
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText(headers);
  const notes = 'I checked "tier A", separately.\nUse A | B.';
  await page.getByLabel(/Original reviewer notes/).fill(notes);
  const cells = await table.getByRole('cell').allTextContents();
  expect(cells).toHaveLength(8);
  expect(cells[0]).toBe('Orbit Desk');
  expect(cells[2]).toBe('Green');
  expect(cells[3]).toContain('https://');
  expect(cells[7]).toBe(notes);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const [format, extension] of [['CSV', 'csv'], ['Markdown', 'md']]) {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Download ' + format}).click();
    const file = await waiting;
    expect(file.suggestedFilename()).toBe('SaaSLens-Orbit-Desk.' + extension);
    const contents = await readFile(await file.path(), 'utf8');
    if (format === 'CSV') {
      expect(contents.slice(1)).toBe(headers.join(',') + '\r\n' +
        cells.map(text => '"' + text.replaceAll('"', '""') + '"').join(',') + '\r\n');
    } else {
      await page.getByRole('button', {name: 'Markdown source'}).click();
      await expect(page.locator('pre.dataset-markdown')).toHaveText(contents, {useInnerText: false});
      expect(contents).toContain('A &#124; B.');
    }
  }
  await page.reload();
  await expect(page.getByText('Assessment model · ' + model, {exact: true})).toBeVisible();
  await expect(page.locator('.report').getByText(/Follow-up search/)).toHaveCount(0);
  await openExport.click();
  await expect(page.getByLabel(/Original reviewer notes/)).toHaveValue(notes);
});
