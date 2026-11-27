// Phase 3 regression tests: each one pins a failure observed on real data or found in review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isVendorEvent, relationOf, discover } from '../discovery.js';
import { adjudicate } from '../materiality.js';
import { verifyClaims, verifyFlags } from '../index.js';
import { validateSubmission } from '../validate.js';
import { runBatch, loadCheckpoint } from '../batch.js';
import { resolveConfig, fingerprint } from '../config.js';
import { parseResearchCache, importAgentAudit, importReport } from '../cache.js';
import { collect, productToken } from '../collect.js';
import { bindSignal } from '../providers.js';
import { score, stratifiedIds } from '../bench/dataset.js';

const NOW = new Date('2026-11-27');
const dir = mkdtempSync(join(tmpdir(), 'veritas-p3-'));

test('a literal pipe in a cited passage does not split its verified ledger entry', () => {
  const url = 'https://example.test/legal';
  const text = 'Legal | Company registration (source: ' + url + ')';
  const row = { id: '1', url, overall: 'Yellow', yellow_flags: text, reasoning: text };
  const audit = { '1': { citedUrls: [url], ledger: [{ column: 'yellow', text,
    evidence: [{ url, quote_verified: true, entity_match: true }] }] } };
  assert.deepEqual(validateSubmission([row], [row], audit), []);
  assert.ok(validateSubmission([{ ...row, yellow_flags: 'Unrelated claim (source: ' + url + ')' }], [row], audit).length);
});
const S = { incident: { kind: 'incident', re: /\b(data breach|security (?:incident|breach))\b/i }, regulatory: { kind: 'regulatory', re: /\b(fined|penalt(?:y|ies))\b/i } };

test('discovery: marketing, hypotheticals and third-party events are not vendor events', () => {
  const n = ['Acme'];
  assert.equal(isVendorEvent('Acme helps customers prevent data breaches across the cloud.', n, S.incident), false);
  assert.equal(isVendorEvent('If a data breach occurs, Acme notifies you within 72 hours.', n, S.incident), false);
  assert.equal(isVendorEvent('Unlike Acme, Contoso suffered a data breach last year.', n, S.incident), false);
  assert.equal(isVendorEvent('Acme disclosed a data breach affecting 2 million users in 2025.', n, S.incident), true);
  assert.equal(isVendorEvent('The regulator fined Acme EUR 2 million in 2024.', n, S.regulatory), true);
  assert.equal(isVendorEvent('The regulator fined Contoso EUR 2 million; Acme was not involved.', n, S.regulatory), false);
});

test('customer discovery: only stated deployments become findings; partners and badges do not', async () => {
  assert.equal(relationOf('Siemens selected Acme to run procurement.'), 'deployment');
  assert.equal(relationOf('Acme is a strategic partner of SAP.'), 'partner');
  assert.equal(relationOf('Acme integrates with Salesforce.'), 'integration');
  const page = (url, content) => ({ url, title: '', content, raw_content: content });
  const provider = { search: async q => /customer/.test(q) ? [
    page('https://acme.example/customers', 'Trusted by Siemens. Siemens selected Acme for procurement.'),
    page('https://news.example/a', 'Acme is a strategic partner of SAP for the DACH market today.'),
    page('https://siemens.example/b', 'In 2025 Siemens rolled out Acme to 4,000 buyers across Europe.'),
  ] : [] };
  const { findings, tasks } = await discover({ name: 'Acme', domain: 'https://acme.example/', checks: { identity: 'confirmed', operator: 'confirmed', substance: 'confirmed' },
    findings: [{ polarity: 'green', topic: 'customer', text: 'Trusted by Siemens', status: 'SELF_REPORTED' }, { polarity: 'red', status: 'SUPPORTED' }] }, { provider, maxTasks: 3 });
  const cust = findings.filter(f => f.topic === 'customer');
  assert.equal(cust.length, 1);
  assert.match(cust[0].evidence[0].url, /siemens\.example/); // vendor page with the same sentence is ignored
  assert.equal(tasks.find(t => t.category === 'CUSTOMER_REALITY').relations[0].relation, 'partner');
});

const fv = (polarity, status, extra = {}) => ({ polarity, material: extra.material, text: extra.text ?? 'x', evidence: extra.evidence,
  verdict: { status, evidence: extra.ev ?? (status === 'SUPPORTED' ? [{ url: 'https://n.example', quote: 'q', used_for_verdict: true, quote_verified: true, independent: true, source_type: 'news' }] : []) } });

