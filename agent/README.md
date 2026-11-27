# Vendor Verdict — Agents with Taste

An evidence-first procurement agent for Stackgini's hackathon challenge. Given a product URL, it returns **Green** (proceed with ordinary checks), **Yellow** (verify before buying), or **Red** (stop and escalate). This is a buying triage tool, not a security audit or a public vendor rating.

## Run

```bash
cd agent
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m playwright install chromium

python agent.py https://stackgini.de/ --evidence
python agent.py --input urls.txt --out verdicts.csv
python agent.py --input urls.txt --out verdicts.json --evidence
python agent.py --blind --input blind.txt --out verdicts.csv --audit-out verdicts.json
```

`urls.txt` contains one URL per line; blank lines and lines beginning with `#` are ignored. Add `--no-screenshot` for faster runs; sparse pages can still trigger browser fallback. Use `CHROME_CDP_URL=http://localhost:29229` instead of installing Chromium if you've already got a local Chrome DevTools endpoint. Screenshots and fetches are cached in `cache/` for 24 hours; `--cache-dir` selects another cache. `--workers` controls batch concurrency.

`--blind` defaults to `blind.txt` and `verdicts.csv`. Batch runs isolate each vendor with a 150-second deadline (`--timeout` to change it). Invalid URLs, failed workers, and timeouts produce low-confidence Yellow rows with an insufficient-evidence explanation. If collection had already checkpointed a source, an interrupted row retains a cited finding rather than losing all the work. `--audit-out` writes the same run's JSON (including per-vendor timings) without researching twice.

### Live submission

Run from `agent/` with `LLM_MODEL=openai/gpt-oss-120b` and the Nebius and Tavily keys in your environment or ignored local `.env`. Put the organizers' URLs in `live_urls.txt`.

```bash
python agent.py --blind --input live_urls.txt --out verdicts.csv --audit-out verdicts.json --workers 5 --no-screenshot
```

On Windows, `./run_live.ps1 -Urls live_urls.txt` runs the same pipeline and writes `live_out/verdicts.csv` and `live_out/verdicts.json`. Submit the pipeline CSV. `-DeepResearch` is an opt-in experiment, not the submission path; its files are named `deep_experiment.*` and never replace the pipeline files. Standalone `python deep_agent.py --help` describes the optional backends: an authenticated Claude Code CLI by default, or a separately installed `anthropic` Python package and key for `--backend api`.

To test a second judge with the same provider and key, add `--second-judge deepseek-ai/DeepSeek-V4.1-Flash-1017-fast` to the Python command or to `eval.py`. Both judges use the same collected evidence and verify their reasons. A decisive call wins against Yellow; opposing Green and Red calls produce Yellow. If the second model fails, the first verdict stands. The JSON records both calls and which verdict was used. This is off by default and adds model cost and latency, but does not repeat web research.

Keys are optional. Export them or put them in a local, ignored `.env` file:

| Variable | Purpose |
| --- | --- |
| `TAVILY_API_KEY` | Adds independent web search. Without it, coverage is mostly first-party pages and domain history. |
| `LLM_API_KEY` | Enables the model judge. Without it, the conservative deterministic judge runs. |
| `LLM_PROVIDER` | Optional explicit override: `openai`, `anthropic`, or `nebius`. Otherwise inferred from the key prefix. |
| `LLM_EFFORT` | Anthropic effort setting, default `low`; does not change Nebius requests. |
| `LLM_MODEL` | Defaults: `gpt-4o-mini`, `claude-haiku-4-5`, or `openai/gpt-oss-120b`, respectively. |
| `LLM_BASE_URL` | Optional provider endpoint override; Nebius defaults to `https://api.tokenfactory.nebius.com/v1`. |
| `LLM_VISION` | Set to `1` and select a vision-capable model to include the homepage screenshot in the model call. |

## What the agent checks

