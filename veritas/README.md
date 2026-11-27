# VERITAS — adversarial evidence verification

VERITAS checks the team's research before it goes into the submission. It does not do the research itself. It splits each vendor statement or research flag into atomic claims. For each claim it searches for support and for counter-evidence, checks that every quote really appears in the retrieved text, merges copied sources into one evidence family, and returns an explained verdict.

Everything lives in `veritas/`. The only change outside that folder is two npm scripts in `package.json`. The existing SaaSLens code (`server/`, `src/`, `tests/`) is untouched. `server/fetch.js` is reused as the SSRF-safe fetcher.

## Quick start

```powershell
npm ci
npm run test:veritas          # 36 regression tests, offline
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

**Export mapping (team assumption, not an official Stackgini rule; see `export.js`):**
- A red flag stays red when SUPPORTED or PARTIALLY_SUPPORTED. It becomes yellow when unconfirmed and is dropped when REFUTED.
- A green flag stays green only when SUPPORTED. It becomes yellow when vendor-claimed only and turns red ("vendor claim contradicted") when REFUTED.
- Overall is Red if any red flag remains, Yellow if there are 2 or more yellow flags or an unconfirmed red flag, and Green otherwise.

## Benchmark (measured, offline, synthetic)

`veritas/bench/`: 23 dev cases and 12 held-out cases. Vendors and documents are invented. Labels were assigned by hand from what each document establishes, before any engine run, and never by a model. All variants use the same fixture corpus and search budget. No LLM is involved.

| Variant | Dev acc. | Held-out acc. (first run) | Held-out after 2 bug fixes ⚠ | False-support rate (held-out) |
| --- | ---: | ---: | ---: | ---: |
| A: naive retrieval (accept if a hit mentions vendor + terms) | 0.391 | 0.333 | 0.333 | 0.889 |
| B: retrieval + quote check (no counter-search, no families) | 0.957 | 0.750 | 0.917 | 0.111 |
| C: VERITAS full | 1.000 | **0.833** | 1.000 | 0.000 |

⚠ The column "after fixes" is contaminated. The two fixes followed from inspecting held-out failures: "preview" counted as roadmap, and "2,000" was parsed as a year. Both are genuine bugs, but the honest held-out number is the first run, **10/12**. The dev numbers are tuned. Citation validity was 1.0 for B and C: every quote used for a verdict was found in the retrieved text, and the test suite asserts this for all 35 cases. C uses about 4 searches per claim, B uses 1.

**What this does NOT show:** performance on real vendors or on the Stackgini evaluator. That needs a live run (see BLOCKED).

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

## Environment variables

| Name | Used by | Required |
| --- | --- | --- |
| `TAVILY_API_KEY` | `tavilyProvider()`, CLI `--provider tavily` | only for live search |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | existing SaaSLens research (`server/live.js`); VERITAS does not call OpenAI | for SaaSLens live mode |

## Status

- **IMPLEMENTED:** schemas (zod), atomic extraction, quote validation, numeric/unit and year checks, qualifier detection (roadmap, beta, deprecated, plan, in-progress), entity and lookalike checks, source typing, evidence families (canonical URL, site, SimHash, wire copies), quality score (25/25/25/15/10, provisional), verdict rules with temporal precedence, adversarial query planner (support, contradiction, independent, primary, historical, entity, reverse customer), iterative gap loop with budget, cache, concurrency and timeouts, injection filter, judge hook, Stackgini CSV/JSON export, CLI, SaaSLens adapter.
- **TESTED:** `npm run test:veritas` → 36/36 pass. The existing `npm test` still passes 24/24.
- **BENCHMARKED:** offline synthetic set only (table above).
- **NOT VERIFIED:** the Tavily request/response shape (written from the documented API, never called here). Real-world accuracy. The quality weights are not calibrated. The rule-based extraction will miss complex sentences.
- **BLOCKED:** live runs and LLM baselines. No `TAVILY_API_KEY` or `OPENAI_API_KEY` is set in this environment.
- **REMAINING WORK:** run on the team's real research output for the 40 dataset URLs. Compare the overall rating with the CSV ground truth using `toStackginiRow`. Calibrate the export mapping on those real results instead of the synthetic set. Optionally add an LLM judge for paraphrased support, which the heuristics cannot see.

## Known limitations

- Stance detection is lexical. Paraphrased support with no shared terms is missed and ends as INSUFFICIENT, never as a false SUPPORTED. An LLM judge can be plugged in.
- Absence claims ("no imprint named") cannot be confirmed by search and come out INSUFFICIENT. In the export they become yellow.
- A flag's verdict is its weakest atomic claim. "Trusted by Globex and Telekom" with one confirmed and one partner-only customer comes out PARTIALLY_SUPPORTED. The per-claim detail is kept in `detail.json`.

## Experiment log

| # | Hypothesis | Change | Before → after | Decision |
| --- | --- | --- | --- | --- |
| 1 | Vendor-name tokens inflate relevance | Exclude vendor-name tokens from overlap | dev C 0.913 → (with #2/#3) 0.957 | keep |
| 2 | "the company said" is not a vendor-origin marker | Narrow the attribution regex to press-release and paid markers | dev-08 REFUTED → CONFLICTING | keep |
| 3 | A claimed figure or year must appear in the passage | Neutralise support without the figure/year | dev-01 false SUPPORTED → INSUFFICIENT | keep |
| 4 | Founding-year passages are on-topic without word overlap | Skip the relevance gate for founding cues | dev-21 → REFUTED; dev C 0.957 → 1.0 | keep |
| 5 | (held-out failure) "preview" ≠ roadmap; "2,000" ≠ year | Move preview to beta; years only bare 4-digit | held-out C 0.833 → 1.0 (contaminated) | keep (bug fixes) |
| 6 | (test failure) "$1 million" ≠ "57 million people" | Unit-aware number comparison (currency, unit groups) | false REFUTED → SELF_REPORTED | keep |