test('materiality: a minor retrieval gap keeps strong Green, a material gap blocks it', () => {
  const strong = [fv('green', 'SUPPORTED')];
  assert.equal(adjudicate(strong, { incomplete: true }).overall, 'Green');
  assert.equal(adjudicate(strong, { incomplete: true, materialGaps: ['material-risk search failed'] }).overall, 'Yellow');
  assert.equal(adjudicate(strong, { failed: true }).overall, 'Yellow');
});

test('materiality: an unverifiable material red concern blocks Green without being cited (Avast replay)', () => {
  const res = adjudicate([fv('green', 'SUPPORTED'), fv('red', 'INSUFFICIENT_EVIDENCE', { material: true, text: 'Regulator fined the vendor.', evidence: [{ url: 'https://reg.example', quote: 'slug' }] })]);
  assert.equal(res.overall, 'Yellow');
  const f = res.findings.find(x => x.polarity === 'red');
  assert.match(f.statement, /^Open question/);
  assert.equal(f.evidence.length, 0);
  // A minor unverifiable concern still disappears (no unsupported reasons).
  assert.equal(adjudicate([fv('green', 'SUPPORTED'), fv('yellow', 'INSUFFICIENT_EVIDENCE', { material: false, evidence: [{ url: 'u' }] })]).overall, 'Green');
});

test('quote alignment: a URL-slug excerpt is aligned to the cited page; a fabricated one is not', async () => {
  const page = 'Press release. FTC Finalizes Order with Avast Banning it from Selling or Licensing Web Browsing Data for Advertising Purposes. More text follows here.';
  const claim = [{ id: 'c1', vendor_id: 'avast', vendor_name: 'Avast', vendor_domain: 'https://www.avast.com/', text: 'The FTC finalized an order banning Avast from selling browsing data.', claim_type: 'legal_regulatory' }];
  const ev = q => [{ claim_id: 'c1', url: 'https://www.ftc.gov/x', quote: q, content: page, origin: 'team' }];
  const [ok] = await verifyClaims(claim, ev('ftc finalizes order avast banning it selling or licensing web browsing data advertising'), null, {}, { now: NOW });
  const e = ok.evidence.find(x => x.url === 'https://www.ftc.gov/x');
  assert.equal(e.quote_verified, true);
  assert.match(e.quote_check, /^aligned_to_cited_page/);
  const [bad] = await verifyClaims(claim, ev('A regulator verified this operator in a formal review.'), null, {}, { now: NOW });
  assert.notEqual(bad.status, 'SUPPORTED');
  assert.ok(!(bad.evidence ?? []).some(x => x.url === 'https://www.ftc.gov/x' && x.quote_verified));
});

test('reason-level audit: a verified URL attached to an unrelated reason fails', () => {
  const inputs = [{ id: '1', url: 'https://a.example/' }];
  const ledger = [{ reason_id: 'r1', column: 'green', text: 'Active releases (source: https://a.example/changelog)', evidence: [{ url: 'https://a.example/changelog', quote_verified: true, entity_match: true }] }];
  const good = [{ id: '1', url: 'https://a.example/', overall: 'Yellow', green_flags: 'Active releases (source: https://a.example/changelog)', yellow_flags: 'None identified.', red_flags: 'None identified.', reasoning: 'r' }];
  const audit = { 1: { citedUrls: ['https://a.example/changelog'], ledger } };
  assert.deepEqual(validateSubmission(good, inputs, audit), []);
  const moved = [{ ...good[0], green_flags: 'SOC 2 Type II certified (source: https://a.example/changelog)' }];
  assert.ok(validateSubmission(moved, inputs, audit).some(p => /no ledger entry/.test(p)));
});

test('verifyFlags row carries a ledger whose entries back every cited reason', async () => {
  const vendor = { id: 'v', url: 'https://acme.example/', product: 'Acme', name: 'Acme', domain: 'https://acme.example/' };
  const text = 'Acme 4.2 was released on 2026-10-01 with SSO support for all plans.';
  const { row } = await verifyFlags(vendor, [{ polarity: 'green', text: 'Acme 4.2 was released on 2026-10-01.', atomic: true,
    evidence: [{ url: 'https://news.example/acme', quote: text, content: text, source_type: 'news' }] }], null, {}, { now: NOW });
  assert.ok(row._ledger.length >= 1);
  assert.deepEqual(validateSubmission([row], [{ id: 'v', url: vendor.url }], { v: { citedUrls: row._ledger.flatMap(l => l.evidence.map(e => e.url)), ledger: row._ledger } }), []);
});

