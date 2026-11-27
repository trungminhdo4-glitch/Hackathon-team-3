import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyClaims, extractClaims, fixtureProvider, fixtureFetcher, createController, adjudicate, verifyFlags, combineAtoms } from '../index.js';

const V = { vendor_id: 'acme', vendor_name: 'Acme Cloud', vendor_domain: 'https://acmecloud.example/' };
const NOW = new Date('2026-11-27');
const claim = s => extractClaims([{ statement: s, ...V }]);
const ev = o => ({ used_for_verdict: true, quote_verified: true, quote: 'x', url: 'https://src.example/a', ...o });

test('redirected citations use the publisher that supplied the passage', async () => {
  const quote = 'Acme Cloud supports SCIM provisioning for all customers.';
  const url = 'https://acmecloud.example/announcement';
  const requested = 'https://reuters.com/obsolete-link';
  const fetcher = { fetch: async () => ({ url, text: quote }) };
  const [v] = await verifyClaims(claim(quote), [{ url: requested, quote, source_type: 'news' }], null, {}, { fetcher, now: NOW });
  assert.equal(v.evidence.length, 1);
  assert.equal(v.evidence[0].url, url);
  assert.equal(v.evidence[0].source_type, 'vendor');
  assert.equal(v.evidence[0].independent, false);
});

test('cached replay and discovery follow the same redirected publisher as live verification', async () => {
  const { refetchDocuments } = await import('../replay.js');
  const { saasLensToFlags } = await import('../adapters.js');
  const { discover } = await import('../discovery.js');
  const requested = 'https://example.org/customer-story';
  const url = 'https://acmecloud.example/customers';
  const text = 'A major retailer selected Acme Cloud for its next nationwide deployment.';
  const fetcher = { fetch: async () => ({ url, text }) };
  const entry = { documents: [{ id: 'S1', url: requested }], flags: [{ kind: 'green', text, evidence: [{ sourceId: 'S1', quote: text, relation: 'customer' }] }] };
  await refetchDocuments({ vendor: entry }, fetcher);
  const source = saasLensToFlags(V.vendor_domain, entry).flags[0].evidence[0];
  assert.equal(source.url, url);
  assert.equal(source.source_type, undefined);
  const result = await discover({ name: V.vendor_name, domain: V.vendor_domain,
    findings: [{ topic: 'customer', status: 'INSUFFICIENT_EVIDENCE' }] },
    { provider: { search: async () => [{ url: requested }] }, fetcher, maxTasks: 7 });
  assert.ok(result.tasks.some(t => t.category === 'CUSTOMER_REALITY'));
  assert.equal(result.findings.length, 0);
});

test('provenance: full raw_content wins over a snippet that says something else', async () => {
  const provider = { search: async () => [{ url: 'https://news.example/a', title: 'a',
    content: 'Acme Cloud supports SCIM provisioning.',
    raw_content: 'Acme Cloud does not offer user provisioning today. Billing is monthly.' }] };
  const [v] = await verifyClaims(claim('Acme Cloud supports SCIM provisioning.'), [], provider, { maxSearchesPerClaim: 1, maxRounds: 1 }, { now: NOW });
  assert.notEqual(v.status, 'SUPPORTED');
  assert.ok(v.evidence.every(e => e.quote !== 'Acme Cloud supports SCIM provisioning.'));
});

test('provenance: snippet-only result never verifies a quote', async () => {
  const provider = { search: async () => [{ url: 'https://news.example/b', title: 'b', content: 'Acme Cloud supports SCIM provisioning for all plans.' }] };
  const [v] = await verifyClaims(claim('Acme Cloud supports SCIM provisioning.'), [], provider, { maxSearchesPerClaim: 1, maxRounds: 1 }, { now: NOW });
  assert.equal(v.status, 'INSUFFICIENT_EVIDENCE');
});

test('global budget: one controller caps searches across separate calls', async () => {
  let calls = 0;
  const provider = { search: async () => { calls++; return []; } };
  const ctl = createController({ maxSearches: 3 });
  for (const s of ['Acme Cloud supports SCIM provisioning.', 'Acme Cloud supports SAML SSO.', 'Acme Cloud supports LDAP sync.']) {
    await verifyClaims(claim(s), [], provider, { maxSearchesPerClaim: 4 }, { controller: ctl, now: NOW });
  }
  assert.equal(calls, 3);
  assert.ok(ctl.stats.skippedByBudget > 0);
});

