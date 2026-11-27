import assert from 'node:assert/strict';
import test from 'node:test';
import { assess } from '../server/assessment.js';
import { fixtureResearch } from '../server/fixtures.js';

const url = 'https://orbit-fixture.example/';
const fixture = scenario => fixtureResearch(url, scenario);

test('confirmed checks award 40, 30, 20, and 10 points from traceable passages', () => {
  const result = assess(url, fixture('credible'));
  assert.equal(result.verdict, 'green');
  assert.equal(result.score, 100);
  assert.deepEqual(result.checks.map(check => check.points), [40, 30, 20, 10]);
  assert.ok(result.checks.every(check => check.evidenceIds.every(id => result.sources.some(source => source.id === id))));
});

test('an authoritative contradiction overrides positive points', () => {
  const research = fixture('contradiction');
  const positive = fixture('credible');
  research.productName = positive.productName; // The product named in the technical documentation.
  research.documents.push(positive.documents[2]);
  research.checks.push(positive.checks[3]);
  const result = assess(url, research);
  assert.equal(result.verdict, 'red');
  assert.equal(result.score, 10);
});

test('incomplete retrieval stays yellow even with positive findings', () => {
  const partial = assess(url, fixture('timeout'));
  assert.equal(partial.verdict, 'yellow');
  assert.equal(partial.score, 0);
  const research = fixture('credible');
  research.incomplete = true;
  assert.equal(assess(url, research).verdict, 'yellow');
});

test('complete retrieval failure leaves the score and verdict unset', () => {
  const result = assess(url, { documents: [], checks: [], incomplete: true, limitations: ['Network timeout.'] });
  assert.equal(result.score, null);
  assert.equal(result.verdict, null);
});

test('fabricated source IDs and unmatched quotes are rejected', () => {
  const result = assess(url, fixture('fabricated'));
  assert.equal(result.verdict, 'yellow');
  assert.equal(result.score, 40);
  assert.deepEqual(result.sources.map(source => source.id), ['S1']);
  assert.deepEqual(result.checks.slice(1).map(check => check.evidence), [[], [], []]);
  assert.ok(result.limitations.some(item => item.includes('citation')));
});

test('vendor-authored external posts and vendor subdomains cannot corroborate independently', () => {
  const externalPost = fixture('credible');
  externalPost.checks[1].evidence[0].vendorAuthored = true;
  assert.equal(assess(url, externalPost).verdict, 'yellow');
  const related = fixture('credible');
  related.documents[1].url = 'https://partners.orbit-fixture.example/case-study';
  assert.equal(assess(url, related).checks[1].status, 'unverified');
});

test('matches the actual domain and rejects partial hostname matches', () => {
  for (const wrongHost of ['fakeorbit-fixture.example', 'orbit-fixture.example.attacker.com', 'other.orbit-fixture.example']) {
    const research = fixture('credible');
    const text = research.documents[1].text.replace('orbit-fixture.example', wrongHost);
    research.documents[1].text = text;
    research.checks[1].evidence[0].quote = text;
    assert.equal(assess(url, research).checks[1].status, 'unverified', wrongHost);
  }
});

test('a self-declared or ambiguous contradiction cannot trigger red', () => {
  const research = fixture('contradiction');
  research.checks[0].evidence[0].relation = 'vendor';
  assert.equal(assess(url, research).verdict, 'yellow');
  const ambiguous = fixture('contradiction');
  const quote = 'The domain orbit-fixture.example has received a correction request.';
  ambiguous.documents[1].text = quote;
  ambiguous.checks[0].evidence[0].quote = quote;
  assert.equal(assess(url, ambiguous).verdict, 'yellow');
});

test('hypotheticals, negations and a different subject cannot trigger red', () => {
  for (const [text, quote = text] of [
    ['It is false that orbit-fixture.example impersonates our operator.', 'orbit-fixture.example impersonates our operator.'],
    ['If orbit-fixture.example is reserved for documentation, contact our office.'],
    ['Is orbit-fixture.example impersonating the operator?'],
    ['The official domain orbit-fixture.example warned users that fake.example impersonates the company.'],
    ['Technical teams at orbit-fixture.example prevent impersonation.'],
    ['The domain orbit-fixture.example is not a placeholder.'],
  ]) {
    const research = fixture('contradiction');
    research.documents[1].text = text;
    research.checks[0].evidence[0].quote = quote;
    assert.equal(assess(url, research).verdict, 'yellow', text);
  }
});