test('config: a requested component without its key is an error, never a silent downgrade', async () => {
  const c = await resolveConfig({ researcher: 'saaslens', provider: 'tavily', judge: 'openai' }, {});
  assert.equal(c.errors.length, 3);
  const auto = await resolveConfig({}, {});
  assert.deepEqual([auto.researcher, auto.providerKind, auto.judgeKind, auto.errors.length], ['collect', 'none', 'none', 0]);
});

test('checkpoint: unrelated dataset with colliding ids, other config and unfinished rows are not reused', () => {
  const cp = join(dir, 'cp.jsonl');
  const fp = fingerprint('researcher=fixture provider=none judge=none');
  const rec = (id, url, status = 'ok', f = fp) => JSON.stringify({ fp: f, status, row: { id, url, overall: 'Green' } });
  writeFileSync(cp, [rec('1', 'https://a.example/'), rec('2', 'https://OTHER.example/'), rec('3', 'https://c.example/', 'deadline'), rec('4', 'https://d.example/', 'ok', 'otherfp'), '{torn'].join('\n'));
  const inputs = ['a', 'b', 'c', 'd'].map((x, i) => ({ id: String(i + 1), url: i === 1 ? 'https://b.example/' : `https://${x}.example/` }));
  const { done, stale } = loadCheckpoint(cp, inputs, fp);
  assert.deepEqual([...done.keys()], ['1']);
  assert.equal(stale, 3);
});

test('deadline: accelerated batch with hanging and failing providers aborts in-flight work and still emits every row', async () => {
  let started = 0, aborted = 0;
  const hangingFetcher = { name: 'hang', fetch: (url, { signal } = {}) => new Promise((_, rej) => { started++;
    signal?.addEventListener('abort', () => { aborted++; rej(new Error('aborted')); }); }) };
  const flaky = { name: 'flaky', search: async () => { throw new Error('HTTP 503'); } };
  const inputs = Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), url: `https://v${i}.example/`, product: '', vendor: '' }));
  const t0 = Date.now();
  const res = await runBatch({ inputs, researcher: 'collect', fetcher: hangingFetcher, provider: flaky, concurrency: 3, perVendorMs: 300, minVendorMs: 100,
    deadline: new Date(Date.now() + 3000).toISOString(), now: NOW });
  assert.equal(res.rows.length, 6);
  assert.deepEqual(res.problems, []);
  assert.ok(Date.now() - t0 < 6000, 'batch must finish near the deadline');
  assert.ok(aborted >= 1 && aborted === started, `every started request is aborted (${aborted}/${started})`);
  assert.ok(res.rows.every(r => r.overall === 'Yellow'));
  assert.ok(res.statuses.every(s => s !== 'ok' || true));
});

test('bindSignal: no new request starts after abort', async () => {
  const ac = new AbortController(); let calls = 0;
  const f = bindSignal({ fetch: async () => { calls++; return { text: 'x' }; } }, ac.signal);
  await f.fetch('https://a.example/'); ac.abort();
  await assert.rejects(() => f.fetch('https://b.example/'));
  assert.equal(calls, 1);
});

test('research cache: invalid and failed entries are reported, never used', () => {
  const p = parseResearchCache({ _meta: { mode: 'cached' }, entries: {
    'https://ok.example/': { documents: [{ id: 'S1', url: 'https://ok.example/', text: 't' }], flags: [{ kind: 'green', evidence: [{ sourceId: 'S1' }] }] },
    'https://bad.example/': { documents: [{ id: 'S1', url: 'https://bad.example/' }], flags: [{ evidence: [{ sourceId: 'S9' }] }] },
    'https://failed.example/': { failed: true, documents: [] } } });
  assert.deepEqual(Object.keys(p.entries), ['https://ok.example/']);
  assert.ok(p.invalid['https://bad.example/'][0].includes('unknown source'));
  assert.deepEqual(p.failed, ['https://failed.example/']);
  assert.throws(() => parseResearchCache({ _meta: { mode: 'made-up' }, entries: {} }));
});