test('deadline: an expired controller performs no searches and abstains', async () => {
  let calls = 0;
  const ctl = createController({ deadline: new Date(Date.now() - 1000) });
  const [v] = await verifyClaims(claim('Acme Cloud supports SCIM provisioning.'), [], { search: async () => { calls++; return []; } }, {}, { controller: ctl, now: NOW });
  assert.equal(calls, 0);
  assert.equal(v.trace.gate, 'ABSTAIN');
});

test('sufficiency gate: well-documented capability is accepted without new searches', async () => {
  let calls = 0;
  const content = 'Acme Cloud supports SCIM provisioning. Create a SCIM token under Settings.';
  const team = [{ url: 'https://docs.acmecloud.example/scim', quote: 'Acme Cloud supports SCIM provisioning.', content }];
  const [v] = await verifyClaims(claim('Acme Cloud supports SCIM provisioning.'), team, { search: async () => { calls++; return []; } }, {}, { now: NOW });
  assert.equal(v.status, 'SUPPORTED');
  assert.equal(v.trace.gate, 'ACCEPT_EXISTING_EVIDENCE');
  assert.equal(calls, 0);
});

test('sufficiency gate: high-impact supported claim still gets one contradiction search', async () => {
  const queries = [];
  const content = 'The FTC fined Acme Cloud $1 million for deceptive claims.';
  const team = [{ url: 'https://www.ftc.gov/news/acme', quote: content, content }];
  const [v] = await verifyClaims(claim('The FTC fined Acme Cloud $1 million for deceptive claims.'), team,
    { search: async q => { queries.push(q); return []; } }, {}, { now: NOW });
  assert.equal(v.status, 'SUPPORTED');
  assert.equal(v.trace.gate, 'SEARCH_TARGETED_CONTRADICTION');
  assert.equal(queries.length, 1);
});

test('materiality: incomplete or failed research is never Green', () => {
  assert.equal(adjudicate([{ polarity: 'green', text: 'x', verdict: { status: 'INSUFFICIENT_EVIDENCE', evidence: [] } }], { incomplete: true }).overall, 'Yellow');
  assert.equal(adjudicate([], { failed: true }).overall, 'Yellow');
  assert.equal(adjudicate([]).overall, 'Yellow');
});

test('materiality: minor unknowns do not block Green when independent evidence is strong', () => {
  const r = adjudicate([
    { polarity: 'green', text: 'Product is used by Globex.', verdict: { status: 'SUPPORTED', evidence: [ev({ independent: true, source_type: 'customer' })] } },
    { polarity: 'green', text: 'Has 24/7 support.', verdict: { status: 'INSUFFICIENT_EVIDENCE', evidence: [] } },
    { polarity: 'green', text: 'Offers 40 integrations.', verdict: { status: 'INSUFFICIENT_EVIDENCE', evidence: [] } },
  ]);
  assert.equal(r.overall, 'Green');
});

test('materiality: a contradicted minor marketing claim is not Red', () => {
  const r = adjudicate([
    { polarity: 'green', text: 'Strong product.', verdict: { status: 'SUPPORTED', evidence: [ev({ independent: true, source_type: 'news' })] } },
    { polarity: 'green', topic: 'usage', text: 'Has the fastest UI.', verdict: { status: 'REFUTED', claim_type: 'marketing', evidence: [ev({ independent: true, source_type: 'news' })] } },
  ]);
  assert.notEqual(r.overall, 'Red');
});

test('materiality: contradicted customer claim is Red; unconfirmed red flag is Yellow', () => {
  const red = adjudicate([{ polarity: 'green', topic: 'customer', text: 'Trusted by Globex.', verdict: { status: 'REFUTED', claim_type: 'customer', evidence: [ev({ independent: true, source_type: 'customer' })] } }]);
  assert.equal(red.overall, 'Red');
  const y = adjudicate([{ polarity: 'red', text: 'Logos are fake.', verdict: { status: 'INSUFFICIENT_EVIDENCE', evidence: [] } }]);
  assert.equal(y.overall, 'Yellow');
});

test('materiality: vendor-admitted discontinuation is established; review-only red is not', () => {
  const r = adjudicate([{ polarity: 'red', text: 'Product is discontinued after 2026.', verdict: { status: 'SELF_REPORTED', evidence: [ev({ source_type: 'vendor' })] } }]);
  assert.equal(r.overall, 'Red');
  const rev = adjudicate([{ polarity: 'red', text: 'App lost my data.', verdict: { status: 'SUPPORTED', evidence: [ev({ independent: true, source_type: 'review_site' })] } }]);
  assert.equal(rev.overall, 'Yellow');
});

