# How the Stackgini vendor agent was built

The agent answers a procurement question: **what can we verify about the exact product at this URL?** It returns Green (evidence supports proceeding), Yellow (review needed), or Red (documented material blocker), with URLs a buyer can open. A dated website alone is not a reason to downgrade it, and missing coverage is not proof of a problem.

## Pipeline

1. **Collect evidence.** Start at the exact URL and homepage; follow a bounded set of pricing, documentation, security, privacy, legal, customer, and release pages. Extract dated releases, ownership, traction, and lifecycle statements. Use Playwright for thin or JavaScript-rendered pages and, when enabled, save a homepage screenshot. Collect RDAP registration data and Wayback history. Try exact-page Wayback copies for up to two robots-blocked pages and record the coverage limit.
2. **Corroborate.** Run bounded Tavily basic searches for independent sources on ownership, enforcement, incidents, support, and adoption. Prefer regulator records and customer-owned statements when available. A badge or vendor-hosted logo is not independent proof. Classify the offering from crawled text; for a hardware or mixed product, use model-specific searches for firmware, end-of-life, advisories, recalls, conformity, and distributor availability. Unknown or non-product pages still get an output row and coverage note.
3. **Vote and verify.** Three judge calls get the same numbered evidence and rubric. Use a two-vote majority, otherwise review as Yellow. Map evidence IDs back to collected URLs. For each proposed flag, a separate call checks the exact cited excerpts, drops unsupported claims, and narrows partial support to a quote. JSON retains votes, verification status, excerpts, and source dates when available. A Green verdict can carry Yellow flags; no model key means conservative local rules instead.
4. **Run and recover.** Collectors run concurrently with bounded requests and per-host pacing. Search, page responses, and model results are cached on disk. Blind batch workers run in isolated subprocesses with a 150-second default timeout per vendor; if possible a timed-out row retains a cited partial checkpoint, otherwise it returns low-confidence Yellow and the rest of the batch continues. CSV is the submission; JSON provides the audit.

```bash
cd agent
python agent.py --blind --input examples/dry_run_urls.txt \
  --out verdicts.csv --audit-out verdicts.json --workers 5
```

See [README.md](README.md) for API configuration and [RESULTS.md](RESULTS.md) for labeled-row misses, confusion matrices, and reproduction commands.

## Results to date

### Full 40-row GPT-OSS evaluations

| Version | Accuracy | Red → Green / Green → Red | Tavily | Estimated Nebius cost |
| --- | ---: | ---: | ---: | ---: |
| Locked (`6297199`) | 27/40 (67.5%) | 0 / 0 | 0 new, 375 hits | $0.16 |
| Updated (`f5549f7`) | 27/40 (67.5%) | 0 / 0 | 9 new, 366 hits | $0.063 |

Both used `openai/gpt-oss-120b`. The warm caches and different cache hit rates affect the cost comparison. Always predicting Yellow gets 16/40 (40%). The sample is small (roughly ±15 percentage points near these scores), and these same rows informed the rubric. This is not a blind-accuracy estimate.

### Judge-only comparison

The models within a comparison run got the same collected evidence. Evidence capture reused 375 Tavily responses with **0 new credits**. This is not the original 67.5% capture; compare models to the GPT-OSS judge-only row below. Eight workers ran judgment and verification, excluding evidence collection.

| Nebius model | Accuracy | LLM / rules rows | Red → Green / Green → Red | Wall / median / p95 | Input / output tokens | Estimated cost |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| `openai/gpt-oss-120b` | 22/40 (55.0%) | 40 / 0 | 0 / 0 | 31.64 / 5.69 / 7.28 s | 1,130,416 / 101,425 | $0.23 |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017-fast` | 25/40 (62.5%) | 29 / 11 | 0 / 0 | 92.57 / 16.31 / 25.89 s | 1,090,597 / 390,461 | $1.59 |
| `zai-org/GLM-5.3` | 20/40 (50.0%) | 13 / 27 | 0 / 0 | 243.02 / 41.80 / 62.97 s | 1,112,576 / 432,863 | $3.46 |

Costs are estimated from [Nebius list prices](https://tokenfactory.nebius.com/model-catalog.md), before provider-side caching discounts. Failed requests may not report usage. High fallback rates make these reliability results for the current pipeline, not a pure comparison of model intelligence. The Flash variant gained three matches but recovered no additional Greens; GPT-OSS remains the default. Of its 11 Green → Yellow results, seven were voted Yellow; the other four had a Green majority but no fully supported Green flag survived. Both judgment and claim verification are worth investigating.

#### Stopped probe

The `deepseek-ai/DeepSeek-V4-Pro-0813` run was stopped before it produced a complete evaluation. It has no comparable accuracy, cost, or latency result; we cannot say it would have scored better or worse. `moonshotai/Kimi-K3.1-Pro` responded in a one-call probe but was not evaluated on the 40 rows. The tested Qwen ID (`Qwen/Qwen3.5-397B-A17B`) returned 404. No further runs are planned, and `openai/gpt-oss-120b` remains the default.

### Code experiments (not shipped)

| Trial | Result | Decision |
| --- | --- | --- |
| Append localized terms to existing risk queries and allow a partial Red quote to retain Red when it still documents a material blocker | 25/40 (62.5%), 44 new Tavily credits, 1 Red → Green | Hold. The missed Red had three Green votes, so the Red-only verification exception was not responsible for that verdict. |
| Restore the original enforcement query, put localized terms in a separate slot within the search budget, and add maintained-vendor guidance | 24/40 (60.0%), 4 new Tavily credits, no Red ↔ Green; 3/10 Reds found vs. 6/10 on the updated branch | Hold. These bundles do not isolate individual feature effects. |

### Unseen vendors, hardware, and vision

- Five-vendor blind smoke: Notion and SQLite Green; Bruno, LastPass, and FreePDFConvert Yellow. CSV and JSON agreed, with no crashes or timeouts. The documented warm-cache run finished in 7.48 s; a subsequent warm-cache run took 2.22 s. All 11 distinct citations returned HTTP 200, but three excerpts were not located verbatim in the fetched HTML. Neither the small sample nor link status proves the verdicts are correct.
- Hardware smoke: the TP-Link Archer AX55 was classified as hardware and returned Green with three Green votes, a manufacturer firmware citation, and nine new Tavily credits.
- Experimental vision: `google/gemma-3-27b-it` returned screenshot observations for SQLite, correctly identifying visible navigation and a sponsor logo, but it did not identify the logo section as “Sponsors.” One case does not validate logo classifications or AI-image detection. The separate vision pass was not shipped.
- Perplexity Sonar was tested with mocked citations only; no API key was available for a live comparison. There is no measured gain from adding it.
