import assert from 'node:assert/strict';
import test from 'node:test';
import { assess } from '../server/assessment.js';
import { fixtureResearch } from '../server/fixtures.js';

const url = 'https://orbit.example/';
const fixture = (name = 'credible') => fixtureResearch(url, name);
const check = (result, id) => result.checks.find(c => c.id === id);
const cite = (sourceId, quote, relation = 'vendor') => ({ sourceId, quote, relation, vendorAuthored: relation === 'vendor' });

test('six claim criteria replace scores on every investigation', () => {
  for (const [scenario, verdict] of [['credible','green'], ['tier','yellow'], ['contradiction','red'],
    ['timeout','insufficient'], ['fabricated','insufficient']]) {
    const report = assess(url, fixture(scenario));
    assert.equal(report.verdict, verdict);
    assert.equal(report.rubricVersion, 2);
    assert.ok(!Object.hasOwn(report, 'score'));
    assert.deepEqual(report.checks.map(c => c.id), ['capability', 'experience', 'licensing', 'maintenance', 'security', 'credibility']);
    for (const c of report.checks) {
      assert.ok(!Object.hasOwn(c, 'points'));
      assert.ok(c.explanation && c.consequence);
      assert.ok(c.evidenceIds.every(id => report.sources.some(s => s.id === id)));
    }
  }
});

test('a partner workflow can establish the core promise without repeating the domain', () => {
  const raw = fixture();
  const report = assess(url, raw);
  assert.equal(check(report, 'capability').status, 'supported');
  assert.ok(!raw.documents[1].text.includes('orbit.example'));
  assert.equal(check(report, 'maintenance').status, 'unverified');
  assert.equal(report.interpretation, raw.claims[0].reason + ' ' + raw.claims[0].consequence);
  assert.deepEqual(report.verdictEvidenceIds, ['S1', 'S2']);
});

test('routine terms and an incomplete optional search do not downgrade supported software', () => {
  const raw = fixtureResearch(url, 'credible', 'How is business use licensed?');
  raw.incomplete = true;
  raw.limitations = ['An optional review page was blocked.'];
  const report = assess(url, raw);
  assert.equal(report.verdict, 'green');
  assert.equal(check(report, 'licensing').impact, 'routine');
  assert.match(report.answer.text, /commercial license/);
});

test('a documented feature behind a paid tier can change the decision', () => {
  const raw = fixture('tier');
  const report = assess(url, raw);
  assert.equal(report.verdict, 'yellow');
  assert.equal(check(report, 'licensing').impact, 'caveat');
  assert.equal(check(report, 'licensing').status, 'supported');
  assert.match(report.interpretation, /paid/);
  assert.deepEqual(report.verdictEvidenceIds, ['S1']);
});

test('a verified secondary benefit is cited even if the core task is unresolved', () => {
  const raw = fixture();
  raw.claims = [];
  raw.testimony = [];
  const quote = 'Orbit Desk includes encrypted backups with the base plan.';
  raw.documents[0].text += ' ' + quote;
  raw.claims.push({criterion:'security', significance:'benefit', status:'supported', impact:'routine',
    claim:quote, reason:'The publisher documents encryption for stored backups.', consequence:'Buyers can include this documented control in their review.',
    evidence:[cite('S1',quote)]});
  const report = assess(url,raw);
  assert.equal(report.verdict,'insufficient');
  assert.equal(check(report,'security').flag,'green');
  assert.equal(check(report,'capability').flag,'context');
  assert.deepEqual(report.verdictEvidenceIds,['S1']);
  assert.ok(report.interpretation.includes(quote));
});

test('one documented customer limitation stays visible without controlling the overall decision', () => {
  const raw = fixture();
  const quote = 'We encountered a delay importing the first ticket into Orbit Desk.';
  raw.documents[2].text = quote;
  raw.claims[1] = {criterion:'experience', significance:'limitation', status:'supported', impact:'caveat',
    claim:quote, reason:quote, consequence:'This was reported on one installation.', evidence:[cite('S3',quote,'review')]};
  const report = assess(url,raw);
  assert.equal(report.verdict,'green');
  assert.equal(check(report,'experience').impact,'routine');
  assert.equal(check(report,'experience').flag,'yellow');
});

