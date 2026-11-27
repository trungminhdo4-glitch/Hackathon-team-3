# Final VERITAS integration review

## FACT

Source branch: `feat/adversarial-fact-checking`; target: `main`. Reviewed against remote main `a2fdfd016c69f13b175e4ef59b2e9b250790ec3b`. No merge, rebase, force push, teammate-branch edit or owner-hook bypass was performed. Normal `git push origin feat/adversarial-fact-checking` succeeded. The repository is private. The connected GitHub app could not access it, so authenticated GitHub CLI is used for PR operations.

The branch contains the engine, public adapters/CLI, adaptive discovery, materiality rules, cancellation/budgets, batch/checkpoints/validation, collector/recovery/cache replay, provenance fixes, native evidence packets, opt-in audit-only Guard and focused Tavily research. Phase 7 contributes four experiment reports, not a completed OpenCode runtime integration. No Phase-8 implementation was identified; none is claimed. Optional benchmark/session helpers are not imported into production execution.

## IMPLEMENTED / final compatibility fixes

- Latest main emits `raw.claims[]` with criteria, significance, decision scope, impact and resolved `sourceId`/quote evidence. `saasLensToFlags` now maps that schema as proposals for independent verification while preserving legacy checks and flags.
- Unknown/missing source bindings cannot support a compound proposal. Unverified proposals are skipped; cited contradictory proposals are retained so real counter-evidence is not silently lost. Upstream status does not dictate the verifier's answer.
- Caveats propose Yellow; disqualifying limitations propose Red. Routine, requested-use, limited-use, remediated and context-only claims do not create material negatives merely from their metadata. Context facts do not become Green endorsements.
- The legacy adapter regression is pinned to a synthetic v1 fixture rather than importing main's evolving server fixture. Current main-schema compatibility has separate tests.
- Credential option parsing remains compatible, test credentials are explicitly fake, and nonsecret product-term and detector names no longer look like stored secrets to the deterministic scanner.
- Eighty-three raw `test-results` files were untracked from the final PR tree with `git rm --cached`. Files remain locally available and earlier commits remain intact. Compact results/reports and offline synthetic fixtures are retained. No source/runtime depends on the omitted caches; optional historical analyses need their local inputs or the earlier recorded commits.

## TESTED

| Check | Actual result |
| --- | --- |
| `npm run test:veritas` | 117/117 |
| `npm test` on the feature checkout | 24/24 |
| Full prospective integration with latest main | **222/222** |
| Current-schema mapping, materiality, unknown references and contradictory proposals | Six focused regression tests included above |
| Synthetic batch CLI | 1/1, Red, `validation: OK`, zero searches |
| Past-deadline batch CLI | 1/1, explained Yellow, `validation: OK`, zero searches |
| Handoff example / reason-level validator | No validation problems |
| Offline synthetic benchmark | 23/23 dev, 12/12 previously inspected heldout regression, 9/10 additional synthetic regression |

The main integration snapshot was built from `git merge-tree --write-tree`, exported into an isolated ignored directory and linked to existing dependencies. Final source and fixture fixes were applied to that snapshot and all 222 tests passed; neither actual branch was merged. An initial run reported five failures; a subsequent diagnostic run retained one deterministic legacy-fixture mismatch. After fixing the fixture dependency, the full combined suite passed, and after contradictory-claim preservation it passed again at 222/222. Do not report the initial failures as nonexistent.

The 12-case synthetic set's original independent first-run score remains 10/12; the current 12/12 is a contaminated regression result. The additional 10 synthetic cases remain 9/10 with 2.3 searches/claim adaptive versus 3.8 fixed. Synthetic outcomes are not real-vendor accuracy.

The deterministic security scan has zero high findings and no environment filenames. Four runtime environment bindings and public-network/session-subprocess references are explicitly triaged in `bench/final-pr-security.json`; the raw structural scan is not advertised as having zero findings. No credential values, OAuth tokens or key files are included.

## Latest measured and reported outcomes

