# SaaSLens

Enter a software product, company, or public URL. Add a question if you want to evaluate a specific use or edition. SaaSLens checks whether the product delivers its main promise, shows the passages behind each finding, and keeps reports in the current tab’s session history.

Open **View or download dataset report** on any saved investigation to preview its eight columns and download CSV or Markdown. Optional reviewer notes are stored with that report in this tab.

## Run locally

Use Node.js 22.12 or later. Set `OPENAI_API_KEY` in your server environment or ignored `.env.local` file. Run `npm ci` and `npm run dev`, then open [SaaSLens](http://127.0.0.1:4173).

Choose **GPT-4.1** or **GPT-4.1 mini** for both search and assessment. To enable **Meta Llama 3.3 70B**, add `GROQ_API_KEY` to the server environment and restart. For that choice, OpenAI runs the web search and Groq receives the research question and retrieved passages for assessment by Llama. The selector checks each provider’s model inventory. New reports record both model IDs. [Groq model details](https://console.groq.com/docs/model/llama-3.3-70b-versatile)

`OPENAI_MODEL` sets the default OpenAI model and the search model used with Meta. The demo supports `gpt-4.1`, `gpt-4.1-mini`, and their dated snapshots.

## How it works

One OpenAI Agents SDK researcher searches for product documentation, independent tests and deployments, customer testimony, and records relevant to the intended use. The server validates citations against retrieved passages and derives the verdict from the accepted findings.

The [evaluation rubric](EVALUATION.md) covers capability, customer experience, licensing, maintenance, security and privacy, and the credibility of vendor claims. **Green** means the core promise is supported. **Yellow** identifies a condition or conflict material to the decision. **Red** requires evidence of a core contradiction or serious disqualifying risk. **Insufficient evidence** means the core claim could not be established. Each report explains which evidence mattered.

The Node API accepts `POST /api/investigate` with `{"url":"https://product.example/"}` or a `subject`. You can include a `question` and a `model` ID from `GET /api/model`. The [40 sample reviews](hackathon_40_solutions_commented%20%281%29.csv) are for calibration. Live investigations use public sources.

## Tests

Run `npm test` for server tests, then `npm run build` and `npm run test:ui` for API-backed browser tests. These use synthetic evidence and require no credentials. Playwright uses Edge on Windows where available or Chromium installed with `npx playwright install chromium`.

With the key configured, `node --env-file-if-exists=.env.local tests/live-smoke.js` runs billable live investigations of Sentry and example.com. To test a particular case, append its quoted URL and optional quoted question.

With the app running, `python tests/calibrate.py 2 6 32` compares three dataset rows against fresh overall verdicts. It sends only each row’s URL to the API and prints the reviewer’s reason beside the app’s reason and sources. Each row runs a billable search.
