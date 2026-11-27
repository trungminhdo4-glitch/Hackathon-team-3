# SaaSLens live evaluation

Sol produced detailed, sourced reports for 18 of 20 dataset URLs on the first attempt. All 18 were Yellow. On the held-out batch, it matched the reviewer on 3 of 10 URLs. All three matches were evidence gaps. This run demonstrates live evidence collection and bulk reporting. It does not demonstrate reliable automatic classification.

## Method

We fixed two disjoint groups from the 40-row dataset before running the comparison. Each contained three reviewer Greens, four Yellows and three Reds. The first ten used single-product requests. The validation group used one streaming bulk request. Both used the same running research build, GPT-6.2 Sol and optional GPT-6 Luna. Only URLs and the model selection went to the API. We compared against reviewer labels afterward. No reviewer supplied hints during these runs.

| First-pass measure | Single-product test | Held-out bulk validation |
| --- | ---: | ---: |
| Submitted | 10 | 10 |
| Completed reports / failed URLs | 9 / 1 | 9 / 1 |
| Green / Yellow / Red | 0 / 9 / 0 | 0 / 9 / 0 |
| Yellow with a cited material caveat | 3 | 2 |
| Yellow for missing or inconclusive evidence | 6 | 7 |
| Same color as reviewer, out of all submissions | 4/10 | 3/10 |
| Same color backed by a material finding, out of all submissions | 2/10 | 0/10 |
| Pages checked / cited or contextual observations retained | 94 / 198 | 90 / 164 |

An always-Yellow guess would match 4/10 in either group. Agreement measures overlap with these particular reviewers and includes evidence-gap Yellow. The stricter measure excludes gap-only matches. These are small, deliberately balanced samples. They do not estimate accuracy across all software.

## Results by product

“Gap” means the app finalized Yellow because the collected passages left the core claim unresolved. “Caveat” means a sourced limitation determined Yellow. Observations include contextual passages, even when none qualified as decisive evidence. Failures have no color.

| Row | Product or submitted site | Reviewer | First pass | Observations | What the report found or missed |
| ---: | --- | --- | --- | ---: | --- |
| 1 | Omnissa | Green | Yellow · gap | 17 | Found support dates for specific generations. Delivery of the broader workspace promise remained open. |
| 2 | Microsoft 365 Copilot Chat | Yellow | Yellow · caveat | 19 | Distinguished included web-grounded chat from licensed access across work data and metered agents. |
| 3 | Bending Spoons | Yellow | Yellow · gap | 17 | Recorded the operator’s portfolio claim. The corporate URL left performance of individual products unresolved. |
| 4 | PimEyes | Red | Yellow · caveat | 26 | Found a paid-access limit on opening source sites. The decisive finding concerned access and pricing. |
| 5 | Vertica | Yellow | Yellow · gap | 19 | Found performance claims but insufficient evidence to establish the advertised result for the use evaluated. |
| 6 | Postfix | Green | Failed | 0 | The single investigation returned HTTP 503. |
| 7 | HS Nettoeinkommen Pro 2026 | Red | Yellow · gap | 20 | Retained the publisher’s statement that development ends after 2026. The verdict did not give that passage decisive weight. |
| 8 | Datto | Green | Yellow · gap | 37 | Recorded recovery and communications findings across products. Overall capability remained unresolved. |
| 9 | Autodesk Fusion | Yellow | Yellow · caveat | 25 | Found the personal-use eligibility and revenue conditions, including exclusions for commercial work. |
| 10 | AuditAlign | Red | Yellow · gap | 18 | Captured governance-mapping claims. The passages did not establish the accuracy of that mapping. |
| 11 | knooing | Red | Yellow · gap | 14 | Captured the claimed IT management scope. Verification of ordinary use remained open. |
| 12 | QlikView | Yellow | Failed | 0 | The bulk API isolated a research failure and continued the batch. |
| 13 | COGPACK | Green | Yellow · gap | 1 | Retained the publisher’s identification of the training software. Evidence of actual outcomes was thin. |
| 14 | Snow Atlas | Yellow | Yellow · gap | 12 | Found the intended software asset management audience. The promised savings remained unresolved. |
| 15 | Redmine | Green | Yellow · caveat | 24 | Treated differences in support across release branches as material. The reviewer emphasized active maintenance. |
| 16 | R | Green | Yellow · gap | 28 | Found documentation for statistical computing and graphics. The collected passages left the assessment of the full promise unresolved. |
| 18 | Microsoft 365 Copilot | Yellow | Yellow · gap | 23 | Found a workplace trial. The report still lacked decisive evidence covering the full product assessment. |
| 20 | AnyDesk | Red | Yellow · gap | 20 | Established subscription terms. Those terms did not settle performance or the reviewer’s procurement concerns. |
| 21 | Tipard PDF to Word Converter | Red | Yellow · caveat | 26 | Found a displayed price alongside a notice that the standalone product was no longer for sale. The reviewer also weighed operator transparency. |
| 22 | Tungsten Automation | Yellow | Yellow · gap | 16 | Captured product-suite tier information. The company URL left the exact capability under evaluation broad. |

Across the completed reports, 362 observations each carried a source URL, quotation, finding and explanation. Fourteen were classified as customer documentation and one as a vendor-hosted testimonial. The activity logs recorded Luna participation in 13 of the 18 reports. A collected passage is not independent corroboration by itself. For example, the developer’s end-of-development notice is direct evidence about the publisher’s plans. It does not independently verify tax calculations or every hardware-compatibility claim. [Publisher’s product page](https://www.nettoeinkommen.de/index.htm)

## Rechecks of the two failures

After updating partial-result handling, we ran Postfix and QlikView again on the final research build. Both completed. Postfix retained 22 observations, including a TLS configuration finding, but independent discovery was incomplete and the app returned evidence-gap Yellow. QlikView retained 29 observations. The publisher names replacement products for hosted and on-premises deployments, which justified a Yellow lifecycle caveat and matched the reviewer. Across both attempts all 20 URLs have a report. The rechecks are excluded from the first-pass metrics above.

## Reproduce and export

With the app running and a server-side key configured, use fresh output paths. Each research command calls live hosted search and incurs API usage. The export command reads saved responses locally.

```sh
python tests/calibrate.py --model gpt-6.2-sol --output test.jsonl --report-dir test-reports
python tests/calibrate.py 11 12 13 14 15 16 18 20 21 22 --model gpt-6.2-sol --bulk --output validation.jsonl --report-dir validation-reports
node tests/export-calibration.js validation.jsonl validation-reports validation-export
```

The export contains an eight-column CSV, Markdown for each completed product, and metrics that preserve every submitted row. Findings reflect the sources returned on each run and can change on a fresh search.
