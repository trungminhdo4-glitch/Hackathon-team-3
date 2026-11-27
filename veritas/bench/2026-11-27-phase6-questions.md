# Phase 6 follow-up — one decision question, identical captured sources

## FACT

The targeted test improves factual extraction and question coverage, **not vendor-label accuracy**. It uses six deliberately varied, previously inspected development cases. It is neither a holdout nor a population accuracy estimate. No official blind inputs or new web research were used.

Preparation was frozen at 17:42:53 UTC / 18:42:53 CET, after the user's explicit follow-up request. Cases and questions were selected by identity, commercial conditions, maintenance, lifecycle, regulatory action and privacy. Each pair uses the **same captured document set**, same question and unchanged `phase6-evidence-judge-v1` rubric. Sources were drawn from existing Phase-5 caches, except commercial conditions, which use the already captured bounded native baseline. The control is its stored original extraction; the treatment is a fresh question-focused extraction. This is a selected-case extraction test, not an exact rerun of any historical whole-cohort agent.

Two fresh Terra extractors received only source text and factual questions. They returned no overall labels and preserved known material contrary evidence. Neither saw references or old verdicts. A source-content SHA-256 and rubric hash were frozen before extraction. Twelve verified paired packets were then assigned opaque IDs and ordered by a deterministic hash; condition mapping remained outside the production input directory. Fresh Luna and Terra judges saw identical packet bytes, without condition names, old verdicts or references. A separate Terra auditor saw the same captured source documents and packets, without either judge's predictions or reference labels. Only after predictions and the factual audit were saved did the evaluator load labels.

### Independent factual audit

| Metric | Original extraction | Focused extraction |
| --- | ---: | ---: |
| Packets whose factual propositions are supported | 4/6 | **6/6** |
| Main question completely answered | 0/6 | **3/6** |
| Main question partly answered | 5/6 | 3/6 |
| Main question unanswered | 1/6 | **0/6** |
| Primary problem: extraction loss | 4/6 | **1/6** |
| Primary problem: scope ambiguity | 1/6 | 2/6 |
| Primary problem: unsupported inference | 1/6 | **0/6** |

These counts are a separate model's assessments, not human gold labels. Problems are the auditor's primary classification, not an exhaustive or mutually exclusive causal inventory. The apparent increase in scope ambiguity reflects exposure of a previously missed lifecycle notice whose exact product/support scope remains unclear.

### Vendor verdicts, same frozen rubric

| Evidence / fresh judge | Correct | Accuracy | Macro F1 | Wrong→right / right→wrong |
| --- | ---: | ---: | ---: | ---: |
| Original / Luna | 4/6 | 66.7% | 0.656 | — |
| Focused / Luna | 3/6 | 50.0% | 0.433 | 0 / 1 |
| Original / Terra | 4/6 | 66.7% | 0.656 | — |
| Focused / Terra | 4/6 | 66.7% | 0.656 | 0 / 0 |

All arms cover all six inputs. Reference support is two Green, one Yellow and three Red. Green/Yellow/Red recalls are respectively 1/2, 1/1, 2/3 for both original arms and focused Terra; focused Luna is 1/2, 0/1, 2/3. No critical Red→Green or false Red occurs. Focused Luna introduces one Yellow→Green error. These small selected-case percentages must not be compared directly with the forty-case 21/40 score as an improvement.

### What the six cases establish

