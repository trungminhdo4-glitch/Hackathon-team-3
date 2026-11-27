# Hackathon Team 3 — Stackgini "Agents with Taste"

An agent that checks a software or hardware vendor the way an experienced procurement buyer would. Give it a product URL and it returns a **Green / Yellow / Red** verdict. Every reason in the verdict links to a source a human can open and check.

## What's in this repo

| Folder / file | What it is |
|---|---|
| [`agent/`](agent/) | **The submission agent** (Python). It produces the live verdict CSV. See [`agent/README.md`](agent/README.md), [`agent/BUILD.md`](agent/BUILD.md) and [`agent/RESULTS.md`](agent/RESULTS.md). |
| `src/`, `server/`, `shared/` | **SaaSLens**, an interactive web app for reviewing one product's evidence (documented below). |
| [`stackgini_submission_verdicts.csv`](stackgini_submission_verdicts.csv) | **The submitted verdict file** for the 10 live products (`out_of_sample_10.csv`), in the same columns as Stackgini's 40 examples. |
| `shuhan_verdicts_agent.csv` | Raw agent output for the live run that the submitted file is built from (adds `confidence`). |
| `shuhan_verdicts_audit.json` | Audit trail for the live run: votes, evidence IDs, quotes and verification status. |
| `hackathon_40_solutions_commented (1).csv` | Stackgini's 40 labelled development examples. |
| [`stackgini-agent/`](stackgini-agent/), [`codex-fallback/`](codex-fallback/) | Two alternative agents built by teammates, each with its own README and verdicts for the live products. |

Work that was not merged into `main` is kept as `archive/*` tags. For example, the VERITAS claim-level fact-checker is in the `archive/feat/adversarial-fact-checking` tag.

## How the agent works: cheap steps first, the model last

1. **Free checks:** a bounded crawl of the vendor site (who signs the contract, dates, traction and logo claims, end-of-life notices), RDAP domain age and Wayback history. Everything is disk-cached.
2. **About 9 targeted web searches per vendor (Tavily), in the vendor's own language:** fines, regulators, lawsuits, breaches, ownership/private equity, renames, end-of-life, licensing limits and sanctions. Hardware also gets firmware, CVE, recall and lifecycle checks.
3. **Three votes from a small open model** (`openai/gpt-oss-120b` on Nebius Token Factory). The majority wins.
4. **Claim verification:** each reason must cite an evidence ID, and its quote is checked against the fetched source. Unsupported claims are dropped. Empty search results mean *unknown*, never *clean*. If the model fails, rules take over.

## Results and cost

| | Result |
|---|---|
| Stackgini's 40 examples | **31/40 (77.5%)**, zero Red↔Green errors |
| 40 fresh, self-labelled sites (2 held-out sets) | zero Red↔Green errors |
| Live run (10 products) | about 2 minutes, about 90 Tavily credits, a few cents of Nebius usage |

Judge comparison on the same evidence:

| Judge | Score | Cost vs gpt-oss | Notes |
|---|---:|---:|---|
| **gpt-oss-120b** | **31/40** | 1x | default |
| Claude Sonnet | 27/40 | about 7x | |
| Kimi K3.1 Pro | 26/40 | about 28x | about 10x slower |
| DeepSeek V4.1 Flash | 24/40 | about 7x | |

None of the bigger models beat the small one. Better evidence mattered more than a bigger model. The 40 examples were also used for development, so treat 31/40 as optimistic.

## Run the live batch

```bash
cd agent
pip install -r requirements.txt
# needs TAVILY_API_KEY and LLM_API_KEY (Nebius) in the environment or agent/.env (git-ignored)
python agent.py --blind --input live_urls.txt --out verdicts.csv \
  --audit-out verdicts.json --workers 5 --no-screenshot
```

---

## SaaSLens (evidence review app)

Enter a software product, company, or public URL. Add a question if you want to evaluate a specific use or edition. SaaSLens checks whether the product delivers its main promise, shows the passages behind each finding, and keeps reports in the current tab’s session history.

Open **View or download dataset report** on any saved investigation to preview its eight columns and download CSV or Markdown. Optional reviewer notes are stored with that report in this tab.

Choose **Bulk URLs** to paste or import up to 50 public URLs. TXT accepts one per line. CSV accepts a URL column, including the repository dataset. Only the URLs and selected model go to research. Open a result for its full report or download the batch as one CSV. **Session history** reopens individual reports, pending reviews and batches saved in this browser tab.

## Run locally