test('a documented final finding about the central promise takes precedence', () => {
  const raw = fixture();
  const contradiction = fixture('contradiction');
  raw.documents[0] = contradiction.documents[0];
  raw.documents.push({ ...contradiction.documents[1], id: 'F1' });
  const disputed = contradiction.claims[0];
  disputed.evidence[1].sourceId = 'F1';
  raw.claims.push(disputed);
  const report = assess(url, raw);
  assert.equal(report.verdict, 'red');
  assert.equal(report.checks.filter(c => c.id === 'capability').length, 2);
  assert.deepEqual(report.verdictEvidenceIds, ['S1', 'F1']);
});

test('hypotheticals, a different target, reviews, and vendor copies are insufficient for a regulatory red', () => {
  for (const variant of ['conditional','wrong target','review','vendor']) {
    const raw = fixture('contradiction');
    const doc = raw.documents[1];
    const evidence = raw.claims[0].evidence[1];
    if (variant === 'conditional') doc.text = 'It is false that ' + doc.text;
    if (variant === 'wrong target') doc.text = evidence.quote = 'The regulator ordered Other Desk to stop impersonating Orbit Desk.';
    if (variant === 'review') evidence.relation = 'review';
    if (variant === 'vendor') evidence.vendorAuthored = true;
    assert.equal(assess(url, raw).verdict, 'insufficient', variant);
  }
});

test('an established vendor end-of-life date can disqualify software for an incompatible deployment', () => {
  const raw = fixture();
  const quote = 'Orbit Desk is no longer supported for this deployment.';
  raw.documents[0].text += ' ' + quote;
  raw.claims.push({ criterion: 'maintenance', status: 'supported', impact: 'disqualifying',
    claim: quote, reason: quote, consequence: 'A customer requiring support cannot deploy this edition.', evidence: [cite('S1',quote)] });
  assert.equal(assess(url,raw).verdict, 'red');
});

test('failure stays distinct from usable research that found insufficient evidence', () => {
  assert.equal(assess(url, { documents: [], failed: true }).verdict, null);
  const raw = fixture('timeout');
  assert.equal(assess(url, raw).verdict, 'insufficient');
  assert.match(assess(url, raw).limitations.join(' '), /timed out/);
});

test('a marketing statement alone cannot demonstrate that the product delivers', () => {
  const raw = fixture();
  raw.claims[0].evidence = raw.claims[0].evidence.slice(0, 1);
  const report = assess(url,raw);
  assert.equal(report.verdict, 'insufficient');
  assert.equal(report.checks[0].status, 'unverified');
  assert.match(report.checks[0].explanation, /test/);
});

test('a measured performance claim requires measured evidence', () => {
  const raw = fixture();
  raw.claims[0].claim = 'Orbit Desk has 99% accuracy.';
  assert.equal(assess(url, raw).verdict, 'insufficient');
});

test('a copied vendor passage does not become an independently observed outcome', () => {
  const raw = fixture();
  raw.documents[0].text += ' ' + raw.documents[1].text;
  assert.equal(assess(url, raw).verdict, 'insufficient');
});

test('unmatched, fabricated, or wrong-edition citations discard unsupported analysis', () => {
  for (const variant of ['id','quote','edition']) {
    const raw = fixture();
    const decisive = raw.claims[0];
    decisive.reason = 'A regulator guarantees the product.';
    if (variant === 'id') decisive.evidence.push(cite('S999','Fabricated quote'));
    if (variant === 'quote') decisive.evidence[1].quote = 'Missing from source text.';
    if (variant === 'edition') {
      raw.productName = 'Orbit Desk Premium';
      raw.documents[0].title = 'Orbit Desk Premium';
    }
    const report = assess(url,raw);
    assert.equal(report.verdict,'insufficient',variant);
    assert.ok(!JSON.stringify(report).includes('regulator guarantees'), variant);
  }
});

test('a signed customer account appears with its source and its use in the rubric', () => {
  const report = assess(url, fixture());
  assert.equal(report.testimony.length, 1);
  assert.equal(report.testimony[0].evidence[0].attribution, 'Casey Lee · buyers.example');
  assert.match(report.testimony[0].explanation, /rubric findings/);
  assert.equal(check(report,'experience').status, 'supported');
});

