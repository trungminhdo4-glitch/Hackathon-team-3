# GPT-6 Luna with Tavily Search on 40 software products

**19 of 40 verdicts matched the reviewer (47.5%), up from 17 of 40 (42.5%).** Three previously incorrect colors matched this time and one previous match was lost. Predicting Yellow for every product would score 16/40 (40%). [Compare both verdicts and reasons for every product](TAVILY_COMPARISON.csv)

| First-pass result | OpenAI search | OpenAI + Tavily Search |
| --- | ---: | ---: |
| Completed | 40/40 | 40/40 |
| Green / Yellow / Red predictions | 2 / 37 / 1 | 4 / 35 / 1 |
| Correct Green | 1/14 | 3/14 |
| Correct Yellow | 15/16 | 15/16 |
| Correct Red | 1/10 | 1/10 |
| Yellow because of an evidence gap | 31 | 27 |
| Correct color with a substantive finding | 4/40 | 7/40 |
| Source observations retained | 676 | 724 |

Twelve of the 19 matches were evidence-gap Yellows. Six of the ten reviewer Reds ended in a gap, three received a cited Yellow caution, and one received Red. DoNotPay was the Red match in both runs.

## What changed

| Product | Previous → new | Reviewer | Decisive difference |
| --- | --- | --- | --- |
| Postfix | Yellow → Green | Green | A Red Hat deployment guide found through Tavily showed how administrators use Postfix to transport mail. The report cited the guide in the verdict. [Red Hat deployment guide](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/8/html/deploying_different_types_of_servers/assembly_mail-transport-agent_deploying-different-types-of-servers) |
| R | Yellow → Green | Green | A worked example showed R transforming data and returning a result. The verdict cited that evidence. The page found through Tavily was separate. |
| Autodesk Fusion | Green → Yellow | Yellow | The new color matched because the agent considered the workflow evidence inconclusive. The reviewer’s concern was bundle and license ambiguity. |
| Tungsten TotalAgility | Yellow → Green | Yellow | A partner case study supported use in accounts payable. The agent did not carry the reviewer’s concern about acquisitions, product names and scope into its verdict. |

The Copilot Chat URL alone again received an evidence-gap Yellow. The separate smoke test that supplied a specific licensing question produced a grounded licensing explanation. Only the URL-only result is included in the 19 matches.

## What Tavily contributed

All 40 products logged completed Tavily searches and OpenAI hosted queries. OpenAI logged 506 queries. Tavily returned 200 candidate URLs across the batch. Of 65 attempted page reads from Tavily, 46 yielded readable text, 17 were unavailable and two redirected to the vendor in an independent-source search. Thirty-one products had at least one readable Tavily result.

Seven reports cited a Tavily-discovered page in a finding, answer, attribution or testimony. Six linked one to their verdict explanation. Three of those six had a substantive procurement verdict (Postfix, QlikView and AnyDesk); the other three explained an evidence gap. A citation here identifies how the source was found and does not establish that removing it would change the verdict.

## Measurement

On 27 November 2026 SaaSLens received the original 40 public URLs in one bulk request. GPT-6 Luna handled all research and assessment. The request contained no product names, reviewer labels, notes or extra questions. The evaluator scored the first result for every URL against its original review. Both runs used fresh web searches on the same development set, so the five-point gain cannot be attributed solely to the extra provider.

The measured build was [851359c](https://github.com/trungminhdo4-glitch/Hackathon-team-3/commit/851359c). It used Tavily Search. The subsequent Tavily Map integration and briefing layout are outside this measurement. [Previous evaluation](PROCUREMENT_EVALUATION.md)
