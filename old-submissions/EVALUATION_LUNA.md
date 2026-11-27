# GPT-6 Luna on all 40 dataset URLs

**17 of 40 verdicts matched the reviewer (42.5%).** Always predicting Yellow would match 16 of 40 (40%). Luna retrieved evidence for a range of products but assigned Yellow to 39, including every reviewer Green.

On 27 November 2026 we submitted all 40 original URLs to the streaming bulk endpoint in one request. GPT-6 Luna handled both the hosted web searches and the assessments. We verified the model IDs in every report and the recorded agent activity. The research input contained only the URLs and model selection. The benchmark compared labels afterward. All 40 returned reports on their first attempt. This is agreement on the supplied dataset, which includes products used during development.

| First-pass measure | Result |
| --- | ---: |
| Reports returned | 40/40 (100%) |
| Returned Green / Yellow / Red | 0 / 39 / 1 |
| Yellow for an evidence gap | 31/40 (77.5%) |
| Verdict supported by a substantive rubric finding | 9/40 (22.5%) |
| Color matches, including gap-only Yellow | 17/40 (42.5%) |
| Color matches with a substantive finding | 5/40 (12.5%) |
| Agreement among the nine substantive verdicts | 5/9 (55.6%) |

| Reviewer | Luna Green | Luna Yellow with caveat | Luna Yellow for a gap | Luna Red |
| --- | ---: | ---: | ---: | ---: |
| Green (14) | 0 | 3 | 11 | 0 |
| Yellow (16) | 0 | 4 | 12 | 0 |
| Red (10) | 0 | 1 | 8 | 1 |

## What decided the reports

- **Omnissa, Yellow for an evidence gap.** Luna found the claim that an agent runs in an isolated workspace with the user's identity and permissions. It lacked a worked deployment or test showing the endpoint task, the identity used and the resulting permissions in practice. [Submitted product site](https://www.omnissa.com/)
- **QlikView, Yellow for a lifecycle caveat.** Qlik named successors for SaaS and on-premises deployments. The report identified a migration consideration for buyers. [QlikView product page](https://www.qlik.com/us/products/qlikview)
- **DoNotPay, Red.** Luna traced a restriction on advertised chatbot capabilities to the FTC's final order. It was the only reviewer Red recovered in this run. [FTC final order announcement](https://www.ftc.gov/news-events/news/press-releases/2025/02/ftc-finalizes-order-donotpay-prohibits-deceptive-ai-lawyer-claims-imposes-monetary-relief-requires)

The logs recorded 452 search queries. The dossiers retained 606 source observations across 39 products. For TF7, 14 pages were unavailable and two yielded no usable product passage. It received an evidence-gap Yellow. Of the 31 gap reports, 28 named a specific capability to verify. Three could not identify a testable task from the collected material.

## Individual results

| Row | Researched product or site | Reviewer | Luna | Basis |
| ---: | --- | --- | --- | --- |
| 1 | Omnissa | Green | Yellow | Evidence gap |
| 2 | Copilot Chat (Basic) | Yellow | Yellow | Evidence gap |
| 3 | Bending Spoons | Yellow | Yellow | Evidence gap |
| 4 | PimEyes | Red | Yellow | Material caveat |
| 5 | Rocket® Vertica® | Yellow | Yellow | Material caveat |
| 6 | Postfix | Green | Yellow | Evidence gap |
| 7 | HS Nettoeinkommen Pro 2026 | Red | Yellow | Evidence gap |
| 8 | Datto | Green | Yellow | Evidence gap |
| 9 | Autodesk Fusion | Yellow | Yellow | Evidence gap |
| 10 | AuditAlign | Red | Yellow | Evidence gap |
| 11 | knooing OS | Red | Yellow | Evidence gap |
| 12 | QlikView | Yellow | Yellow | Material caveat |
| 13 | COGPACK | Green | Yellow | Evidence gap |
| 14 | Snow Atlas | Yellow | Yellow | Evidence gap |
| 15 | Redmine | Green | Yellow | Evidence gap |
| 16 | R | Green | Yellow | Evidence gap |
| 17 | SAP LeanIX | Green | Yellow | Evidence gap |
| 18 | Microsoft 365 Copilot | Yellow | Yellow | Evidence gap |
| 19 | Planview Vantage | Green | Yellow | Evidence gap |
| 20 | AnyDesk | Red | Yellow | Evidence gap |
| 21 | PDF to Word Converter | Red | Yellow | Evidence gap |
| 22 | Tungsten Automation | Yellow | Yellow | Evidence gap |
| 23 | Gainsight | Green | Yellow | Material caveat |
| 24 | KeePass Password Safe | Green | Yellow | Evidence gap |
| 25 | Optimizely | Yellow | Yellow | Evidence gap |
| 26 | ManageEngine | Green | Yellow | Evidence gap |
| 27 | Microsoft Copilot | Yellow | Yellow | Material caveat |
| 28 | PDF Editor | Yellow | Yellow | Evidence gap |
| 29 | www.tf7.com | Yellow | Yellow | Evidence gap |
| 30 | Notepad++ | Yellow | Yellow | Evidence gap |
| 31 | Schneespur | Yellow | Yellow | Material caveat |
| 32 | DoNotPay | Red | Red | Material risk |
| 33 | OPSI | Green | Yellow | Material caveat |
| 34 | PBM Campaign Platform | Yellow | Yellow | Evidence gap |
| 35 | PrayerPlatform™ App | Red | Yellow | Evidence gap |
| 36 | accessiBe | Red | Yellow | Evidence gap |
| 37 | Prized | Green | Yellow | Material caveat |
| 38 | Professional Performance Engineering | Yellow | Yellow | Evidence gap |
| 39 | IrfanView | Green | Yellow | Evidence gap |
| 40 | Avast One | Red | Yellow | Evidence gap |

The downloadable comparison links each row to its complete Markdown report. The accompanying products CSV uses the original eight report columns. [Run and export instructions](README.md#tests)