test('vendor selection and unverified bylines are disclosed; one testimonial cannot establish a pattern', () => {
  const raw = fixture();
  raw.documents[2].url = url + 'customers';
  raw.testimony[0].evidence[0].author = 'Unverified Name';
  raw.claims[1].impact = 'caveat';
  const report = assess(url, raw);
  assert.equal(report.verdict, 'green');
  assert.equal(check(report, 'experience').impact, 'routine');
  assert.equal(check(report, 'experience').status,'partly_supported');
  assert.equal(report.testimony[0].evidence[0].sourceType,'Vendor-hosted testimonial');
  assert.ok(!JSON.stringify(report).includes('Unverified Name'));
});

test('sentiment and a review from a sibling edition cannot serve as firsthand evidence', () => {
  for (const mode of ['sentiment','sibling']) {
    const raw = fixture();
    if (mode === 'sentiment') {
      const text = 'Orbit Desk is the best software ever!';
      raw.documents[2].text = raw.claims[1].evidence[0].quote = text;
    } else {
      raw.productName = 'Orbit Desk Premium';
      raw.documents[0].title = 'Orbit Desk Premium';
      raw.documents[2].title = 'Orbit Desk Home';
    }
    const report = assess(url,raw);
    assert.equal(report.testimony.length,0,mode);
    assert.equal(check(report,'experience').status,'unverified',mode);
  }
});

test('authority to identify the operator requires a credible product-specific record', () => {
  const raw = fixture();
  assert.equal(assess(url, raw).vendor,'Orbit Desk Labs Ltd');
  raw.vendor.name = 'A different corporation';
  assert.equal(assess(url, raw).vendor,null);
});

test('question headings and flattened comparison tables are not surfaced as answers', () => {
  const raw = fixture();
  const heading = 'Which plans include Orbit Desk?';
  const table = 'Price table Basic license Team license Pro license ' + 'Yes Yes No '.repeat(33);
  raw.documents[0].text += ' ' + heading + ' ' + table;
  raw.answer = { evidence: [cite('S1', heading), cite('S1', table.trim())] };
  assert.equal(assess(url, raw).answer, null);
});

test('licensing requires a passage about entitlement or purchase terms', () => {
  const raw = fixture('tier');
  raw.claims.at(-1).evidence = raw.claims[0].evidence;
  const report = assess(url,raw);
  assert.equal(check(report,'licensing').status,'unverified');
  assert.equal(report.verdict,'green');
  assert.ok(!report.interpretation.includes('subscription'));
});

test('matching product, a measurement and its value are insufficient when the measured outcome differs', () => {
  const raw = fixture();
  const proposal = raw.claims[0];
  proposal.claim = 'Orbit Desk has 99% accuracy.';
  const doc = raw.documents[1];
  for (const quote of [
    'Our benchmark measured Orbit Desk latency as 15 seconds.',
    'Our benchmark measured Orbit Desk uptime as 99%.',
    'Our benchmark measured Orbit Desk accuracy as 90%.',
  ]) {
    doc.text = quote;
    proposal.evidence = [cite('S2',quote,'partner')];
    assert.equal(assess(url, raw).verdict,'insufficient',quote);
  }
  doc.text = 'Our benchmark measured Orbit Desk accuracy as 99 percent on the evaluated dataset.';
  proposal.evidence = [cite('S2',doc.text,'partner')];
  assert.equal(assess(url, raw).verdict,'green');
});

test('a regulatory warning alone cannot be elevated to a final adverse finding', () => {
  const raw = fixture('contradiction');
  raw.documents[1].text = raw.claims[0].evidence[1].quote = 'The agency warned against Orbit Desk and opened an inquiry.';
  assert.equal(assess(url, raw).verdict,'insufficient');
});

test('a genuine core contradiction decides the verdict even when the proposal labeled it routine', () => {
  const raw = fixture('contradiction');
  const good = fixture();
  raw.documents.push({...good.documents[1],id:'S4'});
  good.claims[0].evidence[1].sourceId = 'S4';
  raw.claims.push(good.claims[0]);
  raw.claims[0].impact = 'routine';
  assert.equal(assess(url,raw).verdict,'red');
});

test('a real passage cannot be used to invent a guarantee in the explanation', () => {
  const raw = fixture();
  raw.claims[0].reason = 'A government regulator guarantees the product meets every requirement.';
  const report = assess(url,raw);
  assert.equal(report.verdict,'insufficient');
  assert.ok(!JSON.stringify(report).includes('government regulator guarantees'));
});