test('a website-wide link cannot corroborate a similarly named product', () => {
  const research = fixture('credible');
  research.productName = 'Orbit Desk';
  const quote = 'Our integration creates a support ticket in Orbit Desk.';
  const doc = research.documents[1];
  doc.text = quote + ' Sponsors include Orbit Desk.';
  doc.links = [url];
  research.checks[1].evidence[0].quote = quote;
  assert.equal(assess(url, research).verdict, 'yellow');
  doc.linkContexts = [{ url, text: 'Sponsors include Orbit Desk.' }];
  assert.equal(assess(url, research).verdict, 'yellow');
  doc.linkContexts = [{ url, text: quote }];
  assert.equal(assess(url, research).verdict, 'green');
});

test('copied vendor evidence and the same publisher cannot corroborate themselves', () => {
  const copied = fixture('credible');
  copied.documents[0].text += ' ' + copied.documents[1].text;
  assert.equal(assess(url, copied).verdict, 'yellow');
  const repeated = fixture('credible');
  repeated.checks[0].evidence = repeated.checks[1].evidence;
  assert.equal(assess(url, repeated).verdict, 'yellow');
});

test('unsupported model summaries are never rendered as facts', () => {
  const research = fixture('credible');
  research.checks[1].summary = 'A government agency guarantees this product is safe.';
  research.checks[1].evidence.push(research.checks[1].evidence[0]);
  const result = assess(url, research);
  assert.equal(result.checks[1].evidence.length, 1);
  assert.ok(!JSON.stringify(result).includes('government agency'));
  assert.ok(result.interpretation.includes(research.documents[1].text));
});

test('a documentation-example notice cannot earn identity or product-documentation points', () => {
  const research = fixture('credible');
  const notice = 'This domain is for use in documentation examples without needing permission.';
  research.documents[0].text = notice;
  research.checks[0].evidence[0].quote = notice;
  const result = assess(url, research);
  assert.equal(result.verdict, 'yellow');
  assert.equal(result.score, 0);
  assert.ok(result.limitations.some(value => value.includes('placeholder')));
  assert.ok(result.checks[0].evidence.some(item => item.quote === notice));
  assert.ok(result.sources.some(source => source.url === url));
});

test('generic navigation cannot establish a product or concrete documentation', () => {
  const research = fixture('credible');
  const navigation = 'Home About Us Documentation Learn more Sign in';
  research.documents[0].text = navigation;
  research.documents[2].text = navigation;
  research.checks[0].evidence[0].quote = navigation;
  research.checks[3].evidence[0].quote = navigation;
  const result = assess(url, research);
  assert.equal(result.checks[0].status, 'unverified');
  assert.equal(result.checks[3].status, 'unverified');
});

test('product answer, vendor and flags retain actual source IDs and original wording', () => {
  const raw = fixture('credible');
  const quote = 'Orbit Desk business users require a commercial license.';
  raw.documents[0].text += ' ' + quote;
  const evidence = [{ sourceId: 'S1', quote, relation: 'vendor', vendorAuthored: true }];
  raw.answer = { text: 'Commercial use is free.', evidence };
  raw.vendor = { name: 'Orbit Desk Labs Ltd', evidence: raw.checks[2].evidence };
  raw.flags = [
    { kind: 'yellow', text: quote, evidence },
    { kind: 'green', text: 'Guaranteed support.', evidence: [{ ...evidence[0], quote: 'Guaranteed support.' }] },
    { kind: 'red', text: quote, evidence },
  ];
  const result = assess(url, raw);
  assert.equal(result.vendor, raw.vendor.name);
  assert.deepEqual(result.answer.evidenceIds, ['S1']);
  assert.equal(result.answer.text, quote);
  assert.deepEqual(result.flags.map(f => [f.kind, f.text]), [['yellow', quote]]);
  assert.ok(!JSON.stringify(result).includes('Commercial use is free'));
});

test('an exact quote about a different product or a feature cannot award operator points', () => {
  const raw = fixture('credible');
  const quote = 'Another Suite supports SDK authentication for enterprise customers.';
  raw.documents[2].title = 'Another Suite API guide';
  raw.documents[2].text = quote;
  const evidence = [{ sourceId: 'S3', quote, relation: 'vendor', vendorAuthored: true }];
  raw.checks[2].evidence = raw.checks[3].evidence = evidence;
  raw.answer = { text: quote, evidence };
  raw.vendor = { name: 'Unrelated Legal Entity', evidence };
  const result = assess(url, raw);
  assert.equal(result.vendor, null);
  assert.equal(result.answer, null);
  assert.equal(result.checks[2].points + result.checks[3].points, 0);
});