| Case / question | Original packet | Focused packet | Remaining limitation |
| --- | --- | --- | --- |
| Omnissa: exact product/edition | Partial, unverified adoption assertion | Supported cloud scope/exclusions; vulnerability and remediation preserved | Broad company URL does not uniquely identify a purchased edition. Both judges remain Yellow. |
| Copilot Chat: included versus additional costs | Partial; metered agents alone | Included features, added license features and Azure/metering requirements captured | **Judgment difference:** Luna treats disclosed costs as ordinary and chooses Green; Terra treats procurement conditions as material and chooses Yellow. The reference is Yellow. No new fact changes between the judges. |
| Postfix: dated maintenance | Partial, unsupported survey inference | Dated stable and legacy releases answer maintenance | Future support and an individual deployment's version remain unknown. Both judges choose Green in both arms. |
| HS Nettoeinkommen: announced development/support end | Unanswered despite notice in captured page | After-2026 development cessation recovered | Exact program-by-program coverage and support termination date remain unspecified. Both focused judges choose Yellow; reference is Red. |
| DoNotPay: allegation, final action and remedy | Partial terms of final order | Complaint/final-order distinction and complete remedy captured | Current compliance/performance not established. Both judges already choose Red in the original arm and retain it. |
| Avast: historical privacy conduct and remedy | Partial remedy and date | Fuller conduct and remedy retained | Historical free-product scope in an attributed staff reply was still blocked at the packet boundary; current conduct remains unknown. Both judges choose Red in both arms. |

The concrete diagnosis is therefore **extraction loss plus scope/materiality limitations**. Four original packets omit relevant information that the independent auditor finds in the same captured documents. Targeted extraction resolves three main questions. It does not make an ambiguous company URL or an unspecified support end date precise, and it does not settle whether an ordinary licensing condition should change the overall procurement color.

## IMPLEMENTED

`phase6-questions.mjs prepare|pack|score` creates the source/question registration, checks contiguous native passages, freezes and blinds packets, validates coverage and IDs, scores paired outcomes and joins the independent factual audit. It has no network calls or new dependencies. Condition mapping, reference scoring and auditor output remain separate from worker source inputs.

The experiment recovered twelve actual contiguous passages. The frozen packet adapter accepted eleven: a quoted FTC staff-reply thread contained literal `...` in the page's own “in reply to” text. The old adapter rejected any ellipsis even when the entire string occurred contiguously in the source. That rejection caused the remaining extraction-loss finding. This is a demonstrated validation loss, not evidence that the staff reply establishes present-day conduct or a court finding.

The native packet boundary now accepts an ellipsis **only through an exact contiguous match to available source text**. A new regression test checks literal source punctuation and still rejects stitched, noncontiguous quotations. The existing claim-verification engine's policy is unchanged. Frozen experiment packets and predictions were **not rewritten** after this fix; no post-fix model accuracy is claimed.

## TESTED

All twelve extracted passages were checked against the original frozen native text before packet construction. Scoring validates packet SHA-256, rubric identity, unique complete prediction coverage, valid citation indexes, canonical input ID/URL correspondence and independent audit coverage. Full required quality loop: **124/124 passed**, comprising **100 VERITAS + 24 application tests**. Frozen packet bytes are preserved by scoped Git attributes.

Zero new web calls. Five fresh worker calls: two extractors, two judges, one independent factual auditor. Judgment intervals: Terra 11 seconds, Luna 25 seconds; the separate factual audit recorded 28 seconds. These are worker-clock intervals, not end-to-end competition timing. Actual monetary cost is unavailable and remains null.

Artifacts: `test-results/phase6-questions-20261127/preregister.json`, `condition-map.json`, `packet-freeze.json`, `factual-audit.json`, `metrics.json`, and `production/{sources,original-extraction,extracted-a,extracted-b,judge-packets,judge-luna,judge-terra}.json`. Reproduce evaluation from the repository root with `node veritas/bench/phase6-questions.mjs score`. Do not rerun preparation over a frozen study. Original historical caches used to prepare the study remain local; the committed frozen source inputs and packets make this result inspectable without refetching.

## BLOCKED / decision

Do not promote the focused workflow as an accuracy winner. Preserve the existing competition candidate and conservative fallback. There is a defensible improvement to factual support and a tested native-passage validation fix, but no measured label gain. The next development priorities are to resolve exact product/support scope through one focused source task where it is genuinely absent, and to clarify a general procurement rule for ordinary versus material commercial restrictions. Such a rule must be fixed before judging another untouched set, without vendor-specific answers or tuning to these six reference colors.

The factual audit does not independently certify overall procurement materiality. No additional genuinely fresh panel was run. The prior workspace-wide board and OpenCode routing remain RED as previously documented; this task changed no unrelated modules. No merge, rebase, push, deletion, key-file access or official blind research occurred.
