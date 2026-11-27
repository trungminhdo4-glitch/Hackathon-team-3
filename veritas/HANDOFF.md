# VERITAS handoff for the team merge

## Phase 6 freeze — November 27

An opt-in [Tavily question-recovery path](bench/2026-11-27-tavily.md) is implemented and regression-tested. Keyless live smoke returned HTTP 429; no Tavily accuracy gain or successful content extraction was established. It does not replace the frozen competition researcher. Use `node veritas/focused-research.js --input questions.json --out NEW_DIRECTORY --provider tavily-keyless` for one search and at most one extract per question, or `--provider tavily` with authenticated runtime credentials. It produces evidence/cache artifacts, not final vendor verdicts. Current regression total: 133/133.

The subsequent [six-question controlled test](bench/2026-11-27-phase6-questions.md) improved factual support from 4/6 to 6/6 and complete answers from 0/6 to 3/6; vendor accuracy stayed 4/6 for Terra and fell 4/6 to 3/6 for Luna. No candidate replacement is justified. A source-exact literal-ellipsis rejection was fixed after freezing that experiment; historical packets were not changed. Current tests: 124/124 including the application suite.

Read [the Phase 6 results](bench/2026-11-27-phase6.md) before selecting a configuration. The new clean research prompt did not demonstrate a robust gain; no new judge or stricter Guard is recommended as a replacement. Keep the existing stronger team researcher. Shuhan's historical 27/40 is not a clean rerun, and the original judge's case-derived examples must not enter an evidence-only comparison. The locally reproduced external-worker candidate remains the Phase-5 Luna→Terra workflow at 21/40; its end-to-end autonomous execution is unverified. Unchanged keyless `collect` is the working conservative fallback.

