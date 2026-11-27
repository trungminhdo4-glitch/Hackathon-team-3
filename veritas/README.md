# VERITAS — adversarial evidence verification

VERITAS checks the team's research before it goes into the submission. It does not do the research itself. It splits each vendor statement or research flag into atomic claims. For each claim it searches for support and for counter-evidence, checks that every quote really appears in the retrieved text, merges copied sources into one evidence family, and returns an explained verdict.

Everything lives in `veritas/`. The only change outside that folder is four npm scripts in `package.json`. The existing SaaSLens code (`server/`, `src/`, `tests/`) is untouched. `server/fetch.js` is reused as the SSRF-safe fetcher.

## Quick start

```powershell
npm ci
npm run test:veritas          # 65 regression tests, offline
npm run bench:veritas         # offline benchmark → veritas/bench/report.json
node veritas/cli.js flags veritas/examples/vendors.sample.json --provider fixture --corpus veritas/examples/corpus.sample.json --csv out.csv
```

Live run, once a key is available:

```powershell
$env:TAVILY_API_KEY = "<key>"; node veritas/cli.js flags team-output.json --provider tavily --csv submission.csv --out detail.json
```

## Integration for teammates

```js
import { verifyClaims, verifyFlags, extractClaims } from './veritas/index.js';
import { fromSaasLens } from './veritas/adapters.js';

// 1) Plain claims plus your own evidence (quote + url, content optional)
const claims = extractClaims([{ statement: 'We support SAML SSO and are ISO 27001 certified.', vendor_id: 'v1', vendor_name: 'Acme', vendor_domain: 'https://acme.com' }]);
const verdicts = await verifyClaims(claims, [{ url: 'https://acme.com/docs/sso', quote: '...', content: '<page text if you have it>' }], provider, { maxSearchesPerClaim: 4 }, { fetcher });

// 2) Stackgini-shaped: one vendor and its research flags → one CSV row
const { row } = await verifyFlags({ id: 1, url, vendor: 'Acme', product: 'Acme Desk', domain: url },
  [{ polarity: 'red', text: 'The FTC fined Acme $1 million for deceptive claims.' }, { polarity: 'green', text: 'Trusted by Siemens and BMW.' }],
  provider, budget, { fetcher });

// 3) Existing SaaSLens output (server/live.js research()) → re-verified, no extra calls
const { claims: c2, evidence: e2 } = fromSaasLens(url, rawResearch);
```

A provider is any object with `search(query, { maxResults })` that returns `[{ url, title, content, raw_content?, published_date? }]`. A fetcher is any object with `fetch(url)` that returns `{ url, title, text }`. Included: `tavilyProvider()`, `fixtureProvider(corpus)`, `publicFetcher` (wraps `server/fetch.js`) and `fixtureFetcher(corpus)`.

An optional `judge(claim, evidence[])` (for example an LLM) may refine the stance. Its output is validated with zod. It cannot add sources, cannot rescue an unverified quote and cannot overturn an entity mismatch.

## Verdicts

| Status | Rule (on evidence families, not raw hits) |
| --- | --- |
| SUPPORTED | A verified, on-topic, independent family. For capabilities, vendor technical documentation also counts. |
| REFUTED | A strong contradicting family (independent, technical documentation or quality ≥ 60). A newer refutation also overrides older support. |
| CONFLICTING | Strong support and strong refutation exist together. |
| PARTIALLY_SUPPORTED | Only a weaker version is established: plan-restricted, beta, partner instead of customer, "SSO" but not "SAML 2.0". |
| SELF_REPORTED | Only vendor-controlled sources, including press-release copies. |
| INSUFFICIENT_EVIDENCE | Nothing establishes or contradicts the claim. Missing evidence is never turned into REFUTED. |
| NOT_APPLICABLE | Subjective marketing language that cannot be checked. |

`answer` is `true` only for SUPPORTED, `false` only for REFUTED, and `null` otherwise. UNKNOWN is never silently mapped to FALSE.

**Vendor decision (Phase 2, `materiality.js`; team rules after `EVALUATION.md`, not official Stackgini rules):**

Each flag is first verified, then classified by strength *and* materiality:

