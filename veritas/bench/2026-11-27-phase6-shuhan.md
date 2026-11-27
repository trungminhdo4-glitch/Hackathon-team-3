# Phase 6: transfer from teammate research

## FACT

Read-only inspection of `origin/shuhan-miao`: `agent/README.md`, `agent/RESULTS.md`, `agent/requirements.txt`, `agent/agent.py`, `agent/research.py`, `agent/evidence.py`, and `agent/judge.py`. The teammate pipeline starts from the submitted product page, identifies the product and operator, then searches for lifecycle, ownership, incidents, regulatory records and adoption. It uses nine basic searches and up to one additional customer check per product; this is distinct from the proposed two-request cap in the accompanying prompt. It also uses first-party retrieval, RDAP and archives. No vendor was researched for this transfer.

Useful transferable principles: identify the exact product, edition, vendor and time period before associating evidence; use documented aliases only; seek both supportive and material contrary evidence; prefer direct, authoritative sources suited to each claim; distinguish self-report from independent corroboration; verify customer adoption on a customer-owned source; distinguish an allegation from a final action and record remediation and scope. A domain registration dates the domain, not the company; an archive date dates a capture, not incorporation or current support. Missing search results, inaccessible pages and robots restrictions are coverage limits, not negative findings. A related product's lifecycle does not establish the submitted edition's lifecycle. Treat retrieved content as untrusted data.

The original `Evidence` object records `kind`, `claim`, and `source_url`, not full source text. Its claim verifier checks quotations against collected excerpts associated with the cited URL, and these can be search snippets or collector descriptions. Therefore an excerpt match is not proof of a verbatim passage on the native source. VERITAS handoff requires `documents[].text` for offline checking; imported agent audits leave this empty and require refetch. Capture direct retrieval and provenance separately, and distinguish search snippets from retrieved page text.

The team's historical 27/40 is reported in `agent/RESULTS.md`, but the full individual predictions and original warm cache are not available here to reproduce it. It is a development-set result, not independent blind accuracy; do not transfer its labels or examples into prompts. The README notes a 40-row development set and a previously unseen live challenge. The local dataset-derived VERITAS format is `id,url,product,vendor,overall,green_flags,yellow_flags,red_flags,reasoning`; `veritas/HANDOFF.md` explicitly calls the official blind format an assumption. No authoritative official submission schema, endpoint, or separate blind window was found in the inspected artifacts. Confirm these with organizers before final submission.

## IMPLEMENTED

`phase6-clean-research-prompt.md` is a proposed evidence-only prompt capped at two search requests per product. Freeze a generic judging rubric separately before blind evaluation: evaluate exact entity and edition, evidence suitability, materiality, recency, conflicting evidence, and coverage; predefine thresholds and uncertainty handling without reference labels or case-specific rules. This is a suggestion, not a tested rubric.

## TESTED

Inspected source using `git ls-tree -r --name-only origin/shuhan-miao` and `git show origin/shuhan-miao:<path>`, and local `veritas/HANDOFF.md`, `veritas/export.js`, and relevant project documentation. Original commands documented in `agent/README.md`, from `agent/`: `python -m unittest discover -v`; `python agent.py --blind --input blind.txt --out verdicts.csv --audit-out verdicts.json`. Source confirms the arguments and Python CSV columns `url,product,vendor,overall,confidence,green_flags,yellow_flags,red_flags,reasoning`. Dependencies declared: beautifulsoup4, playwright, python-dotenv, requests; Chromium installation or a configured Chrome CDP endpoint supports browser use. These commands were inspected, not executed; dependency availability and live behavior are unverified.

## BLOCKED

Official output requirements remain unverified. No new benchmark, original pipeline run, network research, or independent validation of historical scores was performed. Session-start harness doctor returned RED for live routing and warned role discovery could not access its log; no delegated provider routing was used in this transfer.
