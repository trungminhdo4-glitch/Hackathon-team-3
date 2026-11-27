import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureDocument, evidencePacket } from '../evidence-packet.js';
import { guard } from '../replay.js';

test('native capture hashes stored retrieved text and retains redirect and truncation provenance', () => {
  const d = captureDocument({ url: 'https://publisher.example/final', text: 'actual source text', document_hash: 'invented' },
    { requestedUrl: 'https://publisher.example/start', maxChars: 13, now: new Date('2026-11-27T17:00:00Z') });
  assert.equal(d.text, 'actual source');
  assert.equal(d.document_hash, createHash('sha256').update(d.text).digest('hex'));
  assert.equal(d.truncated, true);
  assert.equal(d.requestedUrl, 'https://publisher.example/start');
  assert.equal(d.retrieved_at, '2026-11-27T17:00:00.000Z');
});

test('audit-only retains upstream separately and requests material reassessment without certifying it', () => {
  const g = guard('Red', { overall: 'Yellow' }, [], { policy: 'audit-only' });
  assert.equal(g.overall, 'Red');
  assert.equal(g.upstream_overall, 'Red');
  assert.equal(g.proposed_overall, 'Yellow');
  assert.equal(g.independently_verified_overall, null);
  assert.equal(g.requires_reassessment, true);
  const ledger = [{ class: 'STRONG_POSITIVE', evidence: [{ quote_verified: true, entity_match: true, quote: 'A supported passage', url: 'https://example.test/' }] }];
  const stable = guard('Green', { overall: 'Yellow' }, [], { policy: 'audit-only', ledger });
  assert.equal(stable.requires_reassessment, false);
  assert.equal(stable.evidence_assessment.semantic_support, 'not_assessed');
  assert.equal(stable.independently_verified_overall, null);
});

test('evidence boundary strips labels, preserves actual context, and isolates generated quotes', () => {
  const entry = { overall: 'Red', imported: { overall: 'Red' }, productName: 'Example',
    documents: [{ id: 'S1', url: 'https://example.test', text: 'Before. A real product passage. After.' }],
    flags: [{ kind: 'red', text: 'A real product passage.', evidence: [{ sourceId: 'S1', quote: 'A real product passage.' }] },
      { kind: 'green', text: 'Invented finding', evidence: [{ sourceId: 'S1', quote: 'This quote was invented.' }] }] };
  const p = evidencePacket({ id: 1, url: 'https://example.test', reference: 'Yellow' }, entry);
  assert.equal(p.findings[0].passage, 'A real product passage.');
  assert.match(p.findings[0].context, /Before/);
  assert.equal(p.findings[1].passage, null);
  assert.equal(p.findings[1].quote_match, 'unverified_discovery_lead');
  assert.equal(/overall|reference|severity|kind|imported/.test(JSON.stringify(p)), false);
});

test('native packet accepts literal source ellipses but rejects stitched quotations', () => {
  const entry = { productName:'Example', documents:[{id:'S1',url:'https://example.test/',text:'A source interface says in reply to a question... Yes, this affected the free product.'}],
    flags:[{text:'Literal source punctuation',evidence:[{sourceId:'S1',quote:'in reply to a question... Yes, this affected the free product.'}]},
      {text:'Stitched quotation',evidence:[{sourceId:'S1',quote:'A source interface... affected the free product.'}]}] };
  const p=evidencePacket({id:1,url:'https://example.test/'},entry);
  assert.ok(p.findings[0].passage);
  assert.equal(p.findings[1].passage,null);
});
