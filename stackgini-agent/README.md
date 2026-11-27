# Stackgini procurement research agent

Give it the URL of an unfamiliar software product. It investigates the product and vendor on the open web and returns a GREEN, YELLOW or RED procurement verdict with flags, reasoning, validated evidence, unresolved questions and limitations.

It runs on your logged-in Claude Code subscription through `claude -p`. No API keys. No paid search or scraping APIs.

## Setup

Python 3.11+ and an authenticated Claude Code CLI (`claude auth status` shows `loggedIn: true`).

```bash
cd stackgini-agent
```

```bash
pip install -r requirements.txt
```

```bash
python main.py doctor --live
```

`doctor` checks the CLI, version, auth method, a stray `ANTHROPIC_API_KEY`, Python packages, the dataset and Playwright. `--live` adds one small Haiku call that confirms WebSearch and WebFetch actually work on your machine.

## Commands

Investigate one product:

```bash
python main.py investigate --url https://keepass.info --mode fast
```

Deep mode with an explicit model:

```bash
python main.py investigate --url https://example.com --mode deep --model sonnet
```

Batch (CSV with `id,url` columns, or a `.txt` with one URL per line). Writes `submission.json` plus a matching `submission.csv`:

```bash
python main.py batch --input products.csv --output submission.json --concurrency 2 --deadline-minutes 40
```

Evaluate on a stratified sample of the dev split (more than 5 products needs `--yes`):

```bash
python main.py evaluate --dataset "../hackathon_40_solutions_commented (1).csv" --limit 3
```

```bash
python main.py evaluate --ids 4,6,30
```

Resume a batch stopped by a subscription limit or a deadline:

```bash
python main.py resume --run-id RUN_ID
```

Show the leakage-safe dev/holdout split:

```bash
python main.py split
```

Reports land in `reports/` (or `reports/<run_id>/` for batches) as JSON and Markdown.

## Pipeline

```
URL -> safe URL check -> HTTPX website snapshot (home + up to 5-8 key pages: imprint, about,
security, privacy, changelog, pricing...) -> ONE bounded Claude research session
(identity, claims, 12-criterion baseline, autonomous follow-ups, preliminary verdict)
-> evidence validator -> coverage cross-check -> guardrails -> adversarial critic (when
triggered) -> optional Opus escalation -> final guardrails -> JSON + Markdown report
```

Python owns deadlines, concurrency, coverage, validation, persistence, caching, error handling and evaluation. Claude owns understanding the product, choosing queries, following leads, interpreting evidence and the verdict itself.

Research is one Claude session per product rather than one per criterion. The context gets built once. The critic is a second, short session fed a compact JSON summary of validated evidence, never the research transcript, which keeps cache-read tokens down.

## What makes the evidence trustworthy

The runner records the tool events Claude Code actually emitted (`stream-json`): every WebSearch query, every URL each search returned, every WebFetch and whether it failed. The validator then grades each cited source:

| Status | Meaning |
|---|---|
| VERIFIED_QUOTE | excerpt found in text we hold: the WebFetch result, a direct HTTPX fetch, or the search output |
| RETRIEVED | page retrieved and mentions the vendor or product, excerpt not matched literally |
| SEARCH_OBSERVED | URL really appeared in a search result this session, content unchecked |
| UNRETRIEVABLE | observed, but the content check failed |
| REJECTED | never observed and not retrievable (likely hallucinated), unsafe, or a page about another entity |

Duplicate URLs (canonicalised) are merged and references remapped. The same text on two domains is marked as a syndicated copy and loses independence.

The guardrails (`research/judge.py`) never override taste, only integrity:

- A red flag must cite validated evidence or it is moved to unresolved questions.
- A RED verdict with no validated red evidence drops to YELLOW, LOW confidence.
- A GREEN that coexists with a confirmed RED finding is flagged as a conflict and sent to the critic.
- Confidence is capped when fewer searches ran than the mode's target, when security or legal coverage is missing, or when under half the evidence validates.
- A criterion the model calls INVESTIGATED with no matching executed query and no valid evidence is downgraded to INSUFFICIENT_EVIDENCE.

