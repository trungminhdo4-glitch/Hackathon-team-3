# VERITAS — adversarial evidence verification

Phase 6: [measured evidence-first experiments and frozen selection](bench/2026-11-27-phase6.md). The [controlled six-question follow-up](bench/2026-11-27-phase6-questions.md) improves factual extraction but demonstrates no label-accuracy gain. [Authenticated Tavily CLI research was tested live](bench/2026-11-27-tavily-live.md); replacing prior evidence reduced accuracy, and augmentation showed no gain. An opt-in source-intent restriction is implemented and unit-tested. Keep the strongest existing researcher. Current regression total: 111 VERITAS + 24 application tests.

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

Flag counts no longer matter. Failed research is never Green. Incomplete research blocks Green only when a material question stayed open (`materialGaps`, e.g. the risk search could not run); one unreachable page does not cancel strong independent evidence. A material red concern whose citation cannot be verified blocks Green as an "Open question", written without a citation. A flag with several atomic claims keeps the evidence of the parts that hold and is narrowed to them (`combineAtoms`).

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

## Running it (batch, demo, benchmark)

```powershell
# full pipeline on the blind input (keys from .env.local if present; mode is printed first)
npm run veritas:batch -- --input blind.csv --output submission.csv --audit audit.json --deadline 2026-11-27T19:35:00+01:00 --concurrency 6
# no keys at all: keyless collector, no search, no judge (explicit)
npm run veritas:batch -- --input blind.csv --output submission.csv --researcher collect --provider none --judge none
# resume after a crash (reuses only completed rows of the same configuration and id->url)
npm run veritas:batch -- --input blind.csv --output submission.csv --checkpoint veritas-run.jsonl --resume
# single product (finalist demo)
npm run veritas:batch -- --url https://product.example/
# audit a teammate's research output without keys (re-fetches the cited pages)
node veritas/replay.js --agent-audit verdicts.json --report report.json --refetch --out replay-report.json
# real-dataset benchmark: cached research (no keys), keyless live collection, or score any submission
npm run veritas:dataset -- --research-cache research-cache.json --cache-only
npm run veritas:dataset -- --researcher collect
npm run veritas:dataset -- --score submission.csv
```

- **Configuration** (`config.js`, shared by batch, benchmark and demo): `--researcher auto|saaslens|collect|fetch|fixture|cache`, `--provider auto|tavily|fixture|none`, `--judge auto|openai|none`. `auto` picks what the keys allow and prints the resolved mode. A component that is *requested* but unavailable (for example `--judge openai` without `OPENAI_API_KEY`) stops the run with exit code 2 before any work. Nothing is silently downgraded.
- **Per vendor:** discovery first (`discovery.js`, at most 3 planned searches), then verification of the research flags behind the sufficiency gate, then the materiality decision.
- **Cancellation:** each vendor gets an `AbortController` with its fair time share. The signal reaches `server/live.js research()`, every public fetch, Tavily and the judge (`bindSignal` in `providers.js`). After the share or after the vendor finishes, no new request starts and in-flight requests are cancelled. `Promise.race` remains only as an outer guard.
- **Global budget:** one controller (`budget.js`) for searches, fetches, LLM calls and the deadline (15 s safety margin), with a promise cache that deduplicates in-flight requests.
- **Checkpoint:** every JSONL record carries a configuration fingerprint. `--resume` reuses a record only if the fingerprint matches, its id still maps to the same URL, and its status is `ok`. Deadline, error and aborted rows are re-run. Stale records are counted and reported.
- **Row status** (in the audit file): `ok`, `research_failed`, `deadline`, `aborted`, `error`. Non-`ok` rows are always Yellow, with "Insufficient evidence" in the reasoning.
- **Validation** (`validate.js`, exit code 3): every input exactly once, valid labels, URL unchanged, no secrets, stack traces or injected text, no Red without a red flag, CSV round-trip intact, and the **reason-level audit**. Every URL in a flag column must belong to the ledger entry of that exact reason, with a verified, entity-matched quote. A verified URL moved next to an unrelated reason fails.
- **Evidence ledger** (`row._ledger`, written to `--audit`, never to the CSV): per reason it records reason_id, column, exact text, claim, narrowed statement, class, status, materiality, contribution (decisive or supporting), and per evidence item the id, URL, quote, quote_verified, entity_match, source_type, independent, retrieval, published date and entailment (`judge:*` or `lexical:*`).
- **Leakage guard:** only `id` and `url` are read from the input. Reference labels are read only in `score()`, after predictions exist. Cached and collected research never contains labels.

