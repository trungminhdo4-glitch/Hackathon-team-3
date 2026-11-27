import test from 'node:test';
import assert from 'node:assert/strict';
import { needsDisposition, prioritizeRecords } from '../server/procurementSources.js';

test('source selection reserves room for a final order and lifecycle record in a long result list', () => {
  const urls = ['https://research.example/deployment', 'https://news.example/opinion',
    'https://issuer.example/complaint.pdf', 'https://issuer.example/final-order', 'https://docs.example/lifecycle'];
  assert.deepEqual(prioritizeRecords(urls, 'https://app.example', 'independent'), [urls[0],urls[3],urls[4],urls[1],urls[2]]);
});

test('an open proceeding prompts a targeted search until the disposition is located', () => {
  const proposed = {title:'Consultation', text:'The proposed order addresses an advertised product claim.'};
  const decision = {title:'Decision', text:'The commission issued its final order on Friday.'};
  assert.ok(needsDisposition([proposed]));
  assert.equal(needsDisposition([proposed, decision]), false);
  assert.equal(needsDisposition([{title:'Guide',text:'Sort the items in the requested order.'}]), false);
});
