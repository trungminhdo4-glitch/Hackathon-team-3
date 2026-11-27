# Authenticated Tavily — actual development comparison

## FACT

The owner explicitly approved `@tavily/cli` installation and browser login. The package-gate owner decision was recorded; a network-enabled check returned ALLOW. Global installation completed with CLI **1.0.1**. Initial browser authorization displayed a Tavily error page; one documented `tvly login --no-browser` retry succeeded after owner consent. `tvly auth --json` reported authenticated via OAuth. A public documentation Search and full Extract succeeded. No credential file was read, copied into application code or committed. Global Agent Skills were not installed; this is verified CLI access, not a claim that every setup layer is active.

The earlier direct REST keyless requests returned 429. CLI OAuth authorization is distinct from `TAVILY_API_KEY`; the application's keyed REST provider still requires its own valid runtime API credential. The CLI is used **only for the agent's session experiment**, not as the application's runtime integration.

### Compatibility failure preserved

The first registered vendor attempt stopped after one failed search; five cases were retained as not started. CLI help exposes SDK options which its OAuth MCP route rejected: `include_raw_content` string `text` failed a boolean schema, and `include_answer` and `include_usage` were unexpected parameters. No vendor evidence resulted. The failure is retained under `test-results/tavily-auth-20261127/`; it is not counted as successful research or silently retried inside the same budget.

A second, separately registered run used the verified minimal Search parameters and a separate full Extract command. This succeeded for all six source acquisitions. No query-chunk joining or generated answers were accepted as native source text.

### Controlled result

Same six intentionally selected, already inspected development questions as the earlier experiment. One Search and one Extract per case: **six searches, six extracts**, zero retries within this run. Total recorded case wall time was about **31 seconds**. Every document has captured text, actual timestamp and a locally computed hash; final redirect destination is unverified. Source ranking preferred vendor domains for product facts and government domains for legal/privacy questions, with provider order as the fallback. It was too permissive when no suitable source existed.

A fresh extractor saw only these captured documents and questions, with no verdict or reference labels. It produced partial answers for three cases and no findings for three others. An independent fresh factual auditor confirmed the limitation: product identity returned placeholder-like text; lifecycle returned a page about a different vendor; a generic vendor privacy policy did not establish historical conduct/remedy. Empty findings are not evidence that there is no problem. No fabricated allegations were introduced.

Two additional fresh judges received the unchanged general rubric and eighteen shuffled opaque packets: six prior focused packets, six Tavily-only packets, six packets combining prior evidence with new Tavily findings. Reference labels were loaded only after both prediction files were saved. Packet hashes, unique input coverage and quote/native-text matches were checked. Same-URL material was not represented as independent corroboration.

| Evidence | Luna correct | Terra correct | Luna macro F1 | Terra macro F1 |
| --- | ---: | ---: | ---: | ---: |
| Previous focused evidence | 4/6 | 4/6 | 0.656 | 0.500 |
| New Tavily evidence only | 1/6 | 2/6 | 0.167 | 0.333 |
| Previous plus Tavily evidence | 3/6 | 4/6 | 0.433 | 0.500 |

Relative to the contemporaneous baseline, Tavily-only gives Luna 0 wrong→right / 3 right→wrong, Terra 0 / 2. Augmentation gives Luna 0 / 1 and Terra 0 / 0. No critical Red→Green or false Red occurs. Per-class recall, all individual predictions and reasons are in `metrics.json`. These six selected cases are **not a fresh holdout**. The baseline uses cached previous research and the other arms add live budget, so this is not an equal-total-cost researcher comparison. Actual monetary cost was unavailable. No independently certified overall-grounded accuracy is claimed; the separate audit evaluated factual source relevance and extraction, not overall procurement materiality.

The same frozen baseline can receive different individual colors in fresh contexts despite the same aggregate count. Judgment consistency and materiality therefore remain limitations. **Decision: do not replace the stronger existing competition researcher with this Tavily-only or augmented variant.** No official blind inputs were accessed.

## IMPLEMENTED

The observed irrelevant-source failure led to an explicit, generic `intent` policy in `planFocusedQuery` / `researchQuestion`:

- `identity`, `commercial`, `maintenance`, `lifecycle`: scope discovery to the submitted vendor host and its subdomains; other domains remain discovery leads and cannot become that intent's captured evidence.
- `legal`, `privacy`: plan external regulatory/enforcement research and reject the submitted vendor's own page when independent evidence is requested. Keywords guide discovery; they establish no incident or wrongdoing.
- `general` preserves the previous behavior. Invalid intents fail before requests. There are no vendor-specific expected answers or source URLs.

This policy is opt-in through the question input's `intent`. It has regression tests, **but was implemented after the above frozen live run and has no new live accuracy measurement**. The run and its failed outcomes were not rewritten. Prior verified evidence should be preserved and reassessed alongside any new source; replacement with a sparse new search result is not justified.

`veritas/bench/tavily-live.mjs` is the bounded session experiment; `tavily-live-judge.mjs pack|score` freezes and evaluates the three arms. Production REST integration remains separate. With valid REST credentials, a question file can use:

```json
[{"id":"1","url":"https://vendor.example/","intent":"lifecycle","question":"What exact product development or support end is officially announced?"}]
```

```powershell
node veritas/focused-research.js --input questions.json --out NEW_DIRECTORY --provider tavily
```

The command gathers source artifacts only; factual extraction and a separate judge remain required. Do not import CLI OAuth credentials into an API-key field or use the CLI as the product runtime. Do not rerun session collection over frozen directories.

## TESTED

Full required quality loop: **135/135 passed**, comprising **111 VERITAS and 24 application tests**. Live CLI Search, Extract and authenticated-state checks succeeded. The six-case compatible run acquired six documents and independent assessment found useful partial evidence in three. Tests additionally verify vendor-domain restrictions, external-source requirements, invalid intents, exact source binding, credential isolation, cancellation and budgets.

Artifacts are committed under `test-results/tavily-auth-20261127-compatible/`: preregistration, raw Search/Extract responses, native cache, request log, extraction, independent factual audit, blinded packets, hashes, condition map, both judges and metrics. Reproduce the saved evaluation with `node veritas/bench/tavily-live-judge.mjs score`. No additional web requests are needed to inspect the result.

## BLOCKED / limits

There is **no measured accuracy gain** and no live measurement of the new intent restriction. The authenticated CLI is usable for session research; direct application REST authentication is a separate dependency. Global skill activation was not performed. Competition defaults and known fallback remain unchanged. End-to-end autonomous contest execution, costs and generalization remain unverified. All retrieved pages were treated as untrusted data; none of their embedded instructions were executed. No merge, rebase, push, deletion, key-file access or manual blind research occurred.
