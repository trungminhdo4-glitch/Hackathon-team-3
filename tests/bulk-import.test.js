import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { importUrls, listError, splitUrlLines } from '../src/bulkImport.js'
import { readBatches, saveBatches } from '../src/batchStorage.js'

test('imports only the public URL column from the original forty-product dataset', async () => {
  const text = await readFile(new URL('../hackathon_40_solutions_commented (1).csv', import.meta.url), 'utf8')
  const urls = await importUrls(new File([text], 'dataset.csv'))
  assert.equal(urls.length, 40)
  assert.equal(urls[0], 'https://www.omnissa.com/')
  assert.equal(listError(urls), '')
})

test('imports quoted CSV records, single-column files and plain text', async () => {
  const csv = '\uFEFF"Comment","Product URL"\r\n"Quoted, ""multi\nline""","https://one.example/"\r\n'
  assert.deepEqual(await importUrls(new File([csv], 'data.csv')), ['https://one.example/'])
  const urls = ['https://one.example/', 'https://two.example/?a=1']
  for (const ext of ['CSV', 'Txt']) {
    assert.deepEqual(await importUrls(new File([urls.join('\r\n')], 'public.' + ext)), urls)
  }
  assert.deepEqual(splitUrlLines(' \nhttps://one.example/\r \n'), [urls[0]])
})

test('rejects bad files and oversized lists with actionable errors', async () => {
  const cases = [
    ['url,notes\n,hello', 'a.csv', /record 2 is missing/],
    ['url,notes\n"https://some.example/,broken', 'a.csv', /inside a quoted cell/],
    ['product,notes\na name,a comment', 'a.csv', /URL column header/],
    ['url\n', 'a.csv', /contains no product URLs/],
    ['https://u:p@public.example/', 'a.txt', /Check URL 1/],
    ['https://public.example/', 'a.exe', /TXT or CSV/],
    ['x'.repeat(1024 * 1024 + 1), 'a.csv', /1 MiB/],
    [Array(51).fill('https://public.example/').join('\n'), 'a.txt', /51 URLs.*50/],
  ]
  for (const [content,name,expected] of cases) await assert.rejects(importUrls(new File([content], name)), expected)
})

test('retains all 50 full reports across a reload when plain session storage runs out of space', async () => {
  const items = Array.from({length:50}, (_,i) => ({inputUrl:`https://example.com/${i}`,
    status:'completed', report:{reason:'A cited finding from the published documentation. '.repeat(150)}}))
  const batches = [{id:'example', at:0, model:'demo', items}]
  let data
  const storage = {
    setItem(key, value) {
      if (value.length > 12000) throw new DOMException('Full', 'QuotaExceededError')
      data = value
    },
    getItem() { return data },
  }
  assert.equal(await saveBatches(batches, () => true, storage), 1)
  assert.match(data, /^gzip:/)
  assert.deepEqual(await readBatches(storage), batches)
})
