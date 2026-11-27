import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../csv.js';

const base = 'test-results/phase5-20261127';
const out = 'test-results/phase6-20261127';
const read = p => JSON.parse(readFileSync(`${base}/${p}`, 'utf8'));
const colors = ['Green', 'Yellow', 'Red'];
const comparisons = {
  'luna-to-terra': ['workers/overall', 'editor/overall'],
  'luna-to-existing-guard': ['workers/overall', 'workers/default'],
  'luna-to-strict-guard': ['workers/overall', 'workers/evidence-sufficiency'],
  'terra-to-existing-guard': ['editor/overall', 'editor/default'],
  'terra-to-strict-guard': ['editor/overall', 'editor/evidence-sufficiency'],
  'luna-existing-to-strict': ['workers/default', 'workers/evidence-sufficiency'],
  'terra-existing-to-strict': ['editor/default', 'editor/evidence-sufficiency'],
  'keyless-to-recover': ['collection/collect', 'collection/recover'],
};
const review = new Map(read('grounding-review.json').map(x => [x.key, x]));
const historical = read('metrics.json');
const results = {};
for (const split of ['dev', 'panel']) {
  const rows = parseCsv(readFileSync(`${base}/${split}-all-results.csv`, 'utf8'));
  const graded = rows.filter(r => colors.includes(r.reference));
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error(`Duplicate IDs in ${split}`);
  const arms = Object.keys(rows[0]).filter(k => !['id', 'url', 'reference'].includes(k));
  const metrics = {};
  for (const arm of arms) {
    const matrix = Object.fromEntries(colors.map(c => [c, Object.fromEntries(colors.map(d => [d, 0]))]));
    for (const row of graded) {
      if (!colors.includes(row[arm])) throw Error(`Invalid prediction ${split}/${row.id}/${arm}`);
      matrix[row.reference][row[arm]]++;
    }
    const correct = colors.reduce((n,c) => n + matrix[c][c], 0);
    const recall = Object.fromEntries(colors.map(c => {
      const n = colors.reduce((sum,d) => sum + matrix[c][d], 0);
      return [c, {correct: matrix[c][c], n, rate: n ? matrix[c][c] / n : null}];
    }));
    const falseGreen = matrix.Yellow.Green + matrix.Red.Green;
    const falseRed = matrix.Green.Red + matrix.Yellow.Red;
    metrics[arm] = {correct, n: graded.length, full: rows.length, recall, criticalRedToGreen: matrix.Red.Green, falseGreen, falseRed, matrix};
    if (correct !== historical[split][arm].correct || JSON.stringify(matrix) !== JSON.stringify(historical[split][arm].matrix)) throw Error(`Historical mismatch ${split}/${arm}`);
  }
  const pairs = {};
  for (const [name, [a, b]] of Object.entries(comparisons)) {
    const changes = graded.filter(r => r[a] !== r[b]).map(r => ({id:r.id, reference:r.reference, from:r[a], to:r[b], outcome:r[a] !== r.reference && r[b] === r.reference ? 'wrong-to-right' : r[a] === r.reference && r[b] !== r.reference ? 'right-to-wrong' : 'wrong-to-wrong'}));
    const wr = changes.filter(x => x.outcome === 'wrong-to-right').length;
    const rw = changes.filter(x => x.outcome === 'right-to-wrong').length;
    pairs[name] = {from:a, to:b, n:graded.length, wrongToRight:wr, rightToWrong:rw, net:wr-rw, wrongToWrong:changes.length-wr-rw, changes};
  }
  const guard = {};
  for (const worker of ['workers', 'editor']) for (const mode of ['default', 'evidence-sufficiency']) {
    const vendors = read(`${split}-${worker}/${mode}.json`).vendors;
    const changed = vendors.filter(v => v.teammate_overall !== v.guard_overall);
    const tally = (items, key) => items.reduce((a,x) => (a[x[key] ?? 'missing'] = (a[x[key] ?? 'missing'] || 0) + 1, a), {});
    guard[`${worker}/${mode}`] = {changedCases:changed.length, transitions:tally(changed.map(v => ({transition:`${v.teammate_overall}->${v.guard_overall}`})), 'transition'), guardRules:tally(changed,'guard_rule'), reasonStatusesInChangedCases:tally(changed.flatMap(v => v.reasons), 'status'), reasonSeveritiesInChangedCases:tally(changed.flatMap(v => v.reasons), 'severity')};
  }
  const supported = rows.filter(r => review.get(`${split}-${r.id}`)?.supported);
  if (rows.some(r => !review.has(`${split}-${r.id}`))) throw Error(`Missing grounding review ${split}`);
  const grounded = {supported:supported.length, full:rows.length, supportedAndCorrect:supported.filter(r => colors.includes(r.reference) && r.reference === r['editor/overall']).length, graded:graded.length};
  const collection = Object.fromEntries(['collect','recover'].map(m => { const a=read(`${split}-collection/${m}-audit.json`); return [m, {counts:a.counts, statuses:a.statuses}]; }));
  results[split] = {metrics, pairs, guard, grounded, collection};
}
mkdirSync(out, {recursive:true});
writeFileSync(`${out}/paired-analysis.json`, JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));

