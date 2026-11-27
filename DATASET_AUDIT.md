# What the 40 reviewers' labels measure

The dataset asks whether a buyer can reasonably shortlist this software and what could change that decision. The original Luna run often answered a narrower question about proving a feature worked. For COGPACK, Luna found a registered study that **used** the software, then looked for evidence that patients improved. Use in a study bears on adoption. Demonstrating clinical efficacy would be a separate evaluation.

This audit compares the flag columns, original notes and final reasoning in all 40 reference rows with the findings and verdict explanations from the saved URL-only Luna run. The reference column below summarizes the reviewer's judgment. It is not independent verification of a vendor, allegation, dated event or legal outcome. Some reference decisions incorporate visual inspection, personal familiarity or a particular buyer's tolerance for risk. [Source dataset](hackathon_40_solutions_commented%20%281%29.csv) · [Original Luna evaluation and reproduction instructions](EVALUATION_LUNA.md)

## Accuracy of the original run

| Reference | Predicted Green | Yellow, cited caveat | Yellow, evidence gap | Predicted Red | Correct / total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Green | 0 | 3 | 11 | 0 | 0/14 |
| Yellow | 0 | 4 | 12 | 0 | 16/16 |
| Red | 0 | 1 | 8 | 1 | 1/10 |

Exact color agreement was **17/40 (42.5%)**. Always choosing Yellow scores **16/40 (40%)**. Uniform guessing over three colors has expected accuracy **33.3%**. The more revealing comparison is recall per color: 0% Green, 100% Yellow and 10% Red. Their mean, **36.7% balanced accuracy**, gives the three reference colors equal weight.

Only **5/40 (12.5%)** matched with a substantive verdict. Even this counts agreement on color, not on rationale. Of these five, QlikView and DoNotPay identified a decisive reference issue. Vertica and Schneespur reached Yellow for different reasons. Consumer Copilot dealt with licensing but focused on family sharing instead of the consumer/business distinction. The other 12 matches were evidence-gap Yellow.

## Questions that distinguish the colors

| Question for research | Evidence that helps decide |
| --- | --- |
| What is the current offer, edition and operator behind this URL? | Compare the product page with current licensing, successor notices, acquisition announcements and dated records. A company homepage can represent several products. Identify which one the evidence covers. |
| Is there credible evidence of ongoing use and support? | Check dated releases, supported versions, named maintainers, independent deployments, workshops and product-specific community or partner documentation. Distinguish adoption from proof of every marketing outcome. |
| Can a buyer actually obtain and rely on it under the stated conditions? | Check sales availability, supported platforms, access requirements, prices or entitlement boundaries and discontinuation dates. Explain which ordinary buyer the limitation affects. |
| Who stands behind the trust signals? | Trace a claimed customer, investor, certification or award to the named party. Distinguish partners from purchasers, and a parent group's credentials from those of the submitted product. |
| What material risk survives scrutiny today? | Look for the original regulator decision, incident notice, remediation or independent investigation. Record entity, product, date, legal status and current scope. A proposed order is a lead to the final record. |

**Green** in these examples allows residual concerns when credible adoption, stewardship and availability support shortlisting. **Yellow** generally means the product is plausible but a concrete issue changes diligence, terms or use. **Red** can reflect either a documented disqualifier or the reviewer's decision that the available trust signals are incompatible with the intended purchase. Missing pages alone establish neither wrongdoing nor a disqualifier. A report should distinguish a buyer declining to shortlist from an accusation that a claim was fabricated.

## Comparison by row

“Gap” below is a finalized Yellow for inconclusive evidence. The last column focuses on the decision-driving issue, even when other details appeared elsewhere in the report.