test('a placeholder notice is evidence of a non-product and suppresses fabricated software findings', () => {
  const raw = fixture();
  const notice = 'This domain is for use in documentation examples without needing permission.';
  raw.documents[0].text = 'An illustrative domain\n' + notice;
  raw.claims.push({ criterion: 'security', status: 'supported', impact: 'routine',
    claim: 'Using the service poses no risk.', reason: 'No risk to any user.', consequence: 'Safe for procurement.',
    evidence: [cite('S1',notice)] });
  const report = assess(url,raw);
  assert.equal(report.verdict,'insufficient');
  assert.equal(report.answer.text,notice);
  assert.deepEqual(report.verdictEvidenceIds,['S1']);
  assert.ok(report.checks.every(c => c.status === 'unverified'));
  assert.equal(report.testimony.length,0);
  assert.ok(!JSON.stringify(report).includes('Safe for procurement'));
});

test('only the immediately preceding official edition FAQ can scope its pronoun-led reply', () => {
  const raw = fixture();
  const quote = 'It requires a paid subscription to connect business records.';
  raw.documents.push({ id:'F1', url: url+'plans', origin:'web_search', title:'Licensing FAQ',
    text:['What is included with Orbit Desk? ',quote,'How can I use Other Mail?','It requires a separate license.'].join('\n') });
  const c = { criterion: 'licensing', status:'supported', impact:'caveat', claim:quote, reason:quote,
    consequence:'Check the subscription before connecting business records.', evidence:[cite('F1',quote)] };
  raw.claims.push(c);
  assert.equal(check(assess(url,raw),'licensing').status,'supported');
  c.evidence = [cite('F1','It requires a separate license.')];
  assert.equal(check(assess(url,raw),'licensing').status,'unverified');
});

test('a source-attested prefix abbreviation retains the edition in a multi-product FAQ', () => {
  const raw = fixture();
  raw.productName = 'Orbit 365 Desk Pro';
  raw.documents[0].title = raw.productName;
  raw.documents[0].text = 'Orbit 365 Desk Pro offers support queues. Open Desk Pro for your work account.';
  const quote = 'Desk Pro requires a separate license for business use.';
  raw.documents.push({ id:'F1', url: url+'guide', origin:'web_search', title:'Plan comparison', text:quote });
  raw.productAliases = [{name:'Desk Pro',sourceId:'F1'}];
  raw.answer = {evidence:[cite('F1',quote)]};
  assert.equal(assess(url,raw).answer.text,quote);
  raw.documents[2].title = 'Orbit 365 Desk Home';
  assert.equal(assess(url,raw).testimony.length,0);
});

test('a binding order limiting an advertised capability outweighs minor caveats and preliminary material', () => {
  const raw = fixture('tier');
  const final = 'In April the commission finalized an order requiring Orbit Desk to stop making deceptive claims about the capabilities of its routing engine.';
  const draft = 'The proposed order would prohibit the company from making unsupported claims about its automation.';
  raw.documents.push({id:'R1',url:'https://commission.example/orders/desk',origin:'web_search',title:'Orbit Desk final record',text:final});
  raw.documents.push({id:'R2',url:'https://commission.example/consultations',origin:'web_search',title:'Open consultations',text:draft});
  raw.claims.push({criterion:'credibility',status:'supported',impact:'routine',
    claim:'There is an order.',reason:'A restriction was discussed.',consequence:'Check the regulator record.',
    evidence:[cite('R1',final,'authority'),cite('R2',draft,'authority')]});
  const report = assess(url,raw);
  assert.equal(report.verdict,'red');
  assert.deepEqual(report.verdictEvidenceIds,['R1']);
  assert.match(report.interpretation,/finalized an order/);
  assert.ok(!report.interpretation.includes('proposed'));
  for (const unsupported of ['The commission proposed a final order requiring Orbit Desk to stop making deceptive claims about its routing capabilities.',
    'The commission never finalized an order requiring Orbit Desk to stop making deceptive claims about its capabilities.',
    'The commission finalized an order requiring Other Desk to stop making deceptive claims about its abilities after impersonating Orbit Desk.',
    'The commission finalized an order requiring Orbit Desk to stop making deceptive claims about parking reimbursements.']) {
    raw.documents.at(-2).text = raw.claims.at(-1).evidence[0].quote = unsupported;
    assert.notEqual(assess(url,raw).verdict,'red',unsupported);
  }
});

