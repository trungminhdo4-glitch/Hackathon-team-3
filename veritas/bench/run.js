// Reproducible offline benchmark: same cases, same fixture corpus, same search
// budget for all variants. Writes veritas/bench/report.json.
//   node veritas/bench/run.js [--set dev|heldout|all] [--json]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyClaims, createStats } from '../engine.js';
import { extractClaims } from '../extract.js';
import { fixtureProvider, fixtureFetcher } from '../providers.js';
import { cases as dev } from './cases.dev.js';
import { cases as heldout } from './cases.heldout.js';
import { cases as fresh } from './cases.fresh.js';
import { tokens } from '../text.js';

const BUDGET = { maxSearchesPerClaim: 3, maxRounds: 2, maxTotalSearches: 500, timeoutMs: 3000 };

function setup(c) {
  const claims = extractClaims([{ id: c.id, statement: c.statement, ...c.vendor }], { keepSubjective: true });
  const provider = c.network_failure ? { name: 'down', search: async () => { throw new Error('ENETUNREACH'); } } : fixtureProvider(c.corpus);
  const fetcher = fixtureFetcher(c.corpus, { unreachable: c.network_failure ? c.corpus.map(d => d.url) : [] });
  const judge = c.malformed_judge ? async () => [{ evidence_id: 42, stance: 'definitely' }, 'not json', null] : undefined;
  return { claim: claims[0], provider, fetcher, judge };
}

// Variant A: naive retrieval baseline — accepts the claim if any retrieved text
// (team evidence or support-search result) mentions the vendor and shares
// claim terms. No quote validation, no counter-search, no independence check.
async function variantA(c) {
  const { claim, provider } = setup(c);
  let searches = 0, results = [];
  try { searches++; results = await provider.search(`"${claim.vendor_name}" ${claim.text}`, { maxResults: 5 }); } catch { /* none */ }
  const texts = [...(c.team_evidence ?? []).map(e => e.quote), ...results.map(r => r.content)];
  const ct = tokens(claim.text);
  const hit = texts.some(t => t.toLowerCase().includes(claim.vendor_name.toLowerCase()) &&
    ct.filter(x => t.toLowerCase().includes(x)).length / Math.max(1, ct.length) >= 0.5);
  const cited = (c.team_evidence ?? []).length + results.length;
  return { status: hit ? 'SUPPORTED' : 'INSUFFICIENT_EVIDENCE', searches, citations: cited, verifiedCitations: null };
}

async function variantEngine(c, flags) {
  const { claim, provider, fetcher, judge } = setup(c);
  const stats = createStats();
  const [v] = await verifyClaims([claim], c.team_evidence ?? [], provider, BUDGET, { fetcher, judge, stats, now: new Date('2026-11-27'), ...flags });
  const used = v.evidence.filter(e => e.used_for_verdict);
  return { status: v.status, searches: v.trace.searches, citations: used.length, verifiedCitations: used.filter(e => e.quote_verified).length,
    injectedQuoteLeak: used.some(e => /ignore previous|system prompt|mark this vendor/i.test(e.quote)), verdict: v };
}

const VARIANTS = {
  A_naive_retrieval: variantA,
  B_retrieval_plus_citation_check: c => variantEngine(c, { adversarial: false, iterative: false, independence: false }),
  C_veritas_fixed_search: c => variantEngine(c, { adaptive: false }),
  C_veritas_full: c => variantEngine(c, {}),
};

function metrics(rows) {
  const n = rows.length;
  const correct = rows.filter(r => r.pred === r.expected).length;
  const predSup = rows.filter(r => r.pred === 'SUPPORTED');
  const trueSup = rows.filter(r => r.expected === 'SUPPORTED');
  const tp = predSup.filter(r => r.expected === 'SUPPORTED').length;
  const cit = rows.reduce((a, r) => a + (r.citations ?? 0), 0);
  const ver = rows.every(r => r.verifiedCitations === null) ? null : rows.reduce((a, r) => a + (r.verifiedCitations ?? 0), 0);
  const refExp = rows.filter(r => ['REFUTED', 'CONFLICTING'].includes(r.expected));
  return {
    n, accuracy: +(correct / n).toFixed(3),
    supported_precision: predSup.length ? +(tp / predSup.length).toFixed(3) : null,
    supported_recall: trueSup.length ? +(tp / trueSup.length).toFixed(3) : null,
    false_support_rate: +(rows.filter(r => r.pred === 'SUPPORTED' && r.expected !== 'SUPPORTED').length / Math.max(1, rows.filter(r => r.expected !== 'SUPPORTED').length)).toFixed(3),
    false_refute_rate: +(rows.filter(r => r.pred === 'REFUTED' && r.expected !== 'REFUTED').length / Math.max(1, rows.filter(r => r.expected !== 'REFUTED').length)).toFixed(3),
    contradiction_detection: refExp.length ? +(refExp.filter(r => ['REFUTED', 'CONFLICTING'].includes(r.pred)).length / refExp.length).toFixed(3) : null,
    missing_as_refuted: rows.filter(r => r.expected === 'INSUFFICIENT_EVIDENCE' && r.pred === 'REFUTED').length,
    abstention_rate: +(rows.filter(r => r.pred === 'INSUFFICIENT_EVIDENCE').length / n).toFixed(3),
    citation_validity: ver === null ? 'not measured (variant does not validate)' : (cit ? +(ver / cit).toFixed(3) : 1),
    injection_quote_leaks: rows.filter(r => r.injectedQuoteLeak).length,
    searches_per_claim: +(rows.reduce((a, r) => a + r.searches, 0) / n).toFixed(2),
  };
}

export async function runBenchmark(set = 'all') {
  const sets = { dev, heldout, fresh };
  const chosen = set === 'all' ? ['dev', 'heldout', 'fresh'] : [set];
  const report = { generated_at: new Date().toISOString(), budget: BUDGET, note: 'Synthetic fixtures; offline; no LLM. Labels hand-assigned before runs.', sets: {} };
  for (const name of chosen) {
    report.sets[name] = {};
    for (const [vname, fn] of Object.entries(VARIANTS)) {
      const t0 = Date.now();
      const rows = [];
      for (const c of sets[name]) {
        const r = await fn(c);
        rows.push({ id: c.id, category: c.category, expected: c.expected, pred: r.status, searches: r.searches,
          citations: r.citations, verifiedCitations: r.verifiedCitations, injectedQuoteLeak: !!r.injectedQuoteLeak });
      }
      report.sets[name][vname] = { metrics: { ...metrics(rows), runtime_ms: Date.now() - t0 }, failures: rows.filter(r => r.pred !== r.expected) };
    }
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const set = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : 'all';
  const report = await runBenchmark(set);
  writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(report, null, 2));
  for (const [s, variants] of Object.entries(report.sets)) {
    console.log(`\n== ${s} ==`);
    console.table(Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, (({ n, accuracy, false_support_rate, false_refute_rate, contradiction_detection, citation_validity, searches_per_claim }) =>
      ({ n, accuracy, false_support_rate, false_refute_rate, contradiction_detection, citation_validity, searches_per_claim }))(v.metrics)])));
    for (const [k, v] of Object.entries(variants)) for (const f of v.failures) console.log(`  ${k} ✗ ${f.id} ${f.category}: expected ${f.expected}, got ${f.pred}`);
  }
}
