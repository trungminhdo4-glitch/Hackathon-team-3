# SaaSLens

Enter a software product, company, or public URL. Add a question to focus the research on a particular product or edition, such as whether it requires a separate commercial license. SaaSLens shows the answer and available evidence, strengths, cautions, red flags, and a verdict. Open **Session history** to revisit reports in the same browser tab.

The [sample reviews](hackathon_40_solutions_commented%20%281%29.csv) illustrate the kinds of issues to investigate, including product renaming, licensing, ownership, maintenance, and documented risks. Each new report uses live sources.

## Run locally

Use Node.js 22.12 or later and set `OPENAI_API_KEY` in the server environment or the ignored `.env.local` file. Run `npm ci` and `npm run dev`, then open [SaaSLens](http://127.0.0.1:4173). To change the default `gpt-4.1` model, set `OPENAI_MODEL` to a model supporting hosted web search and structured output.

## How the verdict works

The Node API accepts `POST /api/investigate` with a `subject` and optional `question`. Existing `{"url":"https://product.example/"}` calls also work. A single OpenAI Agents SDK researcher uses hosted search to identify the product and gather sources. The server checks DNS and redirects, bounds page retrieval, and matches quoted evidence against retrieved text.

| Confirmed finding | Points |
| --- | ---: |
| Product identity at the exact submitted domain | 40 |
| Independent corroboration linking that product and domain | 30 |
| Identifiable operator with public legal or contact information | 20 |
| Concrete product documentation or changelog | 10 |

**Green** requires both identity checks, at least 70 points, completed retrieval, and no verified contradiction. **Red** takes priority when an authoritative source establishes a material contradiction. **Yellow** covers gaps, mixed findings, and partial retrieval. A failed investigation has no score. Points measure evidence coverage. Security and safety require a separate assessment.

## Tests

Run `npm test` for server tests. Run `npm run build` followed by `npm run test:ui` for browser tests covering reports, citations, retries, and history. Automated tests use synthetic evidence and require no credentials. Playwright uses Edge on Windows when available, or Chromium installed with `npx playwright install chromium`.

With a configured key, `node --env-file-if-exists=.env.local tests/live-smoke.js` runs billable live investigations of Sentry and example.com. Their results depend on the evidence accessible at run time.
