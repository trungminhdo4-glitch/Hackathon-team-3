# Did the buyer-focused questions improve accuracy?

**Exact color agreement stayed at 17/40 (42.5%).** Luna correctly moved SAP LeanIX to Green and incorrectly moved Autodesk Fusion to Green. The other 38 colors stayed the same. Both runs returned 40 reports. The second run logged 502 hosted search queries and retained 676 source observations across all 40 products. It still finalized 31 cases as Yellow for missing evidence. [Compare the reviewer’s reasoning and both predictions for all 40 products](LUNA_COMPARISON.csv) · [Original annotation audit](DATASET_AUDIT.md)

| First-pass result | Original Luna | Buyer-focused Luna |
| --- | ---: | ---: |
| Exact color matches | 17/40 (42.5%) | 17/40 (42.5%) |
| Predicted Green / Yellow / Red | 0 / 39 / 1 | 2 / 37 / 1 |
| Yellow for an evidence gap | 31 | 31 |
| Correct colors with a substantive finding | 5/40 (12.5%) | 4/40 (10%) |
| Correct among the nine substantive verdicts | 5/9 | 4/9 |
| Balanced accuracy (mean recall across colors) | 36.7% | 37.0% |
| Source observations retained | 606 | 676 |

| Reviewer | Predicted Green | Yellow with a caveat | Yellow for a gap | Predicted Red | Correct |
| --- | ---: | ---: | ---: | ---: | ---: |
| Green | 1 | 2 | 11 | 0 | 1/14 |
| Yellow | 1 | 2 | 13 | 0 | 15/16 |
| Red | 0 | 2 | 7 | 1 | 1/10 |

Always predicting Yellow gives 16/40 (40%). Randomly picking among the three colors with equal probability has expected accuracy of 33.3%. The revised run beat the majority baseline by one product. Thirteen of its 17 matches were inconclusive reports on products the reviewer had labeled Yellow.

## Where the reasoning agreed and diverged

- **SAP LeanIX, Green.** The first run sought proof of a broad AI promise. The revised run identified Virgin Atlantic using LeanIX to examine architecture changes. That named use supports the reviewer’s decision to shortlist the product. The customer account was published by SAP. [Customer account](https://www.sap.cn/asset/dynamic/2026/03/e6de32d7-427f-0010-bca6-c68f7e60039b.html)
- **Autodesk Fusion, Green against reviewer Yellow.** A named implementation showed design work progressing through to manufacturing. It did not settle the reviewer’s question about which SKU, bundle and token terms the buyer would need. Evidence that a workflow exists can coexist with a material purchase condition. [Implementation report](https://www.autodesk.com/support/partners/success-stories/implementation-of-autodesk-fusion-360-and-workflow-enhancement/9888)
- **Microsoft 365 Copilot Chat, Yellow in both runs.** The second run retained Microsoft’s description of the included subscription entitlement and the additional capabilities of the paid license. The verdict still asked for a demonstration of chat. The color matched, but the decisive explanation missed the reviewer’s licensing and work-data question. [Publisher’s comparison](https://www.microsoft.com/en-us/copilot/features/chat)
- **Notepad++, Yellow in both runs.** This time the report explained a historical distribution compromise and what a buyer should check about installation and updates. The original report ended on missing proof of the editor’s ordinary use. This is a reasoning improvement the accuracy number cannot show. [Source used for the finding](https://unit42.paloaltonetworks.com/notepad-infrastructure-compromise/)
- **accessiBe, Yellow against reviewer Red.** The revised run reached the FTC’s final disposition and described the restriction on accessibility claims. It treated that restriction as a condition for further diligence. The reviewer considered it decisive for a buyer relying on the advertised accessibility outcome. Finding the relevant record and weighing its consequence are separate failure points. [FTC case record used in the report](https://www.ftc.gov/legal-library/browse/cases-proceedings/2223156-accessibe-inc)

## Why Yellow dominates

The reference reviews weigh ordinary use, stewardship, terms, ownership and trust together. The researcher now looks for these explicitly, including final regulatory records and end-of-life notices. The decision code can award Green for both maintenance and independent adoption. When the evidence cannot be tied to the product or edition, or a material finding does not survive quote validation, the fallback still emphasizes demonstrating a user task. In these runs that frequently displaced the buyer’s actual question. More search results alone did not resolve it.

**Pages checked** now exposes what happened before the verdict. Across the recorded official and independent search-page attempts, 243 produced readable text and 161 did not. The most frequent recorded reasons were the response-size limit (57), HTTP 403 (54), and empty text (24). In the Omnissa report, the official Workspace ONE release notes supplied a cited passage. An independent law-firm acquisition release returned HTTP 403, and a Companies House filing used an unsupported format. Each entry shows the URL and the search responsible for it. Retrieved passages and suggested next steps appear where available. [Omnissa release notes](https://docs.omnissa.com/Workspace-ONE-UEM-Release-Notes-V2506/WorkspaceONEUEM-ReleaseNotes/) · [Attempted acquisition release](https://omm.com/news/press-releases/o-melveny-advises-broadcom-on-closing-of-us-4-billion-omnissa-acquisition-by-kkr/)

## Measurement

On 27 November 2026 the streaming bulk API received the same 40 original URLs and the model selection. All 40 completed on their first attempt. Every saved report and its activity identified GPT-6 Luna for research and assessment. The evaluator joined the reviewer labels and notes afterward. These are development-set results with fresh web searches in each run. They measure end-to-end agreement on these examples, and do not isolate the effect of the prompts or establish accuracy on new products.

Use the full-dataset command in the [README](README.md) to collect a run. To compare two saved runs without new API calls, run `python tests/compare-calibrations.py before.jsonl after.jsonl comparison.csv`.
