# Team comparison — November 27, 2026

The locked pipeline (`6297199`) and the updated pipeline (`f5549f7`) each matched **27/40 (67.5%)**, with **zero Red → Green and zero Green → Red errors**. We kept the updated version for its hardware support, coverage fallbacks, and partial verdicts on timeout.

Development variants scored **52.5–75.0%**, including **30/40 (75.0%)** immediately before voting and excerpt verification. Always guessing Yellow scores **16/40 (40%)**. With only 40 rows, a rough sampling margin is about **±15 percentage points** near these scores. Similar products produce correlated errors, and the rubric was learned from the same 40 rows. Excluding the matching few-shot example does not make this a held-out benchmark; expect this evaluation to be optimistic.

## Locked pipeline

| Expected ↓ / predicted → | Green | Yellow | Red |
| --- | ---: | ---: | ---: |
| Green | 7 | 7 | 0 |
| Yellow | 2 | 14 | 0 |
| Red | 0 | 4 | 6 |

**Highest-cost errors:** zero Red → Green and zero Green → Red. Four labeled Reds went to manual review instead of being blocked; seven labeled Greens also went to review. The verifier can turn a majority verdict into Yellow if no fully supported flag of that color survives.

| CSV rows | Expected → predicted | Vendors/products |
| --- | --- | --- |
| 1, 6, 8, 13, 23, 26, 33 | Green → Yellow | Omnissa, Postfix, Datto, COGPACK, Gainsight, ManageEngine, opsi |
| 9, 31 | Yellow → Green | Autodesk Fusion, Schneespur |
| 4, 11, 21, 35 | Red → Yellow | PimEyes, Knooing, Tipard PDF to Word Converter, Prayer Platform |

## Updated pipeline

| Expected ↓ / predicted → | Green | Yellow | Red |
| --- | ---: | ---: | ---: |
| Green | 6 | 8 | 0 |
| Yellow | 1 | 15 | 0 |
| Red | 0 | 4 | 6 |

Only two predictions changed. Autodesk Fusion (row 9, labeled Yellow) moved from Green to Yellow, correcting a miss. IrfanView (row 39, labeled Green) moved from Green to Yellow, adding a miss. All ten labeled Red rows kept the same verdict.

## Judge-only Nebius comparison

For the model comparison, capture each row's evidence once with screenshots off, then swap only the judge and verifier model. The capture reused **375 Tavily responses and spent 0 new credits**. It rejected uncached Tavily requests rather than buying new results. This controls the evidence within the comparison, not against the earlier 67.5% result: live sources, collection coverage, and cached responses can differ across runs. Use the judge-only baseline in the table, not 67.5%, to compare models.

