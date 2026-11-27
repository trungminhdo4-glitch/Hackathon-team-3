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

test('a location-data order can decide ordinary use even without a performance benchmark', () => {
  const practice = 'The commission ordered Atlas Trails to stop selling sensitive location data without consent in the United States.';
  const raw = investigation(practice,{product:'Atlas Trails',url:'https://www.ftc.gov/orders/atlas-trails',title:'Commission order on Atlas Trails'});
  raw.documents[0].text = 'Atlas Trails provides a location data service for advertisers.';
  const report = assess(url,raw);
  assert.equal(report.verdict,'red');
  assert.deepEqual(report.verdictEvidenceIds,['A1']);
  assert.ok(report.interpretation.includes('United States'));
  assert.equal(report.checks.find(c => c.id === 'capability').status,'unverified');
  raw.documents[1].text = practice.replace('ordered','proposed to order');
  assert.notEqual(assess(url,raw).verdict,'red');
});

test('an issuer can identify the practice, geographic scope and monetary fine in different sentences', () => {
  const cause = 'illegal data collection for facial recognition';
  const title = 'Nordic DPA imposes a fine on Orbit because of ' + cause;
  const summary = 'The Nordic DPA imposes a fine and orders subject to a penalty for non-compliance on Orbit Lens because of ' + cause + '.';
  const amount = 'The Nordic Data Protection Authority (Nordic DPA) imposes a fine of 12.4 million euros and orders subject to a penalty for non-compliance up to 2 million euros on Orbit Lens.';
  const affected = 'Orbit has built an illegal database with millions of photos of faces, including those of Danish residents.';
  const foreign = 'The Southern DPA imposed a fine of 18 million euros on Orbit Lens in a different matter.';
  const unrelatedFine = 'In an earlier case, the Nordic DPA imposed a fine of 22 million euros on Orbit Lens.';
  const raw = investigation([summary, foreign, unrelatedFine, amount, affected].join('\n'),{title});
  raw.documents.push({id:'U1',origin:'web_search',url:'https://ico.org.uk/action/other-decision',title:'Appeal against a UK order',
    text:'The tribunal quashed the United Kingdom order against Orbit Lens.'});
  const report = assess(url,raw);
  assert.equal(report.verdict,'red');
  const quotes = report.checks.find(c => c.id === 'security' && c.impact === 'disqualifying').evidence.map(e => e.quote);
  assert.ok(quotes.includes(amount));
  assert.ok(quotes.includes(affected));
  assert.ok(!quotes.includes(foreign));
  assert.ok(!quotes.includes(unrelatedFine));
  assert.deepEqual(report.verdictEvidenceIds,['A1']);
  assert.match(report.interpretation,/12.4 million/);
  assert.match(report.interpretation,/Danish residents/);
  const unrelated = investigation([summary.replace('Orbit Lens','Other Firm'),amount.replace('Orbit Lens','Other Firm'),affected].join('\n'),{title});
  assert.notEqual(assess(url,unrelated).verdict,'red');
  raw.documents[1].title = 'Nordic DPA sanctions Orbit for a different case';
  assert.ok(!assess(url,raw).checks.some(c => c.evidence.some(e => e.quote === affected)),'a shared prefix alone cannot establish an abbreviation');
});

test('bounded same-site metadata can establish scope but cannot supply a verdict passage', () => {
  const raw = investigation([date,harm,fine].join('\n'));
  const firstParty = raw.documents.shift();
  raw.siteIdentity = {title:name, text:firstParty.text, url};
  const report = assess(url,raw);
  assert.equal(report.verdict,'red');
  assert.deepEqual(report.verdictEvidenceIds,['A1']);
  assert.ok(report.sources.every(source => source.id === 'A1'));
  assert.ok(report.checks.every(check => check.evidence.every(e => e.sourceId === 'A1')));
  assert.equal(report.checks.find(check => check.id === 'capability').status,'unverified');

  raw.siteIdentity = {...raw.siteIdentity, url:'https://elsewhere.example/'};
  assert.notEqual(assess(url,raw).verdict,'red');
  raw.siteIdentity = {title:name, text:[firstParty.text,harm,fine].join('\n'), url};
  raw.documents = [];
  const headOnly = assess(url,raw);
  assert.notEqual(headOnly.verdict,'red');
  assert.deepEqual(headOnly.sources,[]);
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