test('materiality: material yellow tradeoff gives Yellow, not Red', () => {
  const r = adjudicate([
    { polarity: 'green', text: 'Real product.', verdict: { status: 'SUPPORTED', evidence: [ev({ independent: true, source_type: 'news' })] } },
    { polarity: 'yellow', material: true, text: 'Single maintainer.', verdict: { status: 'SELF_REPORTED', evidence: [ev({ source_type: 'vendor' })] } },
  ]);
  assert.equal(r.overall, 'Yellow');
});

test('combineAtoms keeps support of valid atoms and narrows the statement', () => {
  const a = { claim: 'Globex is a customer of Acme Cloud.', status: 'SUPPORTED', evidence: [ev({ url: 'https://globex.example/x' })], limitations: [] };
  const b = { claim: 'Telekom is a customer of Acme Cloud.', status: 'INSUFFICIENT_EVIDENCE', evidence: [], limitations: [] };
  const c = combineAtoms([a, b]);
  assert.equal(c.status, 'PARTIALLY_SUPPORTED');
  assert.equal(c.narrowed, 'Globex is a customer of Acme Cloud.');
  assert.equal(c.evidence[0].url, 'https://globex.example/x');
});

test('low follower count is not proof that customer logos are fake', async () => {
  const corpus = [{ url: 'https://linkedin.example/acme', title: 'Acme Cloud | LinkedIn', content: 'Acme Cloud has 3 followers and 1 employee on LinkedIn.' }];
  const { row } = await verifyFlags({ id: 9, url: V.vendor_domain, vendor: 'Acme Cloud', domain: V.vendor_domain },
    [{ polarity: 'red', material: true, text: 'The customer logos on the Acme Cloud website are fabricated.' }],
    fixtureProvider(corpus), { maxSearchesPerClaim: 2 }, { fetcher: fixtureFetcher(corpus), now: NOW });
  assert.notEqual(row.overall, 'Red');
  assert.doesNotMatch(row.red_flags, /fabricated/);
});

test('judge is skipped for clear low-impact support and cannot override a locked numeric refutation', async () => {
  let calls = 0;
  const judge = async (c, ev) => { calls++; return ev.map(e => ({ evidence_id: e.id, stance: 'supports', entity_match: true, entailment: 'direct' })); };
  const doc = 'Acme Cloud supports SCIM provisioning. Create a token under Settings.';
  await verifyClaims(claim('Acme Cloud supports SCIM provisioning.'), [{ url: 'https://docs.acmecloud.example/scim', quote: 'Acme Cloud supports SCIM provisioning.', content: doc }], null, {}, { judge, now: NOW });
  assert.equal(calls, 0);
  const news = 'After the layoffs, Acme Cloud has about 450 employees, according to filings.';
  const [v] = await verifyClaims(claim('Acme Cloud has more than 2,000 employees.'), [{ url: 'https://www.reuters.com/x', quote: news, content: news, publication_date: '2026-10-01' }],
    null, {}, { judge: async (c, ev) => ev.map(e => ({ evidence_id: e.id, stance: 'supports', entity_match: true })), now: NOW });
  assert.equal(v.status, 'REFUTED');
});

test('judge partial entailment narrows support instead of confirming the full claim', async () => {
  const doc = 'Acme Cloud supports SAML login for enterprise workspaces.';
  const team = [{ url: 'https://news.example/acme-sso', quote: doc, content: doc }];
  const judge = async (c, ev) => ev.map(e => ({ evidence_id: e.id, stance: 'supports', entity_match: true, entailment: 'partial', scope_match: false, explanation: 'only enterprise workspaces' }));
  const [v] = await verifyClaims(extractClaims([{ statement: 'Trusted by Globex.', ...V }]).map(c => ({ ...c, text: 'Globex is a customer of Acme Cloud.' })), [], null, {}, { judge, now: NOW });
  assert.equal(v.status, 'INSUFFICIENT_EVIDENCE');
  const [w] = await verifyClaims([{ ...claim('Acme Cloud supports SAML login.')[0], qualifiers: { materiality: 'high' } }], team, null, {}, { judge, now: NOW });
  assert.equal(w.status, 'PARTIALLY_SUPPORTED');
});

test('growth from an older lower figure is not a refutation', async () => {
  const corpus = [
    { url: 'https://acmecloud.example/', title: 'Acme', content: 'Acme Cloud is used by over 57 million people worldwide.' },
    { url: 'https://web.archive.org/web/2021/https://acmecloud.example/', title: 'Acme 2021', content: 'Acme Cloud is used by over 9 million people worldwide.', published_date: '2021-05-01' },
  ];
  const [v] = await verifyClaims(claim('Acme Cloud is used by over 57 million people.'), [], fixtureProvider(corpus), {}, { fetcher: fixtureFetcher(corpus), now: NOW });
  assert.notEqual(v.status, 'REFUTED');
});
