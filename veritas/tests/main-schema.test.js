import test from 'node:test';
import assert from 'node:assert/strict';
import { saasLensToFlags, assessVendor } from '../adapters.js';

const url = 'https://acme.example/';
const quote = 'Acme requires a paid plan for commercial use.';
const base = { productName: 'Acme', documents: [{ id: 'S1', url, title: 'Terms', text: quote, origin: 'submitted' }] };
const claim = { criterion: 'licensing', significance: 'limitation', decisionScope: 'ordinary_use',
  claim: 'Acme requires a paid plan for commercial use.', text: quote, status: 'supported', impact: 'caveat',
  reason: 'Plan requirement', consequence: 'Commercial users need a paid plan.',
  evidence: [{ sourceId: 'S1', quote, relation: 'vendor', vendorAuthored: true, author: 'Acme' }] };

test('maps main research claims as sourced proposals using the paraphrase', () => {
  const { flags } = saasLensToFlags(url, { ...base, claims: [{ ...claim, claim: 'A paid plan is required for commercial use.' }] });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].text, 'A paid plan is required for commercial use.');
  assert.equal(flags[0].polarity, 'yellow');
  assert.equal(flags[0].material, true);
  assert.equal(flags[0].evidence[0].content, quote);
});

test('distinguishes disqualifying limitations from caveats', () => {
  const map = impact => saasLensToFlags(url, { ...base, claims: [{ ...claim, impact }] }).flags[0];
  assert.equal(map('caveat').polarity, 'yellow');
  assert.equal(map('disqualifying').polarity, 'red');
  assert.equal(map('routine').polarity, 'yellow');
  assert.equal(map('routine').material, false);
  const context = saasLensToFlags(url, { ...base, claims: [{ ...claim, significance: 'context', impact: 'disqualifying' }] }).flags[0];
  assert.equal(context.material, false);
  assert.equal(context.polarity, 'yellow');
});

test('rejects a combined proposition if any evidence source is unknown', () => {
  const result = saasLensToFlags(url, { ...base, claims: [{ ...claim, evidence: [...claim.evidence, { sourceId: 'S2', quote: 'invented' }] }] });
  assert.equal(result.flags.length, 0);
  assert.match(result.context.limitations[0], /unknown sources/);
});

test('routine, limited, requested and remediated proposals do not become material negatives', () => {
  for (const change of [{ impact: 'routine' }, { decisionScope: 'limited_use' }, { decisionScope: 'requested_use' }, { decisionScope: 'remediated' }]) {
    assert.equal(saasLensToFlags(url, { ...base, claims: [{ ...claim, ...change }] }).flags[0].material, false);
  }
  for (const status of ['unverified']) {
    assert.equal(saasLensToFlags(url, { ...base, claims: [{ ...claim, status }] }).flags.length, 0);
  }
});

test('cited contradictory proposals are retained without trusting the model status', async () => {
  const raw = { ...base, claims: [{ ...claim, status:'contradicted' }] };
  assert.equal(saasLensToFlags(url, raw).flags.length,1);
  const result = await assessVendor(url,raw,{discovery:false});
  assert.notEqual(result.flags[0].verdict.status,'REFUTED');
});

test('upstream supported label is independently re-verified', async () => {
  const fabricated = { ...claim, claim: 'Acme guarantees all users unlimited free service.', significance: 'benefit', impact: 'routine' };
  const result = await assessVendor(url, { ...base, claims: [fabricated] }, { discovery: false });
  assert.equal(result.flags.length, 1);
  assert.notEqual(result.flags[0].verdict.status, 'SUPPORTED');
});