test('a final authority action about the exact product can override positive points', () => {
  const raw = fixture('credible');
  const quote = 'The agency ordered Orbit Desk to stop selling identifiable customer records.';
  raw.documents.push({ id: 'S4', origin: 'web_search', url: 'https://oversight.example/order', title: 'Final order', text: quote });
  raw.flags = [{ kind: 'red', text: quote, evidence: [{ sourceId: 'S4', quote, relation: 'authority', vendorAuthored: false }] }];
  assert.equal(assess(url, raw).verdict, 'red');
  raw.documents[3].text = 'The agency never said: ' + quote;
  assert.equal(assess(url, raw).verdict, 'green');
  const unrelated = 'The agency ordered Another Vendor to stop impersonating Orbit Desk.';
  raw.documents[3].text = raw.flags[0].evidence[0].quote = unrelated;
  assert.equal(assess(url, raw).verdict, 'green');
});

function addReview(raw, quote, { local = false, author = 'Casey Lee', byline = 'By Casey Lee: ' } = {}) {
  const sourceId = 'R' + raw.documents.length;
  raw.documents.push({ id: sourceId, origin: 'web_search', title: 'Review of Orbit Desk',
    url: local ? url + 'testimonials' : 'https://buyer-forum.example/experiences', text: byline + quote });
  const item = { sourceId, quote, relation: 'review', vendorAuthored: false, author };
  raw.testimony ??= [];
  raw.testimony.push({ text: quote, evidence: [item] });
  return item;
}

test('a signed independent account can confirm observed use at the exact domain', () => {
  const raw = fixture('credible');
  const quote = 'We deployed Orbit Desk at orbit-fixture.example to route tickets to our support team.';
  raw.checks[1].evidence = [addReview(raw, quote)];
  const report = assess(url, raw);
  assert.equal(report.checks[1].points, 30);
  assert.match(report.checks[1].explanation, /firsthand use/);
  const [review] = report.testimony;
  assert.equal(review.evidence[0].attribution, 'Casey Lee · buyer-forum.example');
  assert.equal(review.evidence[0].sourceType, 'User review');
  assert.match(review.explanation, /contributes to the independent identity check/);
});

test('vendor-hosted testimonials and reviews without a domain link remain contextual', () => {
  for (const local of [true, false]) {
    const raw = fixture('credible');
    const quote = 'I use Orbit Desk daily to manage tickets for our support team.';
    raw.checks[1].evidence = [addReview(raw, quote, { local, author: 'Someone Else' })];
    const report = assess(url, raw);
    assert.equal(report.verdict, 'yellow');
    assert.equal(report.checks[1].points, 0);
    assert.equal(report.testimony.length, 1);
    assert.equal(report.testimony[0].evidence[0].sourceType, local ? 'Vendor-hosted testimonial' : 'User review');
    assert.match(report.testimony[0].explanation, /contributes no points/);
    assert.ok(!JSON.stringify(report).includes('Someone Else'));
    assert.match(report.checks[1].diagnostics.join(' '), local ? /independent publisher/ : /exact submitted domain/);
  }
});

test('sentiment, wrong-edition testimony and an unverified reviewer accusation never change the verdict', () => {
  for (const quote of ['Orbit Desk Enterprise at orbit-fixture.example is the best service ever!',
    'We deployed Orbit Desk Home at orbit-fixture.example to manage tickets.']) {
    const raw = fixture('credible');
    raw.productName = 'Orbit Desk Enterprise';
    const review = addReview(raw, quote);
    raw.checks[1].evidence = [review];
    raw.flags = ['red', 'green'].map(kind => ({ kind, evidence: [review] }));
    const result = assess(url, raw);
    assert.equal(result.checks[1].points, 0);
    assert.equal(result.flags.length + result.testimony.length, 0);
    assert.equal(result.verdict, 'yellow');
  }
});

