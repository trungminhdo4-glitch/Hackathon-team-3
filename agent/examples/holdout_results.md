# Twenty-product blind dry run

The URL, reference label, rationale and public source for each case were committed in [holdout_urls.csv](holdout_urls.csv) at `d6524a2` before the agent saw the inputs. Only the URLs were passed to the agent. None of the 20 product domains appears in the supplied 40-row CSV. The hand-picked set has six Green, eight Yellow and six Red cases. It is a regression set, not a random sample or an official accuracy estimate.

## Result

**14/20 (70%)**, with **0 Red → Green and 0 Green → Red** errors. All 20 rows completed in model mode; CSV and JSON agreed on every URL and verdict. References are procurement judgments for the named product and use—not labels for every product a vendor sells.

Run outputs: [verdicts CSV](holdout_verdicts.csv) and [evidence audit JSON](holdout_verdicts.json).

| Reference ↓ / predicted → | Green | Yellow | Red |
| --- | ---: | ---: | ---: |
| Green | 5 | 1 | 0 |
| Yellow | 2 | 5 | 1 |
| Red | 0 | 2 | 4 |

| Product | Reference | Verdict | Reason for mismatch |
| --- | --- | --- | --- |
| PostgreSQL | Green | Green | |
| VLC | Green | Green | |
| OBS Studio | Green | Green | |
| Blender | Green | Yellow | The vendor page returned HTTP 403. All three initial votes were Green, but none of their proposed Green reasons survived quote verification. The independent Steam listing was not in the collected evidence. |
| Raspberry Pi 5 | Green | Green | |
| Original Prusa MK4S | Green | Green | |
| Docker Desktop | Yellow | Green | The agent correctly found the enterprise paid-license threshold, but treated clear documentation as a Green rather than a reason to check the intended deployment. |
| Oracle JDK | Yellow | Red | The audit contained the current licensing FAQ, but the verdict treated a 2015 FTC settlement as a current blocker without establishing ongoing impact. |
| Terraform | Yellow | Yellow | |
| Elasticsearch | Yellow | Yellow | |
| CentOS Stream | Yellow | Yellow | |
| JetBrains Fleet | Yellow | Yellow | |
| Redis | Yellow | Yellow | |
| Cloudflare Registrar | Yellow | Green | The verdict cited active service and at-cost pricing but missed the requirement to move authoritative DNS to Cloudflare. |
| Kaspersky Antivirus (US) | Red | Red | |
| Google Stadia | Red | Red | |
| Mozilla Pocket | Red | Red | |
| Adobe Flash Player | Red | Yellow | The cached judge response used a Red end-of-life reason. Its source URL also had a legal-entity-gap finding, so `hollow_guard` incorrectly demoted the lifecycle reason before verification. Replaying the guard with the saved evidence reproduced the downgrade. |
| BlackBerry 10 legacy device services | Red | Yellow | All three initial votes were Red and the audit contained the exact retirement FAQ, but neither proposed Red reason passed quote verification. |
| 23andMe | Red | Red | |

The hardware checks included Raspberry Pi 5, Prusa MK4S, and retired BlackBerry device services. Only Prusa was classified as hardware; Raspberry Pi and BlackBerry were unclassifiable. Blender and Raspberry Pi both triggered HTTP 403. Their first-pass browser fallbacks could not start because the Playwright Chromium binary was missing. After installing it, a two-URL collector-only check confirmed the browser launches, but both cases remained unclassifiable. The 20-row score above is unchanged; the follow-up used no model or search calls.

## Run and cost

Default `openai/gpt-oss-120b`, five workers, screenshots off, warm cache directory. Evidence for these URLs was cold for Tavily and the judge. **126.81 s** wall; **29.27 s median**, **34.57 s p95** (nearest rank) and **39.47 s max** per vendor. **186 Tavily credits** and **$0.114 estimated Nebius cost** at list prices (80 requests, 565,048 input / 48,732 output tokens). The launcher reserved budget before outbound calls; neither the 300-credit ceiling nor the $1 Nebius ceiling was reached.

From `agent/` with provider credentials configured, extract just the URLs before running:

```bash
python -c 'import csv; from pathlib import Path; rows = csv.DictReader(open("examples/holdout_urls.csv", newline="")); Path("holdout-input.txt").write_text("".join(row["url"] + "\n" for row in rows))'
LLM_MODEL=openai/gpt-oss-120b python agent.py --blind --input holdout-input.txt \
  --out holdout-verdicts.csv --audit-out holdout-audit.json --workers 5 --no-screenshot --evidence
```

A fresh cache or changed web pages can change cost and verdicts. For a subsequent patch, first protect verified exact-product lifecycle evidence from unrelated legal-entity downgrades; then improve current applicability checks for old enforcement and target edition or operational terms when initial discovery misses them.
