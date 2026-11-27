# Second twenty-product blind dry run

[The URL and label set](holdout2_urls.csv) was locked in `d4f167b` before the agent received only the URLs. None of the 20 product domains appears in the original 40 or the first holdout. The set deliberately includes six Green, eight Yellow, and six Red references, with more exact-version end-of-life cases than a typical intake. These are manually assigned procurement references, not official labels or a random sample. All rationale links were reachable here except the CPSC recall page, which returned HTTP 403.

| Dataset | Current default before this patch | Same evidence and verification, with patch |
| --- | ---: | ---: |
| [Development](dev_gpt_oss_31_of_40.csv) | 31/40 | 31/40 |
| [Holdout 1](holdout_results.md), including the prior Flash fix | 15/20 | 17/20 |
| Holdout 2 | 7/20 | 8/20 |
| Total | **53/80** | **56/80** |

Zero Red → Green and zero Green → Red errors before and after. The second holdout baseline ran with GPT-OSS 120B, five workers, and screenshots off: **20 model verdicts, 121.86 s, 187 Tavily credits, $0.113 estimated Nebius cost**. It returned three of six Green, two of eight Yellow, and two of six Red references. CSV and JSON matched for all 20 URLs and verdicts.

The patch runs after quote verification and changes three verdicts: **Docker Desktop** and **PRTG Network Monitor** now go from Green to Yellow because verified first-party terms limit free eligibility or revert a trial to freeware; **BlackBerry's legacy services** go from Yellow to Red because the cited first-party product retirement notice gives a past end-of-life date. The fallback quotes the exact date clause instead of retaining the model's broader unverified explanation.

The after column is a post-verification replay, not a fresh web or model run. It reused saved votes, quotes, and evidence without new API calls. The development cache reproduced 39 of 40 original model input sets; the unmatched row (Vertica) was already Yellow with no verified license trigger or Red vote, so it was not eligible for either change. The first holdout's original published 14/20 predates the separate Flash fix. Scores measured after choosing changes on these sets need confirmation on new URLs.

The remaining misses include Green hardware calls whose proposed claims lacked exact supporting quotes, and old software releases whose evidence described the current product family instead of the requested version. Correcting those would require better exact-version evidence retrieval, not looser verification.
