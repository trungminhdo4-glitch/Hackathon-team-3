# Avast consumer security (Free Antivirus / Avast One), German site avast.com/de-de

**Vendor:** Avast (brand of Gen Digital Inc.; operating entity Avast Software s.r.o., Prague)  
**URL:** https://www.avast.com/de-de/index  
**Verdict:** RED (confidence HIGH)  
**Mode:** fast; preliminary verdict RED

Avast is a real, financially backed and technically well-rated antivirus, owned by Gen Digital. Two final regulator decisions in 2024, from the FTC and the Czech DPA, found it sold or transferred re-identifiable browsing data of users via Jumpshot while telling users the data was anonymous. For a privacy and security vendor this contradicts its core promise. Under the rubric it stays RED despite the settlement, the payment and the passage of time. Continuing Dutch and UK claims add to the concern. Technical quality and finances are strong, and the data practice was stopped in 2020.

## Red flags
- The FTC final order (June 2024) found Avast and Jumpshot sold re-identifiable browsing data. It required a $16.5M payment and banned selling browsing data for advertising [E1].
- The Czech DPA's final GDPR decision (April 2024) fined Avast CZK 351M for transferring non-anonymised browsing data of about 100M users to Jumpshot [E2].

## Yellow flags
- Dutch and UK civil claims over browsing data are ongoing [E4].
- Overlapping SKUs and the Avast One repackaging make licensing unclear [E11].
- Recurrent local privilege-escalation CVEs [E8].
- Gen Digital's multi-brand portfolio makes consolidation possible [E6].

## Green flags
- Parent Gen Digital is profitable, with about $5B FY26 revenue [E5].
- Recent AV-TEST certifications and awards [E7].
- Patched CVEs and no breach found [E8].
- Included in Stiftung Warentest tests [E10].

## Reasoning
Two independent final regulator findings establish the vendor's own misconduct: monetising user browsing data, with deceptive anonymity claims, in a privacy and security product. The rubric says such findings stay RED after settlement. The mitigating facts are the cessation of Jumpshot in 2020, the compliance order, the strong parent and the good detection results. Those do not remove the trust problem. Confidence is MEDIUM because the vendor site could not be fetched and the details come from search summaries.

Adversarial review: The vendor's own misconduct is established by two final regulator decisions: the FTC order and the Czech DPA's binding GDPR fine. It consists of selling users' re-identifiable browsing data while claiming it was anonymous. That directly contradicts the central promise of a privacy and security product, and it is relevant to a German and EU buyer. Under the weighing rules it stays RED even though the vendor paid and changed its practices. The positives are real but do not offset it. These are Gen Digital's financial strength, independent test results and a normal CVE patching cadence. The ongoing Dutch and UK claims and the SKU ambiguity add to the concern. Confidence is HIGH because the regulator findings are final, are confirmed and apply to this exact vendor.

## Identity
- Product: Avast consumer security (Free Antivirus / Avast One), German site avast.com/de-de
- Vendor: Avast (brand of Gen Digital Inc.; operating entity Avast Software s.r.o., Prague)
- Legal name: Avast Software s.r.o. (Czech); parent Gen Digital Inc.
- Parent: Gen Digital Inc. (Nasdaq: GEN)
- Previous names: Avast plc, Alwil Software
- Country: Czech Republic / USA
- Category: Consumer and SMB antivirus and security, privacy
- Status: Active. Avast One was relaunched in May 2026 as a free app with paid add-ons, and Avast Pro Antivirus was reportedly folded into it.

- Ambiguity: The submitted URL is the consumer German page. The snapshot fetch failed with a proxy 403, so no vendor page content was read. Avast Business is a separate product. Free Antivirus, Avast One and Premium are overlapping SKUs.

## Marketing claims
| Claim | Status | Evidence |
|---|---|---|
| Avast is a major, legitimate security vendor owned by Gen Digital | VERIFIED | E5, E6 |
| Avast previously told users that data passed to Jumpshot was anonymous | CONTRADICTED | E1, E2 |
| Avast products have strong detection results | VERIFIED | E7 |

