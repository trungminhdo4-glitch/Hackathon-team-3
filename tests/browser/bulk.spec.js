import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('bulk streams mixed outcomes, opens a detailed report, downloads all rows, and restores this tab', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Bulk URLs'}).click();
  await page.getByLabel('Product URLs').fill('https://bulk-demo.example/\nhttps://contradicted.example/\nhttps://partial.example/\nhttp://localhost/');
  await page.getByRole('button',{name:'Investigate URLs'}).click();
  await expect(page.getByText('Researching',{exact:true}).first()).toBeVisible();
  await expect(page.getByText(/4 of 4 processed/)).toBeVisible();
  const result = page.getByRole('region',{name:'Batch results'});
  const totals = result.getByLabel('Verdict totals');
  for (const label of ['Green · Core promise supported','Red · Material risk','Yellow · Evidence gap','Incomplete']) {
    await expect(totals.getByText(label, {exact:true})).toBeVisible();
  }
  await expect(totals.getByText('1',{exact:true})).toHaveCount(4);
  await result.getByRole('button',{name:/View report for/}).first().click();
  await expect(result.getByRole('heading',{name:'Overall verdict'})).toBeVisible();
  const download = page.waitForEvent('download');
  await result.getByRole('button',{name:'Download batch CSV'}).click();
  const file = await download;
  const csv = await readFile(await file.path(),'utf8');
  expect(csv).toContain('product,vendor,overall,green_flags,yellow_flags,red_flags,reasoning,reviewer_notes_original');
  for (const outcome of ['Green','Red','Yellow','Investigation incomplete']) expect(csv).toContain('"' + outcome + '"');
  await page.reload();
  await expect(page.getByRole('button',{name:'Bulk URLs'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByText(/4 of 4 processed/)).toBeVisible();
  await expect(page.getByRole('region',{name:'Batch history'})).toHaveCount(0);
  await page.getByRole('button',{name:'Session history'}).click();
  const history = page.getByRole('region',{name:'Batch history'});
  await history.getByRole('button',{name:/4 URLs/}).click();
  await expect(page.getByRole('region',{name:'Batch results'})).toBeVisible();
});

test('imports 50 CSV URLs locally and sends only URLs and the selected Luna model to the bulk API', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Bulk URLs'}).click();
  const file = page.getByLabel('Import URLs from file');
  const urls = Array.from({length:50}, (_,i) => 'https://product-' + (i + 1) + '.example/');
  urls[0] = 'https://contradicted.example/';
  const csv = '"comment","url"\r\n' + urls.map(url => '"private,\nreviewer ""note""","' + url + '"').join('\r\n');
  await file.setInputFiles({name:'products.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await expect(page.getByRole('status').filter({hasText:'Imported 50 URLs'})).toBeVisible();
  await expect(page.getByLabel('Product URLs')).toHaveValue(urls.join('\n'));
  await file.setInputFiles({name:'large.txt',mimeType:'text/plain',buffer:Buffer.from([...urls, urls[0]].join('\n'))});
  await expect(page.getByRole('alert')).toContainText('51 URLs');
  await expect(page.getByLabel('Product URLs')).toHaveValue(urls.join('\n'));
  await page.getByLabel('Assessment model').selectOption('gpt-6-luna');
  const posted = page.waitForRequest(request => request.url().endsWith('/api/investigate/bulk'));
  await page.getByRole('button',{name:'Investigate URLs'}).click();
  expect((await posted).postDataJSON()).toEqual({urls,model:'gpt-6-luna'});
  await expect(page.getByText(/50 of 50 processed/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Download batch CSV'})).toBeVisible();
});
