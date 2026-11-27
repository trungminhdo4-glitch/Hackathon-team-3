import assert from 'node:assert/strict'
import test from 'node:test'
import { columns, datasetRow, csvReport, csvReports, markdownReport, savedGapDetail } from '../src/datasetReport.js'

test('an insufficient report exports its verdict, verified flags, and human notes separately', () => {
  const report = { rubricVersion: 2, verdict: 'insufficient', productName: 'Acme', vendor: null,
    sources: [], checks: [], interpretation: 'The available evidence is limited.' }
  const row = datasetRow(report)
  assert.deepEqual(Object.keys(row), columns)
  assert.equal(row.vendor, 'Unverified')
  assert.equal(row.overall, 'Insufficient evidence')
  assert.match(row.red_flags, /risks remain unverified.*available evidence/i)
  assert.equal(row.reviewer_notes_original, '')
})

test('a finalized evidence gap exports Yellow with the specific reason and separate reviewer notes', () => {
  const row = datasetRow({ rubricVersion: 2, verdict: 'yellow', verdictBasis: 'evidence_gap', productName: 'Acme',
    sources: [], checks: [], interpretation: 'No deployment guide identifies the advertised edition.' }, 'Recheck next month.')
  assert.equal(row.overall, 'Yellow')
  assert.match(row.reasoning, /unresolved evidence gap.*No deployment guide/)
  assert.equal(row.reviewer_notes_original, 'Recheck next month.')
  assert.match(csvReport(row), /"Yellow"/)
})

test('older no-finding reports export the submitted address and activity trail without treating checked URLs as proof', () => {
  const inputUrl = 'https://archive.example/'
  const guide = 'https://external.example/guide'
  const report = {rubricVersion:2, productName:'Archive Desk', inputUrl, vendor:null, verdict:'yellow',
    checks:[],sources:[], limitations:['Some official search pages could not supply readable public text.'],
    interpretation:'Private-team synchronization could not be verified.',
    activity:[{stage:'retrieve',detail:'Retrieved readable source text',url:guide}]}
  const row = datasetRow(report)
  assert.equal(row.overall,'Yellow')
  assert.match(row.green_flags,/Archive Desk.*No citation/)
  assert.ok(row.green_flags.includes(inputUrl))
  assert.match(row.green_flags,/again to collect/)
  assert.match(row.reasoning,/Readable page recorded in the activity log/)
  assert.ok(row.reasoning.includes(guide))
  assert.doesNotMatch(row.green_flags + row.red_flags,/Some official search pages/)
  assert.ok(!row.red_flags.includes(guide))
  assert.match(row.vendor,/no verified passage naming the operator/)
})

test('flags explain the particular benefit or caution and preserve scoped observations with their citations', () => {
  const finding = { id: 'licensing', label: 'Licensing and access', status: 'supported', impact: 'routine',
    flag: 'green', claim: 'The team plan includes single sign-on.', explanation: 'The plan guide lists the entitlement.',
    consequence: 'The team can link its existing directory.', evidence: [{sourceId: 'S1'}], evidenceIds: ['S1'] }
  const report = { rubricVersion: 2, verdict: 'insufficient', interpretation: 'The core outcome remains open.',
    sources: [{id: 'S1', url: 'https://acme.example/docs'}], checks: [finding, {
      ...finding, id: 'experience', label: 'Customer experience', flag: 'context', claim: 'One team tested sign-on.',
    }] }
  const row = datasetRow(report)
  assert.match(row.green_flags, /includes single sign-on.*guide lists the entitlement/)
  assert.match(row.green_flags, /https:\/\/acme.example\/docs/)
  assert.doesNotMatch(row.green_flags, /One team/)
  assert.match(row.reasoning, /One team tested sign-on/)
  assert.match(row.red_flags, /did not establish a disqualifying risk/)
  const original = datasetRow({...report, checks: [{...finding, flag: undefined}]})
  assert.match(original.green_flags, /No strength was classified.*includes single sign-on/)
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

test('saved generic activity is explained from its specific unresolved claim without changing the recorded verdict', () => {
  const claim = 'The basic edition synchronizes team calendars across devices.'
  const report = {rubricVersion:2, verdict:'yellow', verdictBasis:'evidence_gap', productName:'Orbit',
    inputUrl:'https://orbit.example/', interpretation:'Evidence is inconclusive.', sources:[],
    activity:[{stage:'validate',detail:'Evidence review found an unresolved core claim. 0 sources passed citation checks.'}],
    checks:[{id:'capability', status:'unverified', claim, evidence:[]}]}
  const row = datasetRow(report)
  assert.equal(row.overall, 'Yellow')
  assert.ok(row.reasoning.includes(claim))
  assert.match(row.reasoning, /no verified passage/i)
  const prompt = 'Which deployment shows the agent running with the signed-in user’s permissions?'
  assert.equal(savedGapDetail({...report, review:{mode:'sdk', prompt}}).missing, prompt)
  assert.ok(!datasetRow({...report, verdict:'green', verdictBasis:null}).reasoning.includes(claim))
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

test('context from a product page survives absent flags without turning the vendor claim into a verified benefit', () => {
  const url = 'https://product.example/pricing'
  const quote = 'Team workspaces include a scheduling calendar and allow up to four editors.'
  const report = { rubricVersion:2, productName:'Scheduler', inputUrl:url, verdict:'yellow', verdictBasis:'evidence_gap',
    interpretation:'No recorded deployment establishes how scheduling works for a team.', checks:[], sources:[],
    dossier: {observations:[{url, title:'Workspace pricing', kind:'Product page', status:'documented', quote,
      finding:'The publisher describes team scheduling.', reason:'Publisher description of the team plan.'}],
    coverage:[{url, title:'Workspace pricing', origin:'submitted', status:'documented', reason:'A publisher claim was retained.'},
      {url:'https://research.example/trial', title:'Independent trial', status:'unavailable', reason:'The page could not be read.'}]}}
  const row = datasetRow(report, 'Verify with a customer.')
  assert.deepEqual(Object.keys(row),columns)
  assert.match(row.vendor,/Operator unverified.*\n.*Scheduler/)
  assert.ok(row.green_flags.includes(quote))
  assert.ok(row.green_flags.includes(url))
  assert.match(row.green_flags, /remains open/)
  assert.ok(row.yellow_flags.includes(report.interpretation))
  assert.ok(row.reasoning.includes('Independent trial'))
  const markdown = markdownReport(row,report)
  assert.match(markdown,/## What the sources say/)
  assert.ok(markdown.includes('> ' + quote))
  const punctuation = {...report, dossier: {...report.dossier, observations: [{...report.dossier.observations[0], quote: 'Plans #1 & #2!'}]}}
  assert.ok(markdownReport(row, punctuation).includes('> Plans &#35;1 &#38; &#35;2&#33;'))
  assert.match(markdown,/## Pages checked/)
  assert.ok(markdown.includes('[Workspace pricing](<' + url + '>)'))
  const batch = csvReports([row,{...row,product:'Other'}])
  assert.equal(batch.split(columns.join(',')).length,2)
  assert.ok(batch.includes('\r\n"Other",'))
})