## Research coverage
| Criterion | Status | Valid evidence | Summary |
|---|---|---|---|
| company_legitimacy | INVESTIGATED | 0 | Well-known vendor, part of Nasdaq-listed Gen Digital, Czech roots. |
| marketing_claims | INVESTIGATED | 0 | Regulators found past anonymity claims about user data to be untrue. Detection claims are supported by AV-TEST. The vendor site could not be fetched. |
| security_privacy | INVESTIGATED | 1 | A history of data sale is confirmed. Routine CVEs are patched. No breach was found. |
| legal_regulatory | INVESTIGATED | 4 | A final FTC order and a final Czech DPA fine are confirmed. Civil claims are ongoing in the Netherlands and the UK. |
| product_lifecycle | INVESTIGATED | 1 | The product is active. Packaging is being consolidated into Avast One. No EOL notice was found. |
| customer_verification | INVESTIGATED | 1 | Mass-market consumer product. Independent tests are available (AV-TEST, Stiftung Warentest). Specific customer logos were not checked. |
| ownership_acquisitions | INVESTIGATED | 1 | Owned by Gen Digital since the 2022 merger. A multi-brand portfolio. |
| team_continuity | INVESTIGATED | 1 | Founder-era leadership has left operational roles. Professional corporate management is in place. |
| product_existence | INVESTIGATED | 1 | Real, continuously updated and certified. |
| documentation_support | INSUFFICIENT_EVIDENCE | 0 | The community and support portals exist. The vendor site was not fetchable and support quality was not assessed. |
| financial_viability | INVESTIGATED | 1 | The parent is very strong financially. |
| enterprise_readiness | INVESTIGATED | 0 | The submitted page is the consumer site. The separate Avast Business line has AV-TEST business certifications. SOC 2 and ISO certifications were not verified. |

Coverage: 11/12 criteria. Observed searches: 10.

## Autonomous follow-ups
- Final FTC order and Czech DPA fine → Searched for appeals, follow-on litigation and the current status → The Czech fine is final and binding. The FTC order is final. Dutch and UK civil claims are open, and the US suit was dismissed.
- 2026 CVEs → Checked severity and fixes → Local privilege escalation issues, fixed in 26.3 and 26.7. No exploitation reported.

## Contradictions
- Avast told users that the Jumpshot data was anonymous, but the Czech DPA and FTC found it was not anonymised and was re-identifiable [E1, E2].
- The orchestrator snapshot failed with a proxy 403, so no vendor-page claims could be checked.

## Unresolved questions
- Do current Avast privacy terms and telemetry settings comply with the FTC order and GDPR?
- What are the outcomes of the Dutch and UK claims?
- Are SOC 2 or ISO 27001 certifications available for Avast Business?
- What are the exact licensing terms of Avast One tiers versus Business products?

## Limitations
- The vendor site was not fetchable (proxy 403), so marketing claims were not verified from the vendor page.
- Some evidence comes from search summaries rather than fetched pages.
- The AV-TEST and Stiftung Warentest detailed scores were not read.
- Some CVE dates in the search results were inconsistent.
- Direct HTTP fetch of the product site failed (ProxyError: 403 Forbidden (agent proxy: no rule or network setting allows this host)).

## Adversarial review
Final verdict from review: RED (changed: False, model: sonnet)