test('a comparative implementation test can establish only the exercised core task', () => {
  const raw = fixture();
  const purpose = 'Orbit Desk is a queue for processing incoming support tickets.';
  const testRun = 'Our comparison runs routed tickets with Orbit Desk in all 3 tests, alongside the connector.';
  raw.documents[0].text += ' ' + purpose;
  raw.documents.push({id:'B1',origin:'web_search',url:'https://engineering.example/comparison',title:'Comparing queue software',text:testRun});
  raw.claims = [{criterion:'capability',status:'supported',impact:'routine',claim:purpose,
    reason:'The publisher calls this ticket software.',consequence:'Verify the observed use.',evidence:[cite('S1',purpose)]}];
  raw.testimony = [{evidence:[cite('B1',testRun,'other')]}];
  const report = assess(url,raw);
  assert.equal(report.verdict,'green');
  assert.deepEqual(report.verdictEvidenceIds,['S1','B1']);
  assert.match(report.interpretation,/in that setting/);
  assert.equal(report.testimony.length,0);
  for (const inadequate of ['Orbit Desk is extremely popular with customers worldwide.',
    'We tested our calendar benchmarks in production using Orbit Desk.', 'We plan to deploy Orbit Desk to route tickets in production.']) {
    raw.documents.at(-1).text = raw.testimony[0].evidence[0].quote = inadequate;
    assert.equal(assess(url,raw).verdict,'insufficient',inadequate);
  }
});

test('routine security controls are not evidence of maintenance or support continuity', () => {
  const raw = fixture();
  const quote = 'Orbit Desk inherits the organizational security and compliance controls from the parent suite.';
  raw.documents[0].text += ' ' + quote;
  raw.claims.push({criterion:'maintenance',status:'supported',impact:'routine',claim:'Support is continuing.',
    reason:'The product inherits controls.',consequence:'Updates are available.',evidence:[cite('S1',quote)]});
  assert.equal(check(assess(url,raw),'maintenance').status,'unverified');
});

test('a separately scoped official entitlement survives rejection of a companion passage without reusing model prose', () => {
  const raw = fixture('tier');
  const unrelated = 'A subscription to the unrelated suite includes free phone calls.';
  raw.documents.push({id:'F1',origin:'web_search',url:url+'other',title:'Different software plan',text:unrelated});
  const proposal = raw.claims.at(-1);
  proposal.evidence.push(cite('F1',unrelated));
  proposal.reason = 'Calling is included for this product.';
  const report = assess(url,raw);
  assert.equal(report.verdict,'yellow');
  assert.deepEqual(check(report,'licensing').evidenceIds,['S1']);
  assert.ok(!JSON.stringify(report).includes('Calling is included'));
});

test('a material edition contrast is established by two actual first-party passages without a question', () => {
  const raw = fixture();
  const base = 'Orbit Desk is available at no additional cost for accounts with an eligible standard subscription.';
  const upgrade = 'When you add a Warehouse license, Orbit Desk gains the ability to export records into production systems.';
  raw.documents[0].text += '\n' + base;
  raw.documents.push({id:'F1',origin:'web_search',title:'Purchasing FAQ',url:url+'licensing',text:upgrade});
  const report = assess(url,raw);
  assert.equal(report.verdict,'yellow');
  const license = check(report,'licensing');
  assert.deepEqual(license.evidence.map(e => e.quote),[base,upgrade]);
  assert.deepEqual(report.verdictEvidenceIds,['S1','F1']);
  assert.match(report.interpretation,/production systems/);
  for (const unrelated of [
    'Orbit Desk Home requires a paid license to export records into production systems.',
    'When you add a Warehouse license, Orbit Desk Home gains access to production records.',
    'Orbit Desk does not require a separate license to export records into production systems.',
    'Orbit Desk requires a separate license to export cosmetic avatars from profile accounts.',
    'Other Suite requires a paid subscription to export records, Orbit Desk is available to customers.',
    'Orbit Desk might require a separate license to export records.',
    'Would Orbit Desk require a separate license to export records?',
  ]) {
    raw.documents.at(-1).text = unrelated;
    assert.equal(assess(url,raw).verdict,'green',unrelated);
  }
  raw.documents.at(-1).text = upgrade;
  raw.documents[0].text = raw.documents[0].text.replace(base,'Orbit Desk is included with the most expensive enterprise subscription.');
  assert.equal(assess(url, raw).verdict,'green');
});