// Reconstruct the deterministic stages for changed Terra Red cases from cached
// page text. The optional judge and network are deliberately disabled.
const { saasLensToFlags, assessVendor } = await import('../adapters.js');
const { extractClaims } = await import('../extract.js');
const { verifyQuote } = await import('../citation.js');
const { sanitize } = await import('../injection.js');
const { entityMatch, heuristicStance, criticalTerms } = await import('../stance.js');
const { assignFamilies } = await import('../independence.js');
const { qualityScore } = await import('../quality.js');
const now = new Date('2026-11-27T00:00:00Z');
const cache = read('dev-editor/cache.json').entries;
const changed = read('dev-editor/default.json').vendors.filter(v => v.teammate_overall === 'Red' && v.guard_overall === 'Yellow');
const diagnostics = [];
for (const item of changed) {
  const raw = cache[item.url];
  if (!raw) throw Error(`Missing cached entry ${item.url}`);
  const {vendor, flags} = saasLensToFlags(item.url, raw);
  const assessed = await assessVendor(item.url, raw, {provider:null, discovery:false, now});
  for (const [i, flag] of flags.entries()) {
    if (flag.polarity !== 'red') continue;
    const claims = extractClaims([{id:`${vendor.id}-f${i+1}`, statement:flag.text, vendor_id:String(vendor.id), vendor_name:vendor.name, vendor_domain:vendor.domain, atomic:flag.atomic === true}], {keepSubjective:false});
    for (const claim of claims) {
      if (flag.material) claim.qualifiers.materiality = 'high';
      if (flag.claim_type) claim.claim_type = flag.claim_type;
      if (flag.qualifiers) Object.assign(claim.qualifiers, flag.qualifiers);
      if (vendor.aliases?.length) claim.qualifiers.aliases = [...(claim.qualifiers.aliases ?? []), ...vendor.aliases];
      const pool = flag.evidence.map(e => {
        const check = verifyQuote(e.quote, sanitize(e.content).text);
        return {...e, quote_verified:check.verified, quote_check:check.method ?? check.reason, quote_context:check.context ?? ''};
      });
      assignFamilies(pool, [claim.vendor_domain, ...(claim.qualifiers.vendor_domains ?? [])].filter(Boolean));
      const evidence = pool.map(e => {
        const entity = entityMatch(claim,e);
        const heuristic = heuristicStance(claim,e,{now});
        const quality = qualityScore(e,{relevance:heuristic.relevance,specificity:heuristic.specificity,now});
        return {url:e.url, quote:e.quote, quoteVerified:e.quote_verified, quoteCheck:e.quote_check, entity, criticalTerms:criticalTerms(claim), heuristic, quality, finalDeterministicStance:quality.parts.relevance < 25 && heuristic.stance !== 'refutes' ? 'neutral' : heuristic.stance};
      });
      const actual = assessed.flags[i].claims.find(c => c.claim_id === claim.id);
      diagnostics.push({vendor:item.url, claim:claim.text, claimType:claim.claim_type, evidence, engine:{status:actual.status, candidates:actual.trace.candidates, evidenceCount:actual.evidence.length, explanation:actual.explanation}, guard:item.guard_rule});
    }
  }
}
if (diagnostics.length !== 3 || diagnostics.some(d => d.engine.candidates !== 1 || d.engine.evidenceCount !== 0)) throw Error('Unexpected diagnostic scope or replay result');
writeFileSync(`${out}/paired-guard-diagnostics.json`, JSON.stringify(diagnostics,null,2)+'\n');