| Model | Accuracy | LLM / rules rows | Wall, median, p95 | Reported input / output tokens | Estimated cost |
| --- | ---: | ---: | --- | --- | ---: |
| `openai/gpt-oss-120b` | 22/40 (55.0%) | 40 / 0 | 31.64 s, 5.69 s, 7.28 s | 1,130,416 / 101,425 | $0.23 |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017-fast` | 25/40 (62.5%) | 29 / 11 | 92.57 s, 16.31 s, 25.89 s | 1,090,597 / 390,461 | $1.59 |
| `zai-org/GLM-5.3` | 20/40 (50.0%) | 13 / 27 | 243.02 s, 41.80 s, 62.97 s | 1,112,576 / 432,863 | $3.46 |
| `moonshotai/Kimi-K3.1-Pro` | 24/40 (60.0%) | 11 / 29 | 301.70 s, 55.61 s, 111.06 s | 166,266 / 49,559 | $0.83 |

Each matrix below lists the predicted Green / Yellow / Red counts for each expected color. None of these runs had a Red → Green or Green → Red error.

| Model | Expected Green | Expected Yellow | Expected Red |
| --- | --- | --- | --- |
| GPT-OSS | 3 / 11 / 0 | 2 / 14 / 0 | 0 / 5 / 5 |
| DeepSeek Flash Fast | 3 / 11 / 0 | 0 / 16 / 0 | 0 / 4 / 6 |
| GLM-5.3 | 0 / 14 / 0 | 0 / 15 / 1 | 0 / 5 / 5 |
| Kimi-K3.1-Pro | 2 / 12 / 0 | 0 / 16 / 0 | 0 / 4 / 6 |

These are judge timings for 40 rows with eight workers, excluding evidence collection, not full blind-batch timings. Cost estimates apply [Nebius list prices](https://tokenfactory.nebius.com/model-catalog.md) to reported usage before provider-side cache discounts; failed requests may not return usage. The Flash variant did not recover any additional Greens, needed a rules fallback on 11 rows, and cost more. GLM needed the rules fallback on 27 rows, even though its one-call probe had responded fastest. Neither result justifies switching the live default. In the GPT-OSS audit, seven of the eleven missed Greens were voted Yellow before verification. Four had Green majorities but no fully supported Green claim survived. Both initial judgment and evidence verification contribute to the Yellow bias.

Kimi's run reused 375 Tavily responses (0 new credits). GPT-OSS judged the same capture with 160 model cache hits, 0 new calls, and the same 22/40 result; the table uses earlier cold model timings for that baseline. Kimi gained two matches, but 29 rows fell back to rules and its judge-only p95 was 111 seconds. That leaves little room under the 150-second per-vendor blind timeout for evidence collection. `openai/gpt-oss-120b` remains the default.

The `deepseek-ai/DeepSeek-V4-Pro-0813` run was stopped before completion. `Qwen/Qwen3.5-397B-A17B` previously returned 404 and was absent from the authenticated Nebius model list on recheck, so it was not benchmarked.

Two code experiments also did not justify a live change. Appending localized and generic keywords directly to existing risk queries, together with a material-quote exception in verification, scored **25/40** (44 new Tavily credits) and introduced one Red → Green error. The affected row had three Green votes, so a verifier exception that only applies to Red votes could not have caused that verdict. Retaining the original enforcement query, moving localized terms to a separate query within the same budget, and adding guidance for maintained, established products removed the Red → Green error, but scored **24/40** (4 new Tavily credits, no Red ↔ Green errors); Red recall fell from **6/10 to 3/10** versus the updated pipeline. These were bundled experiments, not per-feature ablations, and are not in the live branch.

## Five unseen submission rows

| Product | Verdict | Worker seconds |
| --- | --- | ---: |
| Notion | Green | 6.64 |
| SQLite | Green | 5.67 |
| Bruno | Yellow | 6.98 |
| LastPass | Yellow | 7.34 |
| FreePDFConvert | Yellow | 5.10 |

All five domains were outside the labeled CSV. The batch finished in **7.48 s** with a warm search cache, no crashed or timed-out rows, and matching CSV and JSON verdicts. This tests batch behavior, not prediction accuracy; no independent blind labels were collected. All 11 distinct final citations returned HTTP 200 in the spot-check. Three supporting excerpts were not found verbatim in the fetched HTML (SQLite's YouTube citation, one Bruno excerpt, and the LastPass blog post); those links are not fully substantiated by this check. In particular, the SQLite professional-support claim still needs a direct source. A 200 response and an excerpt-based pass are not proof that a human can verify each claim on the page.

## Laptop handoff

These results are from the user's laptop transcript, not rerun in this environment:

| Run | Correct | Green recall | Red recall | Red → Green / Green → Red |
| --- | ---: | ---: | ---: | ---: |
| GPT-OSS 120B, fixes 1–3, basic Tavily | 29/40 (72.5%) | 9/14 | 7/10 | 0 / 0 |
| Haiku 5.5, same pipeline | 29/40 (72.5%) | 6/14 | 7/10 | 0 / 0 |

All 16 Yellow rows were correct with Haiku versus 13 with GPT-OSS. Haiku's run reported about **$0.30** of model usage and no new Tavily credits. A merge rule selected after comparing the two saved runs reached **31/40**, but was not tested on blind products. A separate advanced-search GPT-OSS run dropped to **21/40**, so basic search remains the default. Opus deep research reported **12/26** on the same completed rows where the pipeline got **20/26**, including one Red → Green for deep research. This is a partial comparison, not a completed 40-row deep benchmark. Use the pipeline-only command in [README.md](README.md#live-submission) for submission.

The imported pipeline was smoke-tested on the same five example URLs: 5 matching CSV and JSON rows, all in model mode, in **9.52 s**. Tavily reused 47 cached responses with **0 new credits**. Nebius used 20 calls, 141,144 input tokens, and 14,364 output tokens (about **$0.03** at list price). This smoke run checks execution and output parity, not verdict accuracy; the earlier checked-in example outputs were not overwritten.

### Model comparison after fixes 1–3

We captured evidence for all 40 products once with the fixed pipeline and screenshots off, then ran each model through the same voting, rules and verification stages on that capture. Tavily had **375 cache hits, 0 new credits, and 0 cache misses**. This is a separate development run from the laptop results above; compare models within this capture rather than treating the score change as a model improvement.

| Judge | Correct | Model / rules rows | Judge median / p95 per row | Estimated Nebius cost |
| --- | ---: | ---: | ---: | ---: |
| GPT-OSS 120B | **31/40 (77.5%)** | 40 / 0 | 5.63 s / 7.44 s | $0.24 |
| DeepSeek V4.1 Flash Fast | 24/40 (60.0%) | 29 / 11 | 13.05 s / 18.42 s | $1.75 |
| Kimi K3.1 Pro | 26/40 (65.0%) | 26 / 14 | 54.76 s / 84.30 s | $6.81 |

All three had zero Red → Green and zero Green → Red errors. In the saved-run replay, “decisive wins, Green vs Red → Yellow” with either second judge made **no verdict changes** versus GPT-OSS alone. Letting any second-judge Red override GPT-OSS also made no changes. A strict majority of active judges, with ties sent to Yellow and rules-mode fallbacks abstaining, dropped to **26/40**. The Nebius launcher tracked **$8.80** under a **$20 cap**, including a conservative allowance for three Kimi calls without confirmed usage. Judge timings exclude evidence collection, so they are not end-to-end times. GPT-OSS remains the live default; the second judge is opt-in for experiments.

**Anthropic pilot.** Claude Sonnet 5.5 (`claude-sonnet-5-5`) used **one vote plus claim verification** to stay under the **$3** API cap, versus GPT-OSS's three votes plus verification. The GPT-OSS replay hit all 160 model cache entries and returned the identical verdicts, votes and reasons, confirming the same judge inputs. Sonnet scored **27/40 (67.5%)** with **34 model / 6 rules rows** and **0 Red ↔ Green errors**. Its median and p95 judging times were **7.74 s / 8.93 s** per product (64.00 s wall with five workers, excluding collection). Anthropic reported 691,020 input and 38,810 output tokens: **$1.77** at $2/$10 per million tokens. No new Tavily credits or Nebius calls were used. Combining the saved Sonnet and GPT-OSS verdicts with decisive-wins or a Sonnet Red veto left GPT-OSS at **31/40** with no changes; requiring the two active models to agree dropped to **26/40**. This tested Sonnet as a judge on existing evidence, not as a web research agent.

The legal-entity guard fix moved the holdout from **14/20 to 15/20** in a saved-evidence replay (Adobe Flash Player); the development score stayed **31/40**.

## Cost and reproduction

- **Locked, 40 rows:** 0 new Tavily credits (375 cache hits); 120 new Nebius requests (40 cached), 761,124 input and 76,824 output tokens, approximately **$0.16** at list pricing.
- **Updated, 40 rows:** 9 new Tavily credits (366 cache hits); 44 new Nebius requests (116 cached), 306,148 input and 27,647 output tokens, approximately **$0.063**. A 150-uncached-search guard made no substitutions and skipped no searches. The measured cost reflects a shared warm cache, not cheaper cold judging. A fully cold run uses up to 400 basic Tavily searches and up to 160 Nebius requests.
- **Five rows:** 0 new Tavily credits (47 cache hits); 15 new Nebius requests (five cached), 94,148 input and 9,011 output tokens, approximately **$0.02**. The initial pre-lock dry run used 47 Tavily credits.

From `agent/`, with Tavily and Nebius keys configured, and `CACHE_DIR` pointing to the persistent cache (the comparison used `/home/ubuntu/repos/hackathon/cache`):

```bash
python -m unittest discover -v
CHROME_CDP_URL=http://localhost:29229 python eval.py --workers 8 --no-screenshot --cache-dir "$CACHE_DIR" --out "$CACHE_DIR/eval-results-lock.json"
CHROME_CDP_URL=http://localhost:29229 /usr/bin/time -f 'Wall clock: %e s' python agent.py --blind --input examples/dry_run_urls.txt --out examples/dry_run_verdicts.csv --audit-out examples/dry_run_verdicts.json --workers 5 --cache-dir "$CACHE_DIR"
```

To reproduce the updated 40-row run, use commit `f5549f7` with the same evaluation command and `--out "$CACHE_DIR/eval-results-tip.json"`. The capped launcher used for this measurement was external to the CLI; the command above does not enforce a credit cap. The CDP setting can be omitted when using a local Playwright Chromium install. The locked dry-run outputs are checked in under [examples/](examples/).