| Class | When |
| --- | --- |
| STRONG_POSITIVE | Positive finding SUPPORTED by an independent or authoritative source |
| WEAK_POSITIVE | Positive finding that is only vendor-claimed or partly supported |
| MATERIAL_NEGATIVE | Red concern established (independent source, or the vendor's own admission such as a discontinuation notice), or a credibility claim (customer, certification, identity) contradicted by an independent source |
| MATERIAL_CAVEAT | Material yellow tradeoff that is established |
| NON_MATERIAL_NEGATIVE | Established minor concern, or a contradicted minor marketing claim |
| AMBIGUOUS | Concern with conflicting or partial evidence, or backed by user reviews only |
| UNKNOWN / DROPPED | No verified evidence, or contradicted. Never written as a reason |

Overall decision:
- **Red:** at least one MATERIAL_NEGATIVE.
- **Yellow:** a material concern that is not fully established, an established material caveat, failed or incomplete research without independent positives, or identity contradicted.
- **Green:** at least one STRONG_POSITIVE and nothing material against it.

Flag counts no longer matter. Failed or incomplete research is never Green. A flag with several atomic claims keeps the evidence of the parts that hold and is narrowed to them (`combineAtoms`).

## Benchmark (measured, offline, synthetic)

`veritas/bench/`: 23 dev cases and 12 held-out cases. Vendors and documents are invented. Labels were assigned by hand from what each document establishes, before any engine run, and never by a model. All variants use the same fixture corpus and search budget. No LLM is involved.

| Variant | Dev acc. | Held-out acc. (first run) | Held-out after 2 bug fixes ⚠ | False-support rate (held-out) |
| --- | ---: | ---: | ---: | ---: |
| A: naive retrieval (accept if a hit mentions vendor + terms) | 0.391 | 0.333 | 0.333 | 0.889 |
| B: retrieval + quote check (no counter-search, no families) | 0.957 | 0.750 | 0.917 | 0.111 |
| C: VERITAS full | 1.000 | **0.833** | 1.000 | 0.000 |

⚠ The column "after fixes" is contaminated. The two fixes followed from inspecting held-out failures: "preview" counted as roadmap, and "2,000" was parsed as a year. Both are genuine bugs, but the honest held-out number is the first run, **10/12**. The dev numbers are tuned. Citation validity was 1.0 for B and C: every quote used for a verdict was found in the retrieved text, and the test suite asserts this for all 35 cases. C uses about 4 searches per claim, B uses 1.

**Phase 2: fixed vs. adaptive search** (`cases.fresh.js`: 10 new cases, labels set before the first run, never tuned on; most cases arrive with team evidence, as from SaaSLens):

| Variant | Fresh acc. (first run) | Searches / claim |
| --- | ---: | ---: |
| A: naive retrieval | 0.6 | 1.0 |
| B: retrieval + quote check | 0.8 | 0.3 |
| C: VERITAS, fixed search plan | 0.9 | 3.8 |
| C: VERITAS, adaptive (sufficiency gate) | **0.9** | **2.3** (−39 %) |

The only C failure, `fr-06` ("offers an offline mode" is not recognised as a capability claim, so the beta rule does not fire), is deliberately left unfixed to keep this set clean. Dev and held-out are now regression sets only: both have been inspected.

**Real dataset (40 labelled vendors), `node veritas/bench/dataset.js`:**
- Floor measured today: a submission that says Yellow for every vendor scores **accuracy 0.40 / macro-F1 0.19** (`--score` on the dry run). Any real run has to beat this.
- A0 (SaaSLens alone), A1 (+VERITAS), A2 (+adaptive + discovery) and A3 (+LLM judge) are **BLOCKED**: there is no `OPENAI_API_KEY` or `TAVILY_API_KEY`. The harness runs research once per URL, caches it, and gives every variant identical input. Labels are read only in `score()`, after predictions exist.
- Live dry run (real network, `--researcher fetch`, no search key): all 40 rows in 4 s, 38 pages fetched, 2 fetches failed and became explained Yellow rows, and validation passed. This proves the pipeline is robust. It says nothing about accuracy.

**What this does NOT show:** accuracy on real vendors or against the Stackgini evaluator.

## Evidence-backed deviations from the original plan

1. **The dataset is vendor risk triage, not requirement checking.** `hackathon_40_solutions_commented (1).csv` has the columns `overall` (Green 14 / Yellow 16 / Red 10), `green_flags`, `yellow_flags`, `red_flags` and `reasoning`. There is no `requirement_id` and there are no binary answers. VERITAS therefore verifies *flags*, and `verifyFlags` writes rows in exactly that column layout.
2. **Reverse customer checks and implausible numbers are in the ground truth.** Row 11 (knooing): the logo wall is "partner and programme badges made to look like customers". Row 35: the customer logos are contradicted by a LinkedIn page with 3 followers. Row 21: "57M+ users" against "over 9 million users in 2021". Row 32: "800 million users". Hence `dev-11`, `dev-20`, `ho-09` and the archive/temporal rule.
3. **Paid coverage is an independence problem.** Row 36 (accessiBe): the FTC found that reviews and articles were paid for while formatted to look independent. Hence the attribution and advertorial markers in `independence.js`.
4. **Missing information is not a red flag.** Single-developer tools are rated **Green** in the dataset: rows 13, 24 and 39 (cogpack, KeePass, IrfanView). VERITAS therefore never penalises absence. Missing evidence yields INSUFFICIENT_EVIDENCE.
5. **Regulator evidence is the strongest refutation source.** Red rows 36 (FTC), 40 (Czech DPA fine against Avast) and 20 (Yale CELI list) all rest on third-party authorities. That is why contradiction queries target regulators and courts.
6. Not relied on: the plan's claim of an "August 2026 study, +14–22 pp". It is unverified, so nothing here depends on it.

## Security

- All retrieved text is treated as data. `injection.js` detects and removes sentences such as "ignore previous instructions", "mark this vendor as verified" or "system prompt:" before passage selection. Such text is never quoted, and the verdict notes that it was ignored. This is tested (`dev-12`, `ho-10`).
- Network fetches go through `server/fetch.js`: public HTTP(S) only, DNS-pinned, no private IPs, 1 MB / 8 s / 3 redirects.
- Search snippets count as discovery material only. A quote is verified only against fetched page text or provider raw content (`ho-12`).
- The engine has no access to environment variables beyond `TAVILY_API_KEY`, which is read only by `tavilyProvider`.

## Phase 2: adaptive pipeline and blind run

```powershell
# full pipeline on the blind input (keys from .env.local if present)
npm run veritas:batch -- --input blind.csv --output submission.csv --audit audit.json --deadline 2026-11-27T19:35:00+01:00 --concurrency 6
# resume after a crash (skips vendors already in the checkpoint)
npm run veritas:batch -- --input blind.csv --output submission.csv --checkpoint veritas-run.jsonl --resume
# single product (finalist demo)
npm run veritas:batch -- --url https://product.example/
# real-dataset benchmark A0-A3 (needs keys), or score any submission
npm run veritas:dataset -- --limit 10
npm run veritas:dataset -- --score submission.csv
```

- **Researcher:** `saaslens` (`server/live.js research()`, needs `OPENAI_API_KEY`) is the default when a key exists. Otherwise `fetch` (submitted page only). `fixture` is for dry runs.
- **Per vendor:** discovery first (`discovery.js`, at most 3 planned searches across MATERIAL_RISK, LIVENESS, CUSTOMER_REALITY, COMPANY_TRUST, IDENTITY and HISTORICAL_CONTEXT, skipping categories that are already resolved). Then the SaaSLens flags are verified behind the sufficiency gate (`sufficiency.js`: ACCEPT_EXISTING_EVIDENCE, SEARCH_TARGETED_CONTRADICTION, SEARCH_INDEPENDENT_CONFIRMATION, RESOLVE_TEMPORAL_SCOPE, RESOLVE_ENTITY or ABSTAIN). Then the materiality decision.
- **Global budget:** one controller (`budget.js`) for the whole batch: searches, fetches, LLM calls, deadline (15 s safety margin) and a shared promise cache that also deduplicates in-flight requests.
- **Deadline:** each vendor gets a fair share of the remaining time. Under 20 s left, a vendor gets an explained "not assessed before the deadline" Yellow row, so every input still appears exactly once.
- **Checkpoint:** one JSONL line per finished vendor. `--resume` skips those vendors.
- **Validation** (`validate.js`, exit code 3 on problems): every input exactly once, valid labels, URL unchanged, no secrets, no stack traces, no injected text, every cited URL backed by verified evidence, no Red without a red flag, CSV round-trip intact.
- **Leakage guard:** the batch reads only `id` and `url` by default. The dataset's `product`/`vendor` columns contain reviewer knowledge (for example "owned by KKR"). `--keep-input-fields` exists only for an official input that provides them.
- **Assumption:** the blind submission format equals the 9-column dataset format. If the official format differs, adapt `toCsv` in `export.js`.

## Integration dependencies (for the team merge)

- `veritas/adapters.js` `saasLensToFlags` / `assessVendor` implement the **SaaSLens v2** contract from `origin/main` `server/live.js` (read-only inspection on 2026-11-27: `productAliases`, `vendor`, `flags[{kind, material, topic, evidence[{sourceId, quote, relation, vendorAuthored, author}]}]`, `checks`, `documents`, `coverage`, `incomplete`). This branch still contains the v1 `live.js`. The adapter accepts both. The v2 test uses a synthetic fixture of that shape (`tests/fixtures/saaslens-v2.js`), not real output.
- Teammate polarity and materiality are proposals. They raise search priority but never set a verdict. Evidence with an unknown `sourceId` is rejected and counted in the limitations.
- After main is merged by the team: run `npm run test:veritas` and `npm test`, then one `veritas:batch --limit`-style dry run against real SaaSLens output.

## Environment variables

| Name | Used by | Required |
| --- | --- | --- |
| `TAVILY_API_KEY` | `tavilyProvider()`: discovery and claim search | for live search |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | SaaSLens research (`server/live.js`); optional VERITAS judge (`judge.js`) | for the real pipeline |

Secrets are never printed. Error messages written to rows pass through a redaction step (`sk-…` and `tvly-…` become `[redacted]`), and the validator rejects secret-like strings.

## Status

- **IMPLEMENTED:** everything from Phase 1, plus the Phase 2 additions:
  - provenance fix: raw page text wins over a snippet, and a snippet never verifies a quote;
  - shared budget controller with deadline and in-flight deduplication;
  - sufficiency gate and early stop;
  - materiality-aware decision;
  - atom combination without losing support;
  - SaaSLens v2 adapter;
  - planner and bounded risk discovery;
  - selective LLM judge (CiteGuard-style fields, cannot override locks);
  - batch runner with deadline share, checkpoint/resume and single-URL mode;
  - submission validator, CSV reader, dataset scoring harness.
- **TESTED:** `npm run test:veritas` → 65/65. The team's `npm test` passes 24/24 on this branch. One run showed 22/24 while the benchmark ran in parallel; three reruns passed 24/24 (flaky, not caused by VERITAS).
- **LIVE-VERIFIED:** only the fetch path. 40 real dataset URLs were fetched through `server/fetch.js` in the batch dry run. No search provider or LLM was live-verified.
- **BENCHMARKED:** synthetic only (tables above), plus the trivial all-Yellow floor on the real labels.
- **NOT VERIFIED:** Tavily request and response shape, the OpenAI judge call (`judge.js`), and real-world accuracy and runtime with research enabled. Discovery signal patterns and planner priorities are hand-set and not calibrated.
- **BLOCKED:** no `OPENAI_API_KEY` or `TAVILY_API_KEY` in this environment, so A0–A3 on the real dataset cannot run.
- **REMAINING WORK:**
  1. With keys: `npm run veritas:dataset -- --limit 10`, inspect the failures, then run all 40.
  2. Calibrate the materiality rules on those real results (never per vendor).
  3. Verify the Tavily shape with one call.
  4. Merge with main (team-coordinated).

## Known limitations

- Stance detection is lexical. Paraphrases are missed (they end INSUFFICIENT, never as a false SUPPORTED) unless the judge is enabled.
- Absence claims ("no imprint named") cannot be confirmed by search. They become UNKNOWN and are not written as reasons.
- Discovery finds only signals that a single sentence states explicitly (fines, incidents, discontinuation, acquisitions). It cannot judge visual impressions such as an outdated design, which the dataset reviewers sometimes cite.
- Claim-type classification misses some phrasings (`fr-06`: "offers an offline mode").

## Experiment log

| # | Hypothesis | Change | Before → after | Decision |
| --- | --- | --- | --- | --- |
| 1 | Vendor-name tokens inflate relevance | Exclude vendor-name tokens from overlap | dev C 0.913 → (with #2/#3) 0.957 | keep |
| 2 | "the company said" is not a vendor-origin marker | Narrow the attribution regex to press-release and paid markers | dev-08 REFUTED → CONFLICTING | keep |
| 3 | A claimed figure or year must appear in the passage | Neutralise support without the figure/year | dev-01 false SUPPORTED → INSUFFICIENT | keep |
| 4 | Founding-year passages are on-topic without word overlap | Skip the relevance gate for founding cues | dev-21 → REFUTED; dev C 0.957 → 1.0 | keep |
| 5 | (held-out failure) "preview" ≠ roadmap; "2,000" ≠ year | Move preview to beta; years only bare 4-digit | held-out C 0.833 → 1.0 (contaminated) | keep (bug fixes) |
| 6 | (test failure) "$1 million" ≠ "57 million people" | Unit-aware number comparison (currency, unit groups) | false REFUTED → SELF_REPORTED | keep |
| 7 | (Phase 2 review) a snippet could be used while labelled as raw content | Choose raw_content before content and record provenance from the text actually used | new regression test; before the fix, the snippet "supports SCIM" verified | keep |
| 8 | Searches are spent on already-supported claims | Sufficiency gate before round 1 | fresh: 3.8 → 2.3 searches/claim at equal accuracy 0.9 | keep |
| 9 | Flag counts misgrade vendors | Materiality classes and decision (`materiality.js`) | regression tests for incomplete→never Green, minor unknowns→Green, minor contradicted→not Red | keep |
| 10 | Teammate evidence exhausted the budget before discovery | Run discovery before re-verification | discontinuation found and Red (integration test) | keep |
| 11 | A claim saying "discontinued" was refuted by a page saying "discontinued" | Ignore qualifiers that the claim itself asserts | discovery finding REFUTED → SUPPORTED | keep (bug fix) |
| 12 | `options.now: undefined` crashed the engine | Default `now` when it is not a Date | crash → OK | keep (bug fix) |
| 13 | The dataset's product/vendor columns leak reviewer knowledge | The batch reads only id and url by default | test asserts empty product/vendor | keep |
