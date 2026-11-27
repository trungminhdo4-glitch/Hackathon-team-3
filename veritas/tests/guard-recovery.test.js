import test from 'node:test';
import assert from 'node:assert/strict';
import { guard } from '../replay.js';

const row = { overall: 'Yellow', _ledger: [] };
const entry = (className, evidence = []) => ({ reason_id: 'r1', class: className, evidence });
const verified = [{ quote_verified: true, entity_match: true, url: 'https://source.example/page', quote: 'A passage that supports the claim.' }];
const policy = { policy: 'evidence-sufficiency' };

test('verified harms and caveats override even a supported upstream Green', () => {
  for (const [finding, expected] of [['MATERIAL_NEGATIVE', 'Red'], ['MATERIAL_CAVEAT', 'Yellow']]) {
    const result = guard('Green', row, [], { ...policy, ledger: [entry('STRONG_POSITIVE', verified), entry(finding, verified)] });
    assert.equal(result.overall, expected);
    assert.equal(result.evidence_assessment.state, 'corroborated');
  }
});

test('default guard API remains unchanged when no opt-in policy is selected', () => {
  assert.deepEqual(guard('Green', row, []), { overall: 'Green', rule: 'teammate verdict kept' });
});

test('unsupported Green is insufficient evidence with an actionable recovery', () => {
  const result = guard('Green', row, [], { ...policy, ledger: [entry('STRONG_POSITIVE', [{ quote_verified: false, url: 'https://vendor.example' }])] });
  assert.equal(result.overall, 'Yellow');
  assert.equal(result.evidence_assessment.state, 'insufficient_evidence');
  assert.equal(result.evidence_assessment.recovery.action, 'verify_material_support');
  assert.deepEqual(result.evidence_assessment.recovery.reason_ids, ['r1']);
});

test('Green with verified material support is corroborated', () => {
  const result = guard('Green', row, [], { ...policy, ledger: [entry('STRONG_POSITIVE', verified)] });
  assert.equal(result.overall, 'Green');
  assert.equal(result.evidence_assessment.state, 'corroborated');
  assert.equal(result.evidence_assessment.recovery, null);
});

test('verified weak evidence is reported as partial rather than corroborated', () => {
  const result = guard('Green', row, [], { ...policy, ledger: [entry('WEAK_POSITIVE', verified)] });
  assert.equal(result.overall, 'Yellow');
  assert.equal(result.evidence_assessment.state, 'partial');
});

test('unsupported Red is withdrawn while a verified material negative is retained', () => {
  const unsupported = guard('Red', row, [], { ...policy, ledger: [] });
  assert.equal(unsupported.overall, 'Yellow');
  assert.equal(unsupported.evidence_assessment.state, 'insufficient_evidence');
  const confirmed = guard('Red', row, [{ class: 'MATERIAL_NEGATIVE', material: true }], {
    ...policy, ledger: [entry('MATERIAL_NEGATIVE', verified)],
  });
  assert.equal(confirmed.overall, 'Red');
  assert.equal(confirmed.evidence_assessment.state, 'corroborated');
});

test('an explicitly verified material finding can corroborate without a copied ledger', () => {
  const finding = { class: 'MATERIAL_NEGATIVE', evidence: verified };
  const result = guard('Red', row, [finding], { ...policy, ledger: [] });
  assert.equal(result.overall, 'Red');
  assert.equal(result.evidence_assessment.state, 'corroborated');
});

test('URLs and entity mismatches do not count as verified support', () => {
  const result = guard('Green', row, [], { ...policy, ledger: [entry('STRONG_POSITIVE', [
    { quote_verified: true, entity_match: false, url: 'https://source.example' },
  ])] });
  assert.equal(result.evidence_assessment.state, 'insufficient_evidence');
  assert.equal(result.overall, 'Yellow');
});
