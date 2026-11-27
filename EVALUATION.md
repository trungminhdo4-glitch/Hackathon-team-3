# SaaSLens evaluation criteria

**Does the available evidence show that this software delivers its main promise to its intended users, on the terms advertised?** The verdict describes what a prospective user can reasonably rely on and which limitations could change their decision.

SaaSLens uses this rubric for new investigations. It is based on the [40 labeled sample reviews](hackathon_40_solutions_commented%20%281%29.csv). Earlier reports retain their original verdict in session history.

## What to evaluate

Identify the product, edition, intended audience, and the main claim in plain language. The URL helps locate the right product and earns no points. If several editions remain plausible, say which one the evidence covers.

| Criterion | Question the report must answer | Evidence to look for |
| --- | --- | --- |
| Core capability | Can someone accomplish the task the vendor promises, under the advertised conditions? | A documented workflow, independent test, customer deployment, or reproducible comparison. A feature list establishes the promise. A speed or accuracy claim needs evidence measuring that outcome. |
| Customer experience | What happened when people used this edition for that task? Are results consistent across independent accounts? | Attributed firsthand reviews, customer-written guides, and support reports. Quote the experience, identify the source and edition, disclose vendor selection or sponsorship, and distinguish one account from a recurring pattern. |
| Licensing and access | What does the buyer actually receive at the stated price and tier? | Current terms and plan comparisons covering account type, included features, paid extras, commercial-use rights, and data access. Explain the practical difference. |
| Maintenance and support | Can the intended user adopt and keep using it over the relevant period? | Dated releases, supported platforms, end-of-life notices, support commitments, and migration paths. Check whether ownership or maintainer changes have a documented consequence. |
| Security, privacy, and compliance | Can users rely on the protections that matter for this use? | Applicable audit scope, regulator findings, incident reports, remediation, and dates. Distinguish an allegation, a finding, a historical issue, and an unresolved risk. |
| Credibility of the vendor's claims | Are material claims about customers, partnerships, certifications, and the responsible operator accurate? | Customer or partner confirmation, registers, and certification records. Verify what a logo or customer count represents and whether it applies to this product. |

## How to decide

For each material claim, record **supported**, **partly supported**, **contradicted**, or **unverified**. Give a short explanation with the claim, the source passage and link, what it establishes, and the consequence for the user. When testimony affects the verdict, show the account beside that finding and describe how much it supports. When sources disagree, explain differences in date, edition, or audience where possible.

| Outcome | Decision rule |
| --- | --- |
| Green | Credible evidence supports the core promise for the intended use. Remaining caveats are unlikely to change that user's decision. |
| Yellow | Name the material condition or conflict, who it affects, and what would resolve it. When sources cannot establish the core claim, invite human guidance. If the user finishes or a guided search still leaves the question unresolved, explain the evidence gap and identify the missing proof. |
| Red | Reliable evidence contradicts a core promise or establishes a serious risk that makes the product unsuitable for the stated use. Identify the decisive evidence and its scope. |

An investigation that fails before obtaining usable material yields a retryable failure. The historical calibration below recorded abstentions as “Insufficient evidence.” New final reports record these as Yellow with `verdictBasis: "evidence_gap"`. Compare evidence coverage as well as color when reading later calibration runs.

Judge materiality in context. A commercial-use license can be routine for an image viewer and decisive for a buyer who needs free workplace use. A privacy violation can directly defeat the promise of a privacy product. Several small positives cannot cancel such a contradiction. Use no fixed point weights or numeric quality score in this rubric.

## Calibration against the sample

- **Microsoft 365 Copilot Chat, row 2, Yellow.** The reviewer identifies a consequential ambiguity between the included business chat and the paid add-on. A useful report names the edition, compares the entitlements, and explains which distinction matters to the buyer. The Microsoft domain settles none of those questions.
- **Postfix, row 6, Green.** The reviewer gives more weight to releases and deployment history than to the appearance of the website. A report should surface the maintenance evidence and the single-maintainer caveat separately.
- **accessiBe accessWidget, row 36, Red.** The reviewer points to a regulatory finding about the central compliance promise and paid reviews. A new report must retrieve the underlying record, verify its scope and date, and explain its relevance before reaching that conclusion.

These examples describe reviewer judgments. The dataset is a calibration benchmark. Generate a fresh report without giving the researcher the expected label. Compare the predicted verdict, the decisive reason, and whether the citations support it. Record when changed facts, unavailable text, or visual-only evidence explain a difference. Report evidence coverage separately from product quality.

The [ten-case GPT-6.2 Astra evaluation](EVALUATION_BATCH.md) records the first ten rows in file order, the actual verdict and reasons for each, including disagreements.

### Small MVP check, 27 November 2026

The API received only the original URL for each of these three development examples. The optional question was blank. The most recent live search for each product produced the following results.

| Dataset row | Reviewer | Live verdict | What decided the report |
| --- | --- | --- | --- |
| 2 · Microsoft 365 Copilot Chat | Yellow | Insufficient evidence | The report verified eligibility for the included chat and found information on data protection. It did not validate the paid-tier comparison as a decisive licensing finding. [Microsoft product page](https://www.microsoft.com/en-us/copilot/features/chat) |
| 6 · Postfix | Green | Green | A published benchmark exercised receiving and delivering mail. The report also found release and maintenance evidence. [Postfix](https://www.postfix.org/) · [Benchmark](https://github.com/stalwartlabs/benchmarks) |
| 32 · DoNotPay | Red | Red | The FTC’s final order restricted deceptive claims about what the chatbot could do. This directly concerns the advertised legal capability. [FTC case record](https://www.ftc.gov/legal-library/browse/cases-proceedings/donotpay) |

Replaying a separate collection of live passages through the same verdict rules matched all three reviewer labels. The Copilot collection included an explicit comparison between the base entitlement and the additional license. A fresh search can return a different set of readable sources. These three examples were used during development. [Microsoft licensing FAQ](https://www.microsoft.com/licensing/faqs/2)
