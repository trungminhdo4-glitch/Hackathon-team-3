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
  await expect(page.getByText('Batch history (1)')).toBeVisible();
});