The [official brief](https://aiagentsberlin.xyz/ah3-brief-stackgini-agents-with-taste.pdf) confirms blind release 19:00 CET and submission 19:45 CET. It requires reasons and checkable links, but specifies no CSV column schema. The nine-column local CSV is tested, not an official schema guarantee. Freeze before blind release; do not manually research live products.

From the project root, without loading key files:

```powershell
# Reproduce analysis using the preserved local Phase-5 artifacts.
node veritas/bench/phase6-paired.mjs
node veritas/bench/phase6-score.mjs
node veritas/bench/phase6-live-score.mjs valid
node veritas/bench/phase6-summary.mjs

# Reuse a native captured research cache; no extra network retrieval.
node veritas/replay.js --research-cache research-cache.json --guard-policy audit-only --out evidence-audit.json

# Normalize evidence for an external fresh Luna/Terra judge using phase6-judge-rubric.md.
# This creates packets and a SHA-256 freeze; it does not invoke a model.
node veritas/bench/phase6-packets.mjs inputs.json research-cache.json judge-packets.json

# If only a teammate audit is available, its empty source bodies require refetch.
node veritas/replay.js --agent-audit verdicts.json --refetch --guard-policy audit-only --out evidence-audit.json --cache-out native-cache.json

# Autonomous conservative fallback. Use fresh paths; allow time to inspect validation.
node veritas/batch.js --input blind.csv --researcher collect --provider none --judge none --output submission.csv --audit submission-audit.json --checkpoint submission-run.jsonl --deadline 2026-11-27T19:35:00+01:00 --concurrency 4
```

The fallback command is not a command to reproduce 21/40 or 27/40. External research/worker execution is still required for those candidates. The batch must finish with `validation: OK`, all original inputs exactly once, and each cited decisive reason supported. Resume only the same command/configuration with `--resume`. The audit-only result preserves the **upstream** label for diagnosis and sets `independently_verified_overall` to null; it is not a verified submission or a claim that unsupported decisive facts became true. An unreadable page or invalid quote calls for focused recovery, not an inference that the allegation is false. An unsupported decisive issue needs reassessment; a nondecisive reason can be removed without global recoloring.

Read-only inspected Shuhan command, for the team in its own existing checkout/`agent` directory: `python agent.py --blind --input blind.txt --out verdicts.csv --audit-out verdicts.json`. It was not executed here, its dependencies/credentials were not validated, and its original examples are not a clean evidence-only configuration. No teammate branch was modified. Phase-6 artifacts, including failed over-budget runs, are under `test-results/phase6-20261127/`; evaluator artifacts stay outside `production/`.

VERITAS checks other pipelines' findings. It does not replace research. It re-checks every cited reason against the cited page, drops or narrows what the page does not say, and blocks a verdict that an established or open material issue contradicts. Branch: `feat/adversarial-fact-checking`. All code is in `veritas/`. No new dependencies.

## Recommended use: guard mode over the strongest pipeline

On the 40 dev rows, the Python agent on `shuhan-miao` measured 27/40 (its own `agent/RESULTS.md`). Keyless VERITAS on its own measured 17/40 (`README.md`, Phase 3 table A). VERITAS alone is conservative: Green needs independent evidence. Use it as a **guard**, which keeps the teammate verdict unless VERITAS has a verified reason against it (`replay.js guard()`):

| Situation | Guard result |
| --- | --- |
| VERITAS establishes a material negative | Red |
| Teammate Green, but a material issue is open or established as a caveat | Yellow |
| Teammate Red, but no red reason survives the citation audit | Yellow |
| Otherwise | teammate verdict |

In every case, reasons whose quote is not on the cited page are removed or narrowed. On 7 real teammate outputs, guard mode kept all 7 verdicts and removed 7 unverifiable citations (README, Phase 3 table B).

## Entry points

| Use | Call | Input → output |
| --- | --- | --- |
| JS pipeline (SaaSLens, `server/live.js`) | `assessVendor(url, research, { provider, fetcher, judge, controller, signal })` in `adapters.js` | SaaSLens v2 research → `{ row, flags, tasks }`. `row` has the 9 CSV columns plus `_ledger` and `_findings` |
| Any pipeline, offline | research cache file + `npm run veritas:dataset -- --research-cache file.json --cache-only` | cache → scored report |
| Python agents' audit JSON | `node veritas/replay.js --agent-audit verdicts.json --report report.json --refetch` | teammate output → citation audit, VERITAS verdict and guard verdict |
| Blind batch | `npm run veritas:batch -- --input blind.csv --output submission.csv --audit audit.json --deadline <ISO>` | CSV/JSON with `id,url` → submission CSV, audit JSON (ledger per row) |
| Raw claims | `verifyClaims(claims, evidence, provider, budget, options)` in `index.js` | see the README "Integration for teammates" section |

## Research cache format (what a teammate exports)

```json
{ "_meta": { "format": "veritas-research-cache", "version": 1, "source": "agent.py", "mode": "cached", "created_at": "2026-11-27T17:00:00Z" },
  "entries": {
    "https://product.example/": {
      "productName": "Product",
      "documents": [ { "id": "S1", "url": "https://product.example/changelog", "title": "Changelog", "text": "<full page text as fetched>" } ],
      "flags": [ { "kind": "green|yellow|red", "material": true, "topic": "maintenance|security|customer|identity|licensing|...",
                   "text": "the reason as written", "evidence": [ { "sourceId": "S1", "quote": "verbatim excerpt", "relation": "vendor|news|authority|customer|review|other", "vendorAuthored": true } ] } ],
      "incomplete": false, "limitations": [] } } }
```

- `mode` is one of `live`, `cached`, `fixture`, `fetch-only`, `imported` or `keyless`. Reports always state it.
- **Store the full page `text`.** Without it a quote cannot be checked offline. Importers for the existing agent outputs (`cache.js importAgentAudit` and `importReport`) leave `text` empty for that reason, and then `--refetch` is required.
- Entries with `failed: true`, a missing `documents[]`, or evidence pointing at an unknown `sourceId` are reported and not used. A URL missing from the cache is reported as missing. Nothing is fabricated.
- Never put dataset labels or reviewer reasoning in a cache entry.

Minimal runnable example (no keys, no network): `node veritas/examples/handoff-example.js`. It shows a fabricated customer source being rejected, a regulator fine verified and decisive, the guard overriding a teammate Green, and the ledger and validation output.

## Modes without keys

| Command | What runs |
| --- | --- |
| `--researcher collect --provider none --judge none` | Keyless collector: the submitted page plus at most 5 same-site purpose pages (changelog, legal, security, docs, status), robots.txt honoured, public GitHub repository metadata if the vendor links a repository |
| `--researcher cache --research-cache f.json` | Replay of stored research |
| `--researcher fetch` | Submitted page only (floor) |

## Deadline configuration

- `--deadline <ISO time>`: the global stop, with a 15 s safety margin.
- `--per-vendor-ms` (default 150000): the cap on each vendor's fair share of the remaining time.
- `--concurrency` (default 4).
- When a vendor's share ends, its `AbortController` cancels research, fetch, search and judge calls.
- Under 20 s left, a vendor gets an explained Yellow "not assessed before the deadline" row.
- Resume with `--resume`, which reuses only completed rows of the same configuration.

## Known integration conflicts

- This branch still has the v1 `server/live.js`. `origin/main` has v2. The adapter accepts both, but v2 is only tested with a synthetic fixture (`tests/fixtures/saaslens-v2.js`).
- `server/fetch.js` differs between this branch and `main` (20 lines on main). VERITAS uses only `fetchPublicText(url, { signal })` and its `links` field.
- The Python agents (`agent/`, `stackgini-agent/`) are separate stacks. VERITAS integrates with them through their JSON outputs (importers) or the cache format, not through imports.
- The output column format is assumed to equal the 9-column dataset CSV. If the official blind format differs, adapt `toCsv` in `export.js`.

## Required final checks (after the team merge)

```powershell
npm run test:veritas
```
```powershell
npm test
```
```powershell
npm run veritas:batch -- --input blind.csv --output submission.csv --audit audit.json --deadline <ISO>
```

The batch command must end with `validation: OK` (exit code 0). Exit code 3 means validation problems, listed in the output. Exit code 2 means a requested component is unavailable and nothing ran.