1. **Vendor pages** — starts with the exact product and homepage, then follows a small sample of relevant links. Extracts corporate and compliance statements, traction counts, logo alt text, lifecycle language, release dates, and linked-page errors. The browser captures a screenshot and fills in JS-heavy pages when needed.
2. **Domain history** — consults RDAP registration events and Wayback captures; dates belong to the domain/capture, not necessarily to the company. Looks for historical traction text in the available snapshot.
3. **External research** — nine parallel Tavily basic-search topics cover enforcement, incidents, ownership, exact product naming, lifecycle, customers, traction, jurisdictions, and procurement transitions. When a repository surfaces, GitHub provides metadata and the default branch's latest commit. One optional extra search samples named customer logos; a deployment is only corroborated when a fetched customer-owned page describes actual use. Partners, badges, and search snippets don't count; an inconclusive result isn't evidence the claim is false.
4. **Judge** — three model calls vote on the same numbered evidence. A two-vote majority supplies the starting verdict; a split vote defaults to Yellow for review. Documented blockers can override the vote; purchase cautions can appear in the Yellow column without changing an otherwise Green verdict. The agent maps evidence IDs to collector URLs, then checks each claim against excerpts from its cited URL in one additional model call. Unsupported claims are dropped; partially supported claims are narrowed to attributed quotes. JSON records the votes, verification decisions, supporting excerpts, and source dates when available. These are checks against collected excerpts, not a guarantee that a source is independent, that a page still opens, or that the wording appears verbatim in the original page rather than a search snippet or collector description.

Collectors share a bounded HTTP cache and pace requests by host. Website fetches respect robots rules and disallow direct private-network URLs; this CLI is not a sandbox, and should not be exposed as a service that browses arbitrary untrusted input. When robots policy restricts live access, the agent records that coverage limit, lowers confidence, and looks for the most recent Wayback capture of up to two affected URLs alongside its usual web search. A search and site collection with no substantive evidence cannot yield Green. Network errors, robots denials, missing archive coverage, and empty searches are not negative vendor findings. No agents contact vendors or run active security probes.

If the crawled product overview identifies hardware or a mixed hardware/software offering, the agent uses nine model-specific topics covering firmware/driver releases, lifetime support, advisories, recalls, conformity records, independent retail/distribution, naming, ownership, and region. JSON includes `product_type`; a non-product or unclassifiable page keeps the same output shape and adds a coverage note. CSV columns are unchanged.

The agent also reports incomplete contracting-entity coverage, placeholder social links, and adoption counts that differ substantially on the same page. These are leads to verify, not automatic Red verdicts. Documented former or parent names are added to existing risk queries without increasing the search count. A LinkedIn profile can suggest staffing to check; it does not validate adoption.

## Evaluate

```bash
python -m unittest discover -v
python eval.py --workers 8 --no-screenshot --out eval-results.json
```

Evaluation defaults to the labeled event CSV at the repository root; use `--labels` to override the path. The pipeline does not copy the CSV or reviewer notes into `agent/` or send them to the model. It passes only the URL for research, excludes any matching anonymized few-shot pattern, then prints accuracy, judge-mode coverage, a three-way confusion matrix, and per-row disagreements. Keep evaluation files within the event. The scoreboard is a development aid; the live challenge uses previously unseen products.

### API budget

On a cold cache the 40-row evaluation uses at most **400 Tavily credits** (nine base searches and up to one customer check per vendor at [one credit per basic search](https://docs.tavily.com/documentation/api-credits)), 5% of the team's 8,000-credit budget. You don't need to run it repeatedly: use one labeled baseline, one evaluation after meaningful changes, and a small unseen smoke test. An unchanged rerun within 24 hours reuses successful search responses. CLI and evaluation log estimated Tavily credits, cache hits and failed calls; the Tavily dashboard is authoritative for billing.

The default [Nebius gpt-oss-120b](https://nebius.com/models/openai/gpt-oss-120b) public endpoint lists $0.15 per million input tokens and $0.60 per million output tokens. A cold 40-row evaluation can make up to **160 model requests** (three votes plus one claim check per vendor). Identical model requests reuse the disk cache, while a model, rubric, or evidence change triggers fresh judging. See [RESULTS.md](RESULTS.md) for the measured run and cost; other models and vision pricing vary.

## What the examples teach

The sample includes **40** products: **14 Green** (35%), **16 Yellow** (40%), and **10 Red** (25%). Screenshots help explain what the buyer sees, but unattractive and well-maintained tools coexist with polished sites making misleading claims. Product/version identity matters: related products on the same vendor domain can have different licensing, support and risk.

Stackgini sells an AI operating system for IT demand management; its site presents named case studies with measurable outcomes. An agent worth demonstrating would distinguish those vendor-published claims from confirmation on the customer's own site or a partner marketplace.

Next high-value checks: compare traction counts across pages and archive dates; independently match a named customer's product and timeframe; verify certifying body, scope and expiry; resolve legal entities through an official register; and compare an incident's date and product scope against remediation status. For the live demo, show two contrasting cases: dated but actively shipped software, and a polished site whose most important claim is contradicted by an authoritative source.