## Phase 3: real-data results (no API keys)

All numbers below come from runs on 2026-11-27 with this code. **The 40 dataset rows are development data:** they were inspected while fixing the bugs listed in the experiment log (#14–#17), so these are not blind estimates. Sampling margin with n=40 is about ±15 pp.

**A. Keyless pipeline on all 40 labelled URLs** (`npm run veritas:dataset -- --researcher fetch|collect`; files: `bench/dataset-keyless-*.json`)

| Variant | Acc. (40/40 covered) | Macro-F1 | Critical false Green (Red→Green) | False Red | Runtime |
| --- | ---: | ---: | ---: | ---: | ---: |
| All-Yellow floor | 0.400 | 0.190 | 0 | 0 | – |
| Fetch submitted page only | 0.400 | 0.190 | 0 | 0 | 20 s |
| Keyless collector, first version | 0.375 | 0.227 | 0 | **3** | 49 s |
| Keyless collector, self-referential retirement (#16) | **0.425** | **0.255** | 0 | 0 | ~50 s |

The collector finds the one discontinuation that a vendor states on its own site (row 7: "Die Softwareentwicklung wird nach 2026 eingestellt"). It cannot reach Green: a Green needs independent evidence, and without search the material-risk question stays open (`materialGaps`). That is intended. Keyless mode is a fallback, not a competitor to the research pipelines.

**B. Reason-level citation audit of teammates' real outputs** (`node veritas/replay.js --refetch`; file: `bench/replay-report.json`). The inputs are read-only copies of `origin/shuhan-miao:agent/examples/dry_run_verdicts.json` (5 unseen vendors) and `origin/claude/clever-brown-q5y2bs:stackgini-agent/reports/examples/{avast-red,notepad-plus-plus-yellow}.json`. Every cited page was re-fetched (33 pages, 2 failed).

| Tool | Vendors | Reasons | Quote found verbatim | Not found | Source unreachable |
| --- | ---: | ---: | ---: | ---: | ---: |
| agent.py (shuhan-miao) | 5 | 12 | 9 | 2 | 1 |
| stackgini-agent (clever-brown) | 2 | 14 | 9 | 5 | 0 |
| **Total** | 7 | 26 | 18 (**0.72** of checkable) | 7 | 1 |

- The three agent.py problems VERITAS flags automatically are exactly the three that `agent/RESULTS.md` found by manual spot-check: the SQLite YouTube citation, one Bruno excerpt and the LastPass blog post. The automatic audit reproduces the manual one.
- Several stackgini-agent "excerpts" are URL slugs (for example "ftc finalizes order avast banning it selling …") or page headings, not quotes.
- **Bug found by this replay (#14):** VERITAS dropped the unverifiable FTC reason and graded Avast (dataset row 40, label **Red**) **Green**, a critical false Green. Fixes: an unverifiable *material red* concern now blocks Green as an open question (#14), and slug-like excerpts are aligned to the passage of the cited page that contains ≥60 % of their words (#15). Avast is now Red, with the FTC press release as verified evidence. A fabricated excerpt still does not verify (regression test).
- **Standalone vs. guard:** standalone, VERITAS downgrades Notion and SQLite from Green to Yellow, because their positives are first-party only. In **guard mode** (`replay.js guard()`), the teammate verdict stands unless VERITAS has a verified reason against it. Guard mode changed 0 of 7 verdicts and still removed the 7 unverifiable citations. Of the 7 vendors, two have dataset labels (Avast Red, Notepad++ Yellow), and both are correct under guard mode.

**C. Synthetic regression** (`npm run bench:veritas`): fresh set unchanged at 0.9 accuracy and 2.3 searches/claim after all Phase 3 changes. Dev and held-out are at 1.0 (both contaminated, regression only).

**Not run (BLOCKED, no keys):** A0–A3 with live SaaSLens research, Tavily discovery and the LLM judge, and the counterfactual challenger. The challenger is deliberately not implemented: it only acts through search, so its effect cannot be measured without a key, and Phase 3 allows no unmeasured features.

## Integration dependencies (for the team merge)

See [HANDOFF.md](HANDOFF.md) for the entry points, schemas and a minimal example.

- `adapters.js` `saasLensToFlags` / `assessVendor` implement the **SaaSLens v2** contract of `origin/main` `server/live.js` (read-only inspection). The adapter also accepts v1. The v2 test uses a synthetic fixture.
- `cache.js` imports the two Python agents' outputs (`importAgentAudit`, `importReport`). Imported documents have **no page text**, so nothing counts as verified until `replay.js --refetch` re-fetches the cited page.
- Teammate polarity and materiality are proposals. They raise search priority but never set a verdict. Evidence with an unknown `sourceId` is rejected.

## Environment variables

| Name | Used by | Required |
| --- | --- | --- |
| `TAVILY_API_KEY` | `tavilyProvider()`: discovery and claim search | for live search |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | SaaSLens research (`server/live.js`); optional VERITAS judge (`judge.js`) | for the full pipeline |

Secrets are never printed. Row error messages are redacted (`sk-…` and `tvly-…` become `[redacted]`), and the validator rejects secret-like strings.

## Status

- **IMPLEMENTED:** Phase 1 and Phase 2 work, plus Phase 3:
  - abort-signal cancellation through research, fetch, search and judge;
  - shared configuration with explicit failure when a requested component is missing;
  - fingerprinted checkpoints with stale-record detection;
  - reason-level evidence ledger and validator;
  - material-gap rule;
  - unverifiable material red blocks Green;
  - quote alignment;
  - vendor-event and customer-relation filters in discovery;
  - research cache format with validation and teammate importers;
  - replay audit with guard mode;
  - keyless collector (robots-aware, at most 6 pages, optional public GitHub metadata);
  - integrity-checked `score()` with coverage, per-class precision and recall, critical false Green and stratified subsets.
- **TESTED:** `npm run test:veritas` gives 81/81. The team's `npm test` gave 24/24 in 8 of 8 runs, 3 of them under concurrent load. The earlier 22/24 did not reproduce. No team test imports `veritas/` (checked with grep), so VERITAS code is not loaded there. `tests/api.test.js` uses network, ports and timers and is the likely source of the earlier flake (INFERRED, not reproduced).
- **LIVE-VERIFIED:** the public fetch path (40 dataset URLs, 33 teammate-cited pages) and the keyless collector, including robots.txt and the GitHub API path, on 40 real URLs.
- **CACHED-VERIFIED:** replay of 7 real teammate outputs (table B above).
- **BENCHMARKED:** keyless pipeline on all 40 labelled rows (table A); synthetic sets (table C).
- **NOT VERIFIED:** Tavily response shape, the OpenAI judge call, SaaSLens research with abort signals under real load, and accuracy of the full keyed pipeline.
- **BLOCKED:** no `OPENAI_API_KEY` or `TAVILY_API_KEY`, so variants A0–A3 and the challenger cannot run. To run them, a teammate with keys exports research into the cache format (see HANDOFF.md), and `--cache-only` then needs no keys.

## Known limitations

- Stance detection is lexical. Paraphrases end as INSUFFICIENT, never as a false SUPPORTED, unless the judge is enabled.
- Absence claims ("no imprint named") cannot be confirmed by search. They become UNKNOWN and are not written as reasons.
- Discovery and the collector find only signals that one sentence states explicitly. Visual impressions (for example an outdated design) are out of scope.
- The retirement and vendor-event patterns were corrected on dev-set failures (#16, #17). They generalise by rule (self-reference, subject position), not by vendor name, but they have not been measured on unseen vendors.
- Claim-type classification misses some phrasings (`fr-06`: "offers an offline mode").

## Experiment log

| # | Hypothesis | Change | Before → after | Decision |
| --- | --- | --- | --- | --- |
| 1 | Vendor-name tokens inflate relevance | Exclude vendor-name tokens from overlap | dev C 0.913 → (with #2/#3) 0.957 | keep |
| 2 | "the company said" is not a vendor-origin marker | Narrow the attribution regex to press-release and paid markers | dev-08 REFUTED → CONFLICTING | keep |
| 3 | A claimed figure or year must appear in the passage | Neutralise support without the figure/year | dev-01 false SUPPORTED → INSUFFICIENT | keep |
| 4 | Founding-year passages are on-topic without word overlap | Skip the relevance gate for founding cues | dev-21 → REFUTED; dev C 0.957 → 1.0 | keep |
| 5 | (held-out failure) "preview" ≠ roadmap; "2,000" ≠ year | Move preview to beta; years only bare 4-digit | held-out C 0.833 → 1.0 (contaminated) | keep (bug fixes) |
| 6 | (test failure) "$1 million" ≠ "57 million people" | Unit-aware number comparison | false REFUTED → SELF_REPORTED | keep |
| 7 | A snippet could be used while labelled as raw content | Provenance from the text actually used | regression test | keep |
| 8 | Searches are spent on already-supported claims | Sufficiency gate before round 1 | fresh: 3.8 → 2.3 searches/claim at equal accuracy 0.9 | keep |
| 9 | Flag counts misgrade vendors | Materiality classes and decision | regression tests | keep |
| 10 | Teammate evidence exhausted the budget before discovery | Discovery before re-verification | discontinuation found and Red | keep |
| 11 | A claim saying "discontinued" was refuted by a page saying "discontinued" | Ignore qualifiers the claim asserts | REFUTED → SUPPORTED | keep (bug fix) |
| 12 | `options.now: undefined` crashed the engine | Default `now` | crash → OK | keep (bug fix) |
| 13 | Dataset product/vendor columns leak reviewer knowledge | Batch reads only id and url | test | keep |
| 14 | (replay) An unverifiable FTC reason vanished: Avast, labelled Red, became Green | Unverifiable material red concern blocks Green as an open question | Avast Green → Yellow | keep |
| 15 | (replay) Teammate excerpts are URL slugs or paraphrases of the cited page | Align to the page passage containing ≥60 % of the excerpt's words; fabricated excerpts stay unverified | Avast Yellow → Red (FTC verified); fabricated fixture still INSUFFICIENT | keep |
| 16 | (keyless run) Bare retirement keywords cause false Reds: sibling product (Qlik), German "eingestellt" = configured (Schneespur), third party (Microsoft on opsi) | Retirement must be self-referential (our/this product, German Software/Entwicklung … wird eingestellt, or the URL's product token) | keyless 0.375 / 3 false Red → 0.425 / 0 false Red (dev, contaminated) | keep |
| 17 | (review) "helps prevent data breaches" was a breach signal | Vendor-event filter: subject position, no preventive or hypothetical framing, not "unlike X" | regression tests | keep |
| 18 | Incomplete research made strong evidence useless or, per the code, still allowed Green | `materialGaps`: only an open material question blocks Green | regression tests | keep |
