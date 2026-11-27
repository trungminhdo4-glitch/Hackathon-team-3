import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../server/assessment.js';
import { fixtureResearch } from '../server/fixtures.js';

const url = 'https://orbit.example/';
const issuerUrl = 'https://www.edpb.europa.eu/news/national-news/decision-orbit_en';
const name = 'Orbit Lens';
const harm = "The supervisory authority found that Orbit processes biometric data without a legal basis through its recognition service in the Netherlands.";
const fine = 'The Dutch SA has decided to fine Orbit Lens Inc. (hereinafter: Orbit) a total amount of € 12 000 000.';
const date = 'Date of final decision: 2 February 2024';

function investigation(officialText, options = {}) {
  const raw = fixtureResearch(url,'credible');
  raw.productName = options.product || name;
  raw.documents[0].title = raw.productName;
  raw.documents[0].text = raw.productName + ' provides a facial recognition service. Images are processed for comparison.';
  raw.documents = [raw.documents[0],{id:'A1', url:options.url || issuerUrl, origin:'web_search',
    title:options.title || 'National authority decision on Orbit Lens',text:officialText}];
  raw.claims = [{criterion:'capability',status:'unverified',impact:'routine',claim:'The measured matching accuracy is unknown.',evidence:[]}];
  raw.testimony = [];
  delete raw.vendor;
  return raw;
}

test('an adjudicated operating practice overrides a capability gap even when the assessment omitted the record', () => {
  const raw = investigation([date,harm,fine].join('\n'));
  const report = assess(url,raw);
  assert.equal(report.verdict,'red');
  const finding = report.checks.find(c => c.id === 'security' && c.flag === 'red');
  assert.ok(finding);
  assert.equal(report.checks.find(c => c.id === 'capability').status,'unverified');
  for (const quote of [harm,fine]) assert.ok(finding.evidence.some(e => e.quote === quote && e.sourceType === 'Authority publication'));
  assert.deepEqual(report.verdictEvidenceIds,['A1']);
  assert.match(report.interpretation,/Netherlands/);
  assert.match(report.interpretation,/12 000 000/);
  assert.ok(report.interpretation.includes('2 February 2024'));
  assert.doesNotMatch(report.interpretation,/accuracy|worldwide|pay(?:ment)? (?:was )?received/i);
});

test('recognises an imposed penalty or an enforceable restriction and keeps its stated scope', () => {
  const notices = [
    'The data protection authority imposed an administrative fine of 2 million euros on Orbit Lens for unlawfully collecting biometric data from customers in Denmark.',
    'The commission ordered Orbit Lens to stop processing personal data without consent in its recognition service in Denmark.',
  ];
  for (const text of notices) {
    const report = assess(url,investigation(text));
    assert.equal(report.verdict,'red',text);
    assert.ok(report.interpretation.includes(text));
  }
});