Use Node.js 22.12 or later. Set `OPENAI_API_KEY` in your server environment or ignored `.env.local` file. Run `npm ci` and `npm run dev`, then open [SaaSLens](http://127.0.0.1:4173).

**GPT-6.2 Sol** leads demo investigations and writes the assessment. If independent evidence is thin and the account has access, Sol delegates one focused search to **GPT-6 Luna**. You can also select **GPT-6.2 Astra** for difficult comparisons, **GPT-6.1 Terra** for document summaries, **Luna** for a lower-cost standalone check, or either GPT-4.1 baseline. The picker includes guidance and your OpenAI project’s model inventory. [OpenAI model selection](https://developers.openai.com/api/docs/guides/model-selection)

`OPENAI_MODEL` sets the preferred OpenAI model. To enable **Meta Llama 3.3 70B**, add `GROQ_API_KEY` to the server environment and restart. For that option, OpenAI searches and Groq receives the question and retrieved passages for assessment by Llama. Reports record both model IDs.

## How it works

The main OpenAI Agents SDK researcher runs official and independent searches in parallel. Depending on the product, it looks for first-party terms, customer deployments, reviews, partner documentation, and regulator records. When the independent pages yield little evidence of actual use, the researcher can run a targeted follow-up. The activity view identifies the participating models, reported queries, pages read, retrieval failures and evidence checks. You can reopen it with the saved report.

The model proposes findings from numbered source passages. The server checks quotations and derives the verdict from accepted findings. Cited benefits, limitations and material risks appear in the eight-column export. When evidence is insufficient, the report explains which check remains open.

**What the sources say** groups passages by page and explains what each one supports. **Pages checked** includes unreachable sources. The review prompt identifies the unresolved claim, what would justify each color, and the specific evidence the researcher needs.

The [evaluation rubric](EVALUATION.md) covers capability, customer experience, licensing, maintenance, security and privacy, and vendor claims. **Green** means evidence supports the core promise. **Red** requires a verified core contradiction or serious risk. **Yellow** names a material caveat, conflicting evidence, or a specific unresolved evidence gap. A failed investigation has no verdict.

If the core claim remains open, the app pauses and asks for help. Suggest a public source, an edition, or a specific task for one more search, or finish with the evidence collected. The researcher checks your lead alongside the earlier findings. The final report and CSV explain the color and cite the evidence that determined it. The browser keeps reports in the current tab. A pending review can be resumed on the same running server for up to 30 minutes.

The Node API accepts `POST /api/investigate` with `{"url":"https://product.example/"}` or a `subject`. You can include a `question` and a `model` ID from `GET /api/model`. The [40 sample reviews](hackathon_40_solutions_commented%20%281%29.csv) are for calibration. Live investigations use public sources.

API clients can opt into the pause with `"review": true`. If the response contains `review.id`, POST the ID to `/api/investigate/review` with `action: "research"` and a `guidance` string, or `action: "finalize"`. Both routes support the same activity stream. A finalized Yellow based on missing evidence carries `verdictBasis: "evidence_gap"`.

For batches, send `{"urls":["https://sentry.io/","https://example.com/"]}` to `POST /api/investigate/bulk`. Use `Accept: application/x-ndjson` for per-URL progress or request JSON for the ordered results.

## Tests

Run `npm test` for server tests, then `npm run build` and `npm run test:ui` for API-backed browser tests. These use synthetic evidence and require no credentials. Playwright uses Edge on Windows where available or Chromium installed with `npx playwright install chromium`.

With the key configured, `node --env-file-if-exists=.env.local tests/live-smoke.js` runs billable live investigations of Sentry and example.com. To test a particular case, append its quoted URL and optional quoted question.

With the app running, `python tests/calibrate.py --model gpt-6.2-sol` tests the first ten dataset URLs. Pass row IDs and `--bulk` for a different cohort in one request. Each URL runs a billable investigation. See the [20-product live evaluation](EVALUATION_SOL.md) for results, row IDs and export commands.

For the full dataset with Luna, run `python tests/calibrate.py --all-rows --bulk --model gpt-6-luna --output luna.jsonl --report-dir luna-reports`. Export the saved results with `node tests/export-calibration.js luna.jsonl luna-reports luna-export`. See the [40-product Luna evaluation](EVALUATION_LUNA.md).

## Fallback agent verdicts (19:00 batch, ids 41–50)

These come from the independent `codex-fallback/` agent. The verdicts we submitted are in [`stackgini_submission_verdicts.csv`](stackgini_submission_verdicts.csv).

- `stackgini-verdicts.csv` – verdicts for the 10 products. Columns: `id,url,verdict,status,reasons_with_sources`. `verdict` is GREEN/YELLOW/RED; `reasons_with_sources` has one reason per line, each followed by its source URL.
- `stackgini-verdicts-report.md` – same verdicts with a supporting quote per reason; `stackgini-verdicts.json` – machine-readable version.
- `codex-fallback/` – the standalone agent that produced them (see its README).