## The rubric

`prompts/investigator.md` holds the decision rubric. It was derived from the reviewer reasoning in the 40-row dataset as general patterns, with no product names, URLs or labels. Examples: a regulator finding that contradicts the product's central promise is RED even for a market leader; website age never decides alone; ownership churn and naming or licensing ambiguity are YELLOW when they make it unclear what is bought; a breach handled transparently can stay GREEN; an unidentifiable vendor with unverifiable traction claims is RED for enterprise use.

## Subscription use and safety

- Every Claude call runs with `--tools WebSearch,WebFetch`, the same allowlist, an explicit deny list (Bash, Read, Write, Edit, Agent...), `--permission-mode dontAsk --permission-prompts none`, an empty `--strict-mcp-config`, `--setting-sources ""` and `--disable-slash-commands`, from an empty scratch directory. Bypass mode is never used.
- The prompt goes through stdin. No `shell=True`. URLs are never interpolated into a shell.
- `ANTHROPIC_API_KEY` is stripped from the child environment, so a stray key cannot silently switch you to metered billing. A run whose reported auth source is not the subscription is flagged.
- Website content is wrapped in an `<untrusted_website_snapshot>` block whose closing tag is stripped from the content, and both system prompts forbid following instructions found in retrieved content.
- The HTTPX fetcher allows only public http(s) on standard ports, resolves DNS and rejects private, loopback, link-local, CGNAT, metadata and IPv4-mapped IPv6 addresses, re-checks every redirect hop, and caps size, time and per-domain concurrency.
- A usage-limit result (HTTP 429, a rejected rate-limit event, or limit text) raises `SubscriptionLimitError`. The batch stops launching sessions, keeps finished reports, marks the rest pending and prints the `resume` command.
- `total_cost_usd` from the CLI is reported as an API-equivalent list price. It is not your subscription bill.

## Modes

| | FAST | DEEP |
|---|---|---|
| research max turns | 30 | 60 |
| search target | 10-18 | 20-35 |
| critic | only when triggered | always |
| Opus escalation | off | on, budget 2 per batch |
| per-call timeout | 420 s | 900 s |

The critic runs in FAST mode when the verdict is GREEN or RED without HIGH confidence, confidence is LOW, contradictions were reported, a guardrail changed the verdict, or a GREEN conflicts with confirmed red evidence.

## Caching

SQLite in `data/stackgini.sqlite3`: fetched pages (72 h TTL), completed reports keyed by URL + mode + model (7 days, so security and lifecycle findings are not reused as current indefinitely), validated evidence per run, and batch run state for resume. Use `--no-cache` to force fresh research.

## Submission format

The official evaluator could not be inspected: the brief at aiagentsberlin.xyz was unreachable from the build environment and is not indexed by search. `evaluation/submission.py` therefore mirrors the dataset columns exactly: `id,url,product,vendor,overall,green_flags,yellow_flags,red_flags,reasoning`, with `overall` as `Green/Yellow/Red`. The JSON variant adds confidence, validated source URLs and unresolved questions. Change `COLUMNS` there if the official format differs.

## Tests

```bash
python -m pytest -q
```

Everything under `tests/` is MOCKED: `tests/fake_claude.py` stands in for the CLI and emits real-shaped stream-json, and HTTPX uses a mock transport. No subscription usage, no network. The real integration checks are `doctor --live` and the `investigate`/`evaluate` runs.

## Project layout

```
main.py                 CLI
config.py               modes, models, limits
schemas.py              Pydantic models and the flattened JSON schema for --json-schema
runner/                 ClaudeRunner, stream-json parser, usage aggregation
research/               investigator (prompt + call + repair), validator, critic, judge
tools/                  safe_url (SSRF guards), website (HTTPX + BeautifulSoup snapshot)
core/                   orchestrator + batch, coverage state, evidence store, cache, budgets, Markdown
prompts/                investigator.md, critic.md
evaluation/             dataset split, metrics, submission export
tests/                  mocked unit and pipeline tests
```