- Checked that the evidence concerns this exact vendor and product. The FTC order and the Czech DPA fine name Avast Software s.r.o. and the Avast antivirus and browser-extension products. The product under review is the same consumer Avast line, so this is not a sibling or similarly named product.
- Checked whether the findings were overturned or dismissed. The FTC order was finalized in June 2024 and the Czech DPA decision is final and binding. Only the US wiretap class suit was dismissed on appeal (E3). That does not undo the regulator findings.
- Checked whether this is an incident done TO the vendor. It is not. It is the vendor's own misconduct: selling re-identifiable browsing data while telling users it was anonymous. That contradicts the core promise of a privacy and security product.
- Checked whether remediation or the passage of time justifies downgrading to YELLOW. Under the weighing rules, a final regulator order or fine establishing own misconduct against the core promise stays RED after settlement or remediation. Strong parent finances, AV-TEST results and a patched-CVE cadence do not outweigh it.
- No searches were used. The evidence summary already settles the verdict, and further searching could not change it.

## Evidence
| ID | Validation | Type | Indep. | Source | Excerpt |
|---|---|---|---|---|---|
| E1 | VERIFIED_QUOTE | regulator | yes | [FTC](https://www.ftc.gov/news-events/news/press-releases/2024/06/ftc-finalizes-order-avast-banning-it-selling-or-licensing-web-browsing-data-advertising-requiring-it) 2024-06-26 | ftc finalizes order avast banning it selling or licensing web browsing data advertising requiring it |
| E2 | SEARCH_OBSERVED | regulator | yes | [UOOU (Czech Office for Personal Data Pro](https://uoou.gov.cz/en/news/business-communication/czech-dpa-imposed-fine-of-351-million-czk-for-gdpr-infringement) 2024-04-15 | Czech DPA imposed fine of 351 million CZK for GDPR infringement |
| E3 | VERIFIED_QUOTE | journalism | yes | [Law360](https://law360.com/articles/2404328) 2025-10-27 | 9th Circ. Won't Revive Avast Extension Users' Wiretap Suit |
| E4 | VERIFIED_QUOTE | journalism | yes | [NL Times](https://nltimes.nl/node/67202)  | Over 10,000 plan to sue Avast over data selling claims |
| E5 | VERIFIED_QUOTE | vendor_official | no | [Gen Digital](https://newsroom.gendigital.com/2026-05-07-Gen-Crosses-5B-in-FY26-Revenue-with-Growth-Accelerating-to-Double-Digits) 2026-05-07 | Gen Crosses $5B in FY26 Revenue with Growth Accelerating to Double-Digits |
| E6 | SEARCH_OBSERVED | journalism | yes | [The Paypers](https://thepaypers.com/digital-identity-security-online-fraud/nortonlifelock-avast-merge-into-gen-digital--1259072) 2022-11 | NortonLifeLock and Avast merge into Gen Digital |
| E7 | SEARCH_OBSERVED | independent_audit | yes | [AV-TEST](https://av-test.org/en/news/av-test-awards-2025-for-avast/) 2026-03-12 | AV-TEST Awards 2025 for Avast |
| E8 | VERIFIED_QUOTE | security_research | yes | [Zero Day Initiative](https://www.zerodayinitiative.com/advisories/ZDI-26-271/) 2026 | Advisory Details |
| E9 | SEARCH_OBSERVED | journalism | yes | [Forbes CZ](https://forbes.cz/mise-splnena-ondrej-vlcek-odstoupil-z-funkce-prezidenta-gen-digital/) 2024-05 | Mise splněna: Ondřej Vlček odstoupil z funkce prezidenta Gen Digital |
| E10 | SEARCH_OBSERVED | independent_audit | yes | [Stiftung Warentest](https://www.test.de/antivirenprogramme) 2026-02 | Antivirenprogramme im Test |
| E11 | VERIFIED_QUOTE | vendor_official | no | [Avast Community](https://community.avast.com/t/importan-notice-unsupported-operating-systems/908468)  | Importan Notice - Unsupported Operating Systems |

## Execution metrics
- Duration: 72.4s, Claude calls: 2, turns: 14
- Searches: 10, fetches: 0
- Tokens in/out: 151465/19623, cache read: 37443, cache write: 26454
- API-equivalent list price estimate (not your subscription bill): 0.3334 USD
- Models: claude-sonnet-5-5, claude-haiku-5-5
- Errors: none
