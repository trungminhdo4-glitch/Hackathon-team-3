// Minimal example: a teammate's research result goes into VERITAS, and a checked row comes out.
//   node veritas/examples/handoff-example.js
// No keys and no network: the page text is included, as a research cache entry would carry it.
import { assessVendor } from '../adapters.js';
import { guard } from '../replay.js';
import { validateSubmission } from '../validate.js';

const url = 'https://acme-desk.example/';
const research = {                       // SaaSLens v2 / research-cache entry shape
  productName: 'Acme Desk',
  documents: [
    { id: 'S1', url, title: 'Acme Desk', text: 'Acme Desk 5.2 was released on 2026-10-14. Acme Desk is operated by Acme Software GmbH, Berlin.' },
    { id: 'S2', url: 'https://regulator.example/decision-17', title: 'Decision 17',
      text: 'Decision 17. The authority fined Acme Software GmbH EUR 1.2 million in 2025 for unlawful processing of customer data in Acme Desk.' },
  ],
  flags: [
    { kind: 'green', material: false, topic: 'maintenance', text: 'Acme Desk 5.2 was released on 2026-10-14.',
      evidence: [{ sourceId: 'S1', quote: 'Acme Desk 5.2 was released on 2026-10-14.', relation: 'vendor', vendorAuthored: true }] },
    { kind: 'red', material: true, topic: 'security', text: 'A regulator fined Acme Software GmbH EUR 1.2 million in 2025 for unlawful processing of customer data.',
      evidence: [{ sourceId: 'S2', quote: 'The authority fined Acme Software GmbH EUR 1.2 million in 2025 for unlawful processing of customer data in Acme Desk.', relation: 'authority', vendorAuthored: false }] },
    { kind: 'green', material: false, topic: 'customer', text: 'Siemens uses Acme Desk.',          // fabricated: no such source
      evidence: [{ sourceId: 'S9', quote: 'Siemens uses Acme Desk worldwide.', relation: 'customer', vendorAuthored: false }] },
  ],
  incomplete: false,
};

const res = await assessVendor(url, research, { provider: null, fetcher: null, discovery: false, now: new Date('2026-11-27') });
const { _ledger, _findings, ...row } = res.row;
console.log('VERITAS row:', row.overall, '\n  red:', row.red_flags, '\n  green:', row.green_flags, '\n  reasoning:', row.reasoning);
console.log('Guard over a teammate "Green":', guard('Green', res.row, _findings));
console.log('Ledger:', _ledger.map(l => `${l.reason_id} ${l.column} ${l.class} ${l.evidence.map(e => e.url).join(',')}`));
console.log('Validation problems:', validateSubmission([{ ...row, id: '1', url }], [{ id: '1', url }], { 1: { citedUrls: _ledger.flatMap(l => l.evidence.map(e => e.url)), ledger: _ledger } }));
