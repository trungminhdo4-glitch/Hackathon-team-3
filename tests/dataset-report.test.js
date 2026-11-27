import assert from 'node:assert/strict'
import test from 'node:test'
import { columns, datasetRow, csvReport, markdownReport } from '../src/datasetReport.js'

test('an insufficient report exports its verdict, verified flags, and human notes separately', () => {
  const report = { rubricVersion: 2, verdict: 'insufficient', productName: 'Acme', vendor: null,
    sources: [], checks: [], interpretation: 'The available evidence is limited.' }
  const row = datasetRow(report)
  assert.deepEqual(Object.keys(row), columns)
  assert.equal(row.vendor, 'Unverified')
  assert.equal(row.overall, 'Insufficient evidence')
  assert.equal(row.red_flags, 'None identified.')
  assert.equal(row.reviewer_notes_original, '')
})

test('historical and simulated reports retain their provenance and recorded citations', () => {
  const report = { productName: 'Orbit', verdict: 'yellow', interpretation: 'Check the license.',
    flags: [{ kind: 'yellow', text: 'Paid license required.', evidenceIds: ['A'] }],
    sources: [{ id: 'A', url: 'https://orbit.example/terms' }] }
  const row = datasetRow(report, 'Checked by Sam.', true)
  assert.equal(row.yellow_flags, 'Paid license required.\nhttps://orbit.example/terms')
  assert.match(row.reasoning, /Simulated report. Previous points-based rubric./)
  assert.equal(row.reviewer_notes_original, 'Checked by Sam.')
})

test('CSV preserves commas, quotes and newlines and quotes formula-looking text as literal input', () => {
  const row = Object.fromEntries(columns.map(key => [key, '']))
  Object.assign(row, {product: 'A, "B"', reviewer_notes_original: '=SUM(2,3)\nNew line'})
  assert.equal(csvReport(row), columns.join(',') + '\r\n"A, ""B""","","","","","","","\'=SUM(2,3)\nNew line"\r\n')
})

test('Markdown remains an eight-column table with multiline notes, pipes and literal markup', () => {
  const row = Object.fromEntries(columns.map(key => [key, '']))
  row.reviewer_notes_original = 'A | B\r\n<img> *notes*'
  const markdown = markdownReport(row).trimEnd().split('\n')
  assert.equal(markdown.length, 3)
  assert.ok(markdown.every(line => line.split('|').length === 10))
  assert.match(markdown[2], /A &#124; B<br>&#60;img&#62; &#42;notes&#42;/)
})
