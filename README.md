# SaaSLens

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

**What the sources say** groups passages by page and explains what each one supports. Under **Unknowns and limitations**, open **Pages checked** to inspect each URL, the search that found it, the passage retained or the retrieval error, and a suggested follow-up. The review prompt identifies the unresolved claim and the specific evidence the researcher needs.

The [evaluation rubric](EVALUATION.md) asks whether a buyer should shortlist the product for its intended use. **Green** requires supported use or corroborated maintenance and adoption. **Yellow** identifies a buying condition, conflict or evidence gap. **Red** requires a verified core contradiction or serious risk for that use. A failed investigation has no verdict. The [40-row audit](DATASET_AUDIT.md) compares each original Luna verdict with the reviewer's reasoning.

If the core claim remains open, the app pauses and asks for help. Suggest a public source, an edition, or a specific task for one more search, or finish with the evidence collected. The researcher checks your lead alongside the earlier findings. The final report and CSV explain the color and cite the evidence that determined it. The browser keeps reports in the current tab. A pending review can be resumed on the same running server for up to 30 minutes.

The Node API accepts `POST /api/investigate` with `{"url":"https://product.example/"}` or a `subject`. You can include a `question` and a `model` ID from `GET /api/model`. The [40 sample reviews](hackathon_40_solutions_commented%20%281%29.csv) are for calibration. Live investigations use public sources.

API clients can opt into the pause with `"review": true`. If the response contains `review.id`, POST the ID to `/api/investigate/review` with `action: "research"` and a `guidance` string, or `action: "finalize"`. Both routes support the same activity stream. A finalized Yellow based on missing evidence carries `verdictBasis: "evidence_gap"`.

For batches, send `{"urls":["https://sentry.io/","https://example.com/"]}` to `POST /api/investigate/bulk`. Use `Accept: application/x-ndjson` for per-URL progress or request JSON for the ordered results.

## Tests

Run `npm test` for server tests, then `npm run build` and `npm run test:ui` for API-backed browser tests. These use synthetic evidence and require no credentials. Playwright uses Edge on Windows where available or Chromium installed with `npx playwright install chromium`.

With the key configured, `node --env-file-if-exists=.env.local tests/live-smoke.js` runs billable live investigations of Sentry and example.com. To test a particular case, append its quoted URL and optional quoted question.

With the app running, `python tests/calibrate.py --model gpt-6.2-sol` tests the first ten dataset URLs. Pass row IDs and `--bulk` for a different cohort in one request. Each URL runs a billable investigation. See the [20-product live evaluation](EVALUATION_SOL.md) for results, row IDs and export commands.

For the full dataset with Luna, run `python tests/calibrate.py --all-rows --bulk --model gpt-6-luna --output luna.jsonl --report-dir luna-reports`. Export the saved results with `node tests/export-calibration.js luna.jsonl luna-reports luna-export`. The [40-product comparison](PROCUREMENT_EVALUATION.md) shows accuracy before and after the rubric change and links to every reviewer and agent verdict.