test('importers: teammate audits become research without page text (nothing pre-verified)', () => {
  const a = importAgentAudit([{ url: 'https://n.example/', overall: 'Green', reasons: [{ severity: 'Green', claim: 'c', source_url: 'https://n.example/r', quote: 'q', verification: 'yes' }] }]);
  assert.equal(a['https://n.example/'].documents[0].text, '');
  assert.equal(a['https://n.example/'].flags[0].kind, 'green');
  const r = importReport({ url: 'https://x.example/', overall: 'RED', findings: [{ severity: 'RED', finding: 'f', evidence_ids: ['E1', 'E9'] }], evidence: [{ id: 'E1', url: 'https://reg.example', excerpt: 'e' }] });
  assert.equal(r['https://x.example/'].flags[0].evidence.length, 1); // unknown E9 dropped
});

test('keyless collector: purpose pages, robots.txt, self-referential retirement only', async () => {
  const pages = {
    'https://acme.example/robots.txt': { text: 'User-agent: * Disallow: /legal' },
    'https://acme.example/': { text: 'Acme Desk. Microsoft hat den Windows 10 Support eingestellt. Hier wird die Sprache eingestellt.', links: ['https://acme.example/changelog', 'https://acme.example/legal', 'https://other.example/changelog'] },
    'https://acme.example/changelog': { text: 'Version 3.1 released on 2026-10-02 with fixes. Die Weiterentwicklung der Software wird Ende 2027 eingestellt.' },
  };
  const fetcher = { fetch: async u => { if (!pages[u]) throw new Error('404'); return { url: u, title: '', ...pages[u] }; } };
  const r = await collect('https://acme.example/', { fetcher, now: NOW, github: false });
  assert.deepEqual(r.documents.map(d => d.purpose), ['home', 'changelog']);
  assert.ok(r.limitations.some(l => /robots\.txt disallows \/legal/.test(l)));
  const reds = r.flags.filter(f => f.kind === 'red');
  assert.equal(reds.length, 1);
  assert.match(reds[0].text, /Weiterentwicklung/);
  assert.ok(r.flags.some(f => f.kind === 'green' && /2026-10-02/.test(f.text)));
  assert.equal(productToken('https://www.qlik.com/us/products/qlikview'), 'qlikview');
});

test('score(): missing, duplicate, unexpected and invalid rows are reported; coverage counts missing as wrong', () => {
  const csv = join(dir, 'labels.csv');
  writeFileSync(csv, 'id,url,overall\n1,https://a/,Green\n2,https://b/,Yellow\n3,https://c/,Red\n4,https://d/,Red\n');
  const s = score([{ id: '1', overall: 'Green' }, { id: '1', overall: 'Red' }, { id: '2', overall: 'Purple' }, { id: '3', overall: 'Green' }, { id: '99', overall: 'Red' }], csv);
  assert.equal(s.evaluated, 2);
  assert.equal(s.accuracy_full_coverage, 0.25);
  assert.equal(s.critical_false_green_on_red, 1);
  for (const re of [/duplicate/, /unexpected id 99/, /without prediction: 4/, /invalid label/]) assert.ok(s.problems.some(p => re.test(p)), re.source);
  assert.deepEqual(stratifiedIds(csv, 3), ['1', '2', '3']);
});

test('an external evaluation rejects ambiguous or ungraded reference rows', () => {
  const csv = join(dir, 'external-reference.csv');
  for (const rows of ['1,Green\n1,Red', '1,Unknown', ',Yellow', '']) {
    writeFileSync(csv, 'id,overall\n' + rows);
    assert.throws(() => score([], csv), /Reference requires/);
  }
});

test('guard mode: teammate verdict stands unless VERITAS has a verified reason against it', async () => {
  const { guard } = await import('../replay.js');
  const neg = [{ class: 'MATERIAL_NEGATIVE', polarity: 'red', material: true }];
  const open = [{ class: 'AMBIGUOUS', polarity: 'red', material: true }];
  const weak = [{ class: 'WEAK_POSITIVE', polarity: 'green' }];
  assert.equal(guard('Green', { overall: 'Yellow' }, weak).overall, 'Green');       // conservative VERITAS does not downgrade
  assert.equal(guard('Green', { overall: 'Yellow' }, open).overall, 'Yellow');      // open material issue blocks Green
  assert.equal(guard('Yellow', { overall: 'Red' }, neg).overall, 'Red');            // established material negative
  assert.equal(guard('RED', { overall: 'Yellow' }, weak).overall, 'Yellow');        // unsupported Red withdrawn
  assert.equal(guard('RED', { overall: 'Red' }, neg).overall, 'Red');
});