test('a verified product-specific support cutoff can override a complete positive score with yellow', () => {
  const raw = fixture('credible');
  const quote = 'Orbit Desk is no longer supported for enterprise deployments.';
  raw.documents[0].text += ' ' + quote;
  raw.flags = [{ kind: 'yellow', topic: 'maintenance', material: true, evidence: [
    { sourceId: 'S1', quote, relation: 'vendor', vendorAuthored: true },
  ] }];
  const result = assess(url, raw);
  assert.equal(result.score, 100);
  assert.equal(result.verdict, 'yellow');
  assert.equal(result.flags[0].material, true);
  assert.match(result.interpretation, /support window/);
  raw.documents[0].text = 'It is false that ' + quote;
  assert.equal(assess(url, raw).flags[0].material, false);
});

test('an ordinary commercial license caveat remains visible with a green verdict', () => {
  const raw = fixture('credible');
  const quote = 'Orbit Desk requires a commercial license for business use.';
  raw.documents[0].text += ' ' + quote;
  raw.flags = [{ kind: 'yellow', topic: 'licensing', material: true, evidence: [
    { sourceId: 'S1', quote, relation: 'vendor', vendorAuthored: true },
  ] }];
  const report = assess(url, raw);
  assert.equal(report.verdict, 'green');
  assert.equal(report.flags[0].material, false);
  assert.match(report.flags[0].explanation, /entitlement/);
});

test('unverified checks explain missing sources, rejected quotations, and the next evidence needed', () => {
  const report = assess(url, fixture('fabricated'));
  assert.match(report.checks[1].diagnostics.join(' '), /no readable source/);
  assert.match(report.checks[2].diagnostics.join(' '), /could not be matched/);
  assert.match(report.checks[3].explanation, /setup steps/);
  for (const check of report.checks) assert.ok(check.explanation.length > 10);
});

test('a supplied page can ground a display name and its publisher-prefixed short form for a scoped FAQ answer', () => {
  const raw = fixture('credible');
  raw.productName = 'Orbit Desk Enterprise (business, web edition)';
  const product = 'Orbit Desk Enterprise';
  const q = 'Q: Which plans include Desk Enterprise?';
  const first = 'Desk Enterprise is included with eligible business licenses.';
  const second = 'When you add a Premium license, Desk Enterprise includes organizational search.';
  const other = 'Other Desk is included only with a campus subscription.';
  raw.documents[0].url = 'https://orbit.example/desk/enterprise';
  raw.documents[0].title = product;
  raw.documents[0].text = product + ' provides a web application for business teams. Open Desk Enterprise for your work account.';
  raw.documents[2] = { ...raw.documents[2], url: 'https://orbit.example/faq', title: 'Licensing FAQ',
    text: [q, first, second, 'Q: Who can use Other Desk?', other].join(' ') };
  raw.answer = { evidence: [{ sourceId: 'S3', quote: q, relation: 'vendor', vendorAuthored: true }] };
  const report = assess(raw.documents[0].url, raw);
  assert.equal(report.productName, product);
  assert.equal(report.answer.text, first + ' ' + second);
  assert.deepEqual(report.answer.evidence.map(e => e.quote), [first, second]);
  raw.productName = 'Orbit Desk Enterprise (unreleased gold edition)';
  assert.equal(assess(raw.documents[0].url, raw).answer, null);
});

test('question headings and truncated comparison tables alone cannot become a product answer', () => {
  const raw = fixture('credible');
  const heading = 'Which plans include Orbit Desk?';
  const table = 'Price table Basic license Team license Pro license Custom license ' + 'Yes Yes No '.repeat(33);
  raw.documents[0].text += ' ' + heading + ' ' + table;
  raw.answer = { evidence: [heading, table.trim()].map(quote => ({ sourceId: 'S1', quote, relation: 'vendor' })) };
  assert.equal(assess(url, raw).answer, null);
});

test('verdict sources are drawn only from the checks or flags that decided the result', () => {
  assert.deepEqual(assess(url, fixture('credible')).verdictEvidenceIds, ['S1', 'S2']);
  assert.deepEqual(assess(url, fixture('contradiction')).verdictEvidenceIds, ['S2']);
  assert.deepEqual(assess(url, fixture('timeout')).verdictEvidenceIds, []);
  const raw = fixture('credible');
  raw.coverage = { independent: { searched: true, discovered: 1, retrieved: 1 } };
  const out = assess(url, raw);
  assert.equal(out.verdict, 'green');
  assert.match(out.limitations.join(' '), /no validated firsthand account/);
});