test('an enforcement finding needs authenticated provenance, the actual respondent and an affected product practice', () => {
  const other = fine.replace('Orbit Lens Inc.', 'Other Firm');
  const preliminaries = [
    [harm, 'The regulator proposed to fine Orbit Lens Inc. (hereinafter: Orbit).'],
    [harm, 'The regulator did not fine Orbit Lens Inc. (hereinafter: Orbit).'],
    [harm, 'A complainant alleges the regulator fined Orbit Lens Inc. (hereinafter: Orbit).'],
    [harm, 'The regulator fined Orbit Lens Plus for unrelated filing errors.'],
    [harm, other],
    [fine, 'The fine concerns filing its office parking information late.'],
    [fine, 'Orbit unlawfully processed personal data for its own employee payroll and recruitment.'],
    [fine, 'Orbit unlawfully collected employee biometric data for its own office access system.'],
    [fine, 'Orbit illegally collected personal data for an advertising mailing list.'],
    ['The authority fined Orbit Lens for unlawfully tracking visitors with cookies on its marketing website.'],
    ['The authority fined Orbit Lens for reporting that another firm unlawfully collected biometric data.'],
    ['The authority fined Orbit Lens for reporting a supplier’s unlawful processing of the victims’ biometric data.'],
    [fine, 'Orbit was the victim when another firm illegally collected its customers’ biometric data.'],
    [fine, 'Orbit Lens reported that Other Firm unlawfully sold its users’ personal data.'],
    [fine, 'The supervisor denied that Orbit unlawfully processes biometric data.'],
    [fine, 'Orbit processes biometric data lawfully and the commission found no violations.'],
    [fine, 'Unlawful processing of biometric data was identified in a different service.'],
  ];
  for (const lines of preliminaries) assert.notEqual(assess(url,investigation(lines.join('\n'))).verdict,'red',lines.join('\n'));
  for (const address of ['https://analysis.example/decision','https://ftc.gov.unrelated.example/order']) {
    const raw = investigation([harm,fine].join('\n'),{url:address});
    raw.claims.push({criterion:'security',status:'supported',impact:'disqualifying',decisionScope:'ordinary_use',
      claim:harm,reason:fine,consequence:'Deployment depends on the applicable order.',
      evidence:[{sourceId:'A1',quote:fine,relation:'authority'},{sourceId:'A1',quote:harm,relation:'authority'}]});
    assert.notEqual(assess(url,raw).verdict,'red',address);
  }
  const comments = investigation([harm,fine].join('\n'), {title:'Public comment submitted by the complainant'});
  assert.notEqual(assess(url,comments).verdict,'red');
  for (const title of ['Draft decision on Orbit Lens','Enforcement decisions across the market · Annual catalogue']) {
    assert.notEqual(assess(url,investigation([harm,fine].join('\n'),{title})).verdict,'red',title);
  }
});

test('checks the disposition against later proceedings and preserves the dated official finding', () => {
  for (const status of ['The tribunal subsequently overturned this fine.','The fine is stayed pending an appeal.']) {
    const raw = investigation([harm,fine,status].join('\n'));
    const report = assess(url,raw);
    assert.notEqual(report.verdict,'red',status);
    assert.ok(report.checks.some(c => c.evidence.some(e => e.quote === status)),'the update is retained');
  }
  const current = investigation([harm,fine,'The company did not appeal against this fine.'].join('\n'));
  assert.equal(assess(url,current).verdict,'red');
  for (const status of ['The fine remains in force despite the pending appeal.', 'The appeal does not suspend the order.']) {
    const active = investigation([harm,fine,'The decision is under appeal.',status].join('\n'));
    const result = assess(url,active);
    assert.equal(result.verdict,'red',status);
    assert.ok(result.checks.some(c => c.evidence.some(e => e.quote === status)),'the effective status is visible');
  }
  const otherCase = {id:'U1',url:'https://www.ftc.gov/rulings/other-case',origin:'web_search',
    title:'Appeal in a different case',text:'The court reversed the order against Orbit Lens after a hearing.'};
  current.documents.push(otherCase);
  assert.equal(assess(url,current).verdict,'red','separate proceedings with no link to this order');
  otherCase.links = [issuerUrl];
  const updated = assess(url,current);
  assert.notEqual(updated.verdict,'red');
  assert.deepEqual(updated.verdictEvidenceIds,['A1','U1']);
});

test('a separate product from the same supplier requires an explicit link to the affected service', () => {
  const raw = investigation([harm,fine].join('\n'),{product:'Orbit Calendar'});
  const operator = 'Orbit Lens Inc. operates Orbit Calendar from its registered office.';
  raw.documents[0].text += ' ' + operator;
  raw.vendor = { name:'Orbit Lens Inc.', evidence:[{sourceId:'S1',quote:operator,relation:'vendor',vendorAuthored:true}] };
  assert.notEqual(assess(url,raw).verdict,'red');
});