| Row and subject | Reviewer | Luna | What determined the difference or agreement |
| --- | --- | --- | --- |
| 1 · Omnissa | Green | Yellow, gap | Reviewer weighed Workspace ONE/Horizon adoption and ownership changes. Luna sought a demonstration of endpoint isolation for AI agents, a different offer on the corporate site. |
| 2 · Microsoft 365 Copilot Chat | Yellow | Yellow, gap | Both identified the included business chat. Reviewer wanted the boundary with the paid license and work-data access. Luna wanted a worked example of web-grounded chat. |
| 3 · Bending Spoons | Yellow | Yellow, gap | Reviewer weighed customer-facing pricing, staffing and roadmap after acquisitions. Luna sought a testable end-user task on a holding company's site. |
| 4 · PimEyes | Red | Yellow, caveat | Reviewer cited biometric-data regulation and operator history. Luna identified search coverage limits. The recorded page list included a failed London authority read and no Hamburg regulator page. |
| 5 · Vertica | Yellow | Yellow, caveat | Reviewer cited changes of ownership and support continuity. Luna questioned a vendor-sponsored speed benchmark. Same color, different buying issue. |
| 6 · Postfix | Green | Yellow, gap | Reviewer prioritized widespread use, releases and maintainership. Luna supported active maintenance but treated a description of its origins as an outcome requiring a deployment test. |
| 7 · HS Nettoeinkommen Pro | Red | Yellow, gap | Reviewer considered end-of-development and platform/install constraints decisive. Luna retained the publisher's notice that development stops after 2026 but asked for proof of payroll calculations. |
| 8 · Datto | Green | Yellow, gap | Reviewer resolved Datto, its parent and its MSP audience. Luna found RMM release evidence but sought a test of a specific cloud recovery workflow. |
| 9 · Autodesk Fusion | Yellow | Yellow, gap | Reviewer wanted current SKU, bundles and token economics. Luna found the noncommercial personal-use restriction but withheld judgment on an all-in-one feature claim. |
| 10 · AuditAlign | Red | Yellow, gap | Reviewer questioned governance artifacts and enterprise references relative to a regulated use. Luna identified the paid pilot and sought proof of framework mapping. |
| 11 · knooing | Red | Yellow, gap | Reviewer questioned which logos were customers after a move from EAM to ITSM. Luna sought demonstrations of the advertised feature suite. |
| 12 · QlikView | Yellow | Yellow, caveat | Both identified a legacy product. Luna named Qlik Cloud Analytics and Qlik Sense as the successors and explained the purchase implication. |
| 13 · COGPACK | Green | Yellow, gap | Reviewer treated workshops and editions as evidence of real use. Luna found use in a registered study but wanted evidence of improvement in participants. |
| 14 · Snow Atlas | Yellow | Yellow, gap | Reviewer wanted the roadmap after Flexera's acquisition and the relationship to Flexera One. Luna sought proof of promised savings for smaller teams. |
| 15 · Redmine | Green | Yellow, gap | Reviewer weighed releases and multiple maintainers. Luna documented licensing, releases and support windows but required further evidence for self-hosted project management. |
| 16 · R | Green | Yellow, gap | Reviewer emphasized an active team, governance and adoption. Luna verified a documented sequence operation and found NHS-R guidance but sought a broader test of statistical workflows. |
| 17 · SAP LeanIX | Green | Yellow, gap | Reviewer treated the JS documentation barrier as a retrieval problem for an established tool. Luna could not establish a broad AI transformation claim. |
| 18 · Microsoft 365 Copilot | Yellow | Yellow, gap | Reviewer flagged naming, license and bundle confusion. Luna verified extra paid capabilities but tied the verdict to a missing demonstration of creating finished work. |
| 19 · Planview Vantage | Green | Yellow, gap | Reviewer accepted the vendor while flagging acquisition aliases and a hard-to-find offer. Luna evaluated a demo-page heading as a capability claim. |
| 20 · AnyDesk | Red | Yellow, gap | Reviewer relied on a dated geographic-operations tracker and explicitly requested current confirmation. Luna documented an incident and reported remediation. Its verdict did not resolve the tracker question. |
| 21 · Tipard PDF to Word | Red | Yellow, gap | Reviewer found the enterprise counterparty and traction claims insufficiently substantiated. Luna focused on OCR performance and a vendor-hosted testimonial. |
| 22 · Tungsten Automation | Yellow | Yellow, gap | Reviewer focused on mapping older Kofax and Nuance names and understanding acquired capabilities. Luna evaluated a general automation slogan. |
| 23 · Gainsight | Green | Yellow, caveat | Reviewer credited disclosure, forensics and remediation after an incident. Luna made the Renewal Prediction add-on decisive without a user requirement for it. |
| 24 · KeePass | Green | Yellow, gap | Reviewer balanced sustained releases, audits and the community against maintainer concentration. Luna identified the open-source password manager but could not certify its broad security promise. |
| 25 · Optimizely | Yellow | Yellow, gap | Reviewer flagged a recent incident, disclosure and remediation questions. Luna found a vendor-hosted customer account but wanted evidence that its outcomes were typical. |
| 26 · ManageEngine | Green | Yellow, gap | Reviewer accepted the operator and warned about SKU confusion. Luna found a named ServiceDesk Plus rollout but sought proof across the portfolio. |
| 27 · Microsoft Copilot, consumer | Yellow | Yellow, caveat | Reviewer wanted consumer versus work accounts, licensing and data protections. Luna's decisive entitlement concerned whether family members shared the subscription owner's AI features. |
| 28 · CAD-KAS PDF Editor | Yellow | Yellow, gap | Reviewer questioned support capacity and continuity. Luna wanted a demonstration of PDF editing. |
| 29 · TF7 | Yellow | Yellow, gap | Reviewer saw contact details but wanted proof of current development and support. Luna had 14 unavailable pages and two without a usable passage. No testable product task was established. |
| 30 · Notepad++ | Yellow | Yellow, gap | Reviewer weighed maintainer concentration and a supply-chain compromise. Luna actually documented the compromise and remediation but finalized on a gap about ordinary editing. |
| 31 · Schneespur | Yellow | Yellow, caveat | Reviewer questioned long-term support capacity for a legal-recordkeeping use. Luna found a specific upgrade failure with recovery instructions. Both are buyer concerns, but they are different findings. |
| 32 · DoNotPay | Red | Red | Both identified the binding FTC restriction concerning advertised chatbot capabilities. The reviewer additionally questioned traction counters. |
| 33 · opsi | Green | Yellow, caveat | Reviewer linked the open-source project with the commercial support company and paid offering. Luna downgraded for a macOS installation limit without a stated macOS requirement. |
| 34 · PBM Campaign Platform | Yellow | Yellow, gap | Reviewer wanted launch status, customer scope and security assurance for regulated deployments. Luna sought a working example of a multichannel customer journey. |
| 35 · Prayer Platform | Red | Yellow, gap | Reviewer questioned the attribution of investor/customer logos and operator identity. Luna found app-store material but sought evidence of a prayer-wall workflow. |
| 36 · accessiBe | Red | Yellow, gap | Reviewer cited a final regulatory order. Luna retained FTC complaint and proposed-order passages, then focused on platform capabilities and plan-dependent legal support. The recorded proposal does not establish final disposition. |
| 37 · Prized | Green | Yellow, caveat | Reviewer recognized a pivot and accepted the current developer offering. Luna made a disclosed free-credit idle timeout decisive. |
| 38 · OpenText Professional Performance Engineering | Yellow | Yellow, gap | Reviewer wanted the LoadRunner ownership and naming chain for inventory and support. Luna recognized the alias but sought a test of scalable load testing. |
| 39 · IrfanView | Green | Yellow, gap | Reviewer accepted the long release track record despite a dated site and single maintainer. Luna found release and licensing information but attached the gap to the changelog preamble. |
| 40 · Avast | Red | Yellow, gap | Reviewer cited regulatory findings about selling browsing data despite privacy promises. Luna retained an FTC complaint and proposed-order announcement but assessed antivirus protection and firewall entitlements. |

Re-evaluating these same 40 rows after changing the rubric measures calibration on known examples. A score on previously unseen reviews is needed to estimate performance on new products.