| Cohort / configuration | Correct | Qualification |
| --- | ---: | --- |
| Keyless collector | 17/40 | Known development data; conservative fallback |
| Phase-5 Luna → Terra | 21/40 | Known development data; grounded correct 6/40 |
| Same Terra + existing Guard | 18/40 | Regression; do not enable global recoloring |
| Former prospective panel | 5/9 evaluated; 5/12 full cohort | Now development data, three unresolved references, no adjudicated Red; grounded correct 2/9 |
| Authenticated Tavily-only, six cases | Luna 1/6; Terra 2/6 | Known selected development cases |
| Previous evidence + Tavily, six cases | Luna 3/6; Terra 4/6 | Baseline 4/6 each; no gain |
| Phase-7 saved Tavily predictions, 86 searches | 23/40; macro F1 .572 | Predictions rescored; two critical false Greens; original research not reproduced |
| Phase-7 saved Tavily predictions, 135 searches | 23/40; macro F1 .561 | Predictions rescored; three critical false Greens; original research not reproduced |
| Shuhan historical report | 27/40 | Not reproduced; case-derived examples in original configuration |

The two Phase-7 prediction arrays were rescored against the known development CSV and match their published correct counts/F1. Their reported grounding and source collection cannot be independently reproduced here because source packets and execution scripts were not found. `bench/final-phase7-rescore.json` records this distinction. No comparison establishes that VERITAS outperforms Shuhan. There is no new out-of-sample estimate and no official blind input was used for development.

## Integration recommendation and commands

Keep the team's strongest operational researcher. Use VERITAS to audit source text, narrow unsupported reasons, recover decisive passages and trigger **selective reassessment**. Do not deploy the stricter Guard globally. An unreadable page or invalid quote does not establish that the allegation is false. `audit-only` preserves the upstream verdict separately and leaves independent overall certification null. The six-case evidence-first and Tavily results do not justify replacing a stronger researcher.

Latest SaaSLens raw output:

```js
import { assessVendor } from './veritas/adapters.js';
const result = await assessVendor(url, rawResearch, {
  discovery: false, provider: null,
});
// Review result.row._ledger and result.flags. This is a separate verification
// result, not automatic permission to overwrite the original team verdict.
```

Captured cache / teammate audit:

```powershell
node veritas/replay.js --research-cache research-cache.json --guard-policy audit-only --out evidence-audit.json
node veritas/replay.js --agent-audit verdicts.json --refetch --guard-policy audit-only --out evidence-audit.json --cache-out native-cache.json
```

Conservative autonomous fallback, from repository root:

```powershell
node veritas/batch.js --input blind.csv --researcher collect --provider none --judge none --output submission.csv --audit submission-audit.json --checkpoint submission-run.jsonl --deadline 2026-11-27T19:35:00+01:00 --concurrency 4
```

Use fresh artifact paths; add `--resume` only for the identical configuration/input after interruption. Require `validation: OK` and every input exactly once. The official brief requires a verdict file, reasons and checkable sources but does not guarantee the local nine-column CSV schema; confirm the released submission instructions. Do not manually research official blind products.

Optional runtime configuration: `TAVILY_API_KEY` for the application's keyed REST provider, `OPENAI_API_KEY`/`OPENAI_MODEL` for the optional OpenAI judge; existing SaaSLens provider/model configuration stays owned by main. CLI OAuth Search/Extract was live-verified, but it is not an application REST API key. Do not read credential stores or copy OAuth tokens into API-key settings. Agent installation skills are not globally activated by this PR.

## BLOCKED / limits

No live end-to-end SaaSLens/VERITAS provider run was verified; current-schema integration is fixture/snapshot-tested. API-key provider success and paid semantic-judge execution remain unverified. OpenCode experiment reports do not prove a shipped OpenCode adapter. The optional intent-based Tavily source restriction is regression-tested but has no post-fix live accuracy result. Reference interpretation, scope ambiguity, model consistency, cost telemetry and generalization remain limitations. Do not infer an improvement from additional code, search volume or passing tests.

No merge or self-approval is authorized. Owner command for later updates remains `git push origin feat/adversarial-fact-checking` from this repository.
