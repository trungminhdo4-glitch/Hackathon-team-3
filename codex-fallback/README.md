Stackgini independent Codex fallback, version 1.2

This standalone Python project does not inspect ~/stackgini-clean, fallback_v1, teammate code, remote repositories, historical research or labelled datasets. Only explicitly supplied input files and this project's own current-run checkpoints are used. The user supplied test_5.csv, test_1.csv and test_3.csv; their nine distinct URLs are prepared in inputs/all_tests.json. No original 40-row dataset or hidden labels were accessed.

Start the prepared nine-product test from any directory:

```sh
bash "/Users/5exclamations/Documents/Codex/2026-11-27/referenced-chatgpt-conversation-this-is-an-2/outputs/stackgini-codex-fallback/run_tests.sh"
```

Each invocation creates a new output directory under runs/. Existing results are retained. Progress prints every 15 seconds. The independent read-only progress viewer follows the most recently updated run:

```sh
python3 status.py --watch 5
```

Requirements are Python 3.11+, curl, and Codex CLI with an existing file-backed ChatGPT subscription login. No pip packages are needed. Verified with codex-cli 0.147.0 and Python 3.14. macOS/Linux process groups are used; Windows is unsupported.

Check local readiness without a model call:

```sh
python3 agent.py doctor
```

The optional capability probe makes one subscription model request to search/open the official IANA documentation and checks its quote through an independent HTTP fetch:

```sh
python3 agent.py doctor --probe
```

For the actual live round, create live-urls.txt from the organiser's supplied URLs, one per line, then run from this project directory:

```sh
python3 agent.py run live-urls.txt --out runs/live-v12 --minutes 40 --deadline 2026-11-27T19:40:00+01:00 --workers 3 --model-concurrency 2
```

Berlin 19:00–19:45 on 27 Nov 2026 is Istanbul 21:00–21:45. The deadline above is explicitly Berlin time and reserves five minutes for submission. Nothing is scheduled or uploaded automatically. The official brief was downloaded with curl (HTTP 200) and extracted on 27 Nov 2026: https://aiagentsberlin.xyz/ah3-brief-stackgini-agents-with-taste.pdf . It requires autonomous investigation and a checkable source behind each reason. It gives no exact field schema; confirm any additional onsite submission requirements. This project does not prepare the separate standard AIB submission.

Input can be a text file of URLs, CSV with url and optional id/context columns, or a JSON array of URLs/objects. IDs must be unique safe filenames. Buyer requirements belong in context if actually supplied. Empty context means judging the product in its ordinary stated role; the agent must not invent enterprise requirements for community software.

Outputs are submission.json, submission.csv and report.md. submission.json is authoritative. Each file is independently written via a temporary file and atomic replacement, including after every accepted or rejected quote. The collection is not a single transactional snapshot. Checkpoints live under checkpoints/. Reports include rejected sources for diagnosis but rejected claims are not presented as verified reasons.

Version 1.1 changes the decision process. Research first produces candidate reasons. The runner independently fetches each cited page and checks literal quote presence. A fresh, tool-free model call then reviews only the accepted evidence, checks whether each quote supports its claim, chooses numbered evidence references and makes the final verdict. It cannot add an uncited factual summary or cite evidence outside the verified set. A failed supplementary source does not veto an otherwise supported conclusion. Unverified adverse leads are supplied as unresolved questions, never facts, so the final judgement can distinguish missing essential evidence from optional corroboration.

The final judge separates material unresolved questions from general limitations. Missing buyer context, absence of a complete penetration test and lack of a commercial SLA for community software do not alone prevent GREEN. Specific buyer requirements, unresolved current risks or insufficient core evidence can still justify YELLOW. There is no forced colour distribution and no hardcoded product verdict.

GREEN requires the judge's supported conclusion plus verified positive maintenance evidence and outside corroboration from a customer, registry or independent report. Current maintenance also establishes existence; a neutral independently verified security record can corroborate the product without having to label it a positive endorsement. Distribution packaging can qualify as original ecosystem corroboration. A vendor-controlled GitHub repository alone does not count as independent confirmation. RED requires a selected material adverse reason, considered in context. Historical resolved incidents and old design do not alone imply RED.

COMPLETE means the final judgement completed with selected verified evidence and no material unresolved question. General limitations or rejected redundant citations may remain. PARTIAL means substantive uncertainty, insufficient evidence or interrupted judgement. TIMEOUT means no usable evidence survived the cap, and ERROR means a process/startup failed. COMPLETE and GREEN are not security certifications. If the final judge fails, accepted citations remain saved with a provisional YELLOW/PARTIAL result.

Fetching respects HTTP/meta charsets, including Windows-1252 legacy pages. HTML text preserves inline words and separates table cells. Quotes are compared after case, Unicode compatibility, typographic punctuation, HTML-entity and whitespace normalisation. Markdown table cell separators surrounded by spaces are treated as formatting; every word and its order must still match the fetched text. No paraphrase/fuzzy matching is accepted. Quotes must contain at least 16 characters and at most 500; the research prompt requests meaningful phrases, not isolated words. Evidence supporting different axes is no longer lost merely because the quoted passage is the same.

Phase A processes every product in FIFO order using three product workers sharing two model slots. The final judge uses the same model semaphore as research. Each phase has a 180-second product cap including slot waits, HTTP verification and final judgement. Phase B starts only after the initial queue settles, prioritising RED rechecks and unresolved YELLOW cases when more than 20 seconds remain. It gets rejected-citation diagnostics and literal excerpts from already-fetched sources for repair. Prior verified reasons are merged with new evidence before final selection. --no-deepen disables phase B.

A successful phase now uses one research call plus one short tool-free judgement call. Nine products can use up to 36 model calls if all enter both phases. Failures do not trigger an unbounded retry loop. Each session is fresh, supplied context is capped at 26,000 characters plus the fixed prompt, final JSON at 24,000 bytes and subprocess output at one megabyte. The researcher is instructed to limit searches/opens to eight each; the wall-clock and output limits are enforced, while native tool counts are prompt instructions rather than a hard tool quota.

The runner fetches the homepage and up to three relevant vendor links, with up to eight HTTP fetches globally and two per host. Individual responses have a one-megabyte body cap and 12-second timeout. Public DNS addresses are validated and pinned for each redirect; private addresses and nonstandard ports are blocked. These limits apply to the runner's HTTP client, not Codex's search service. Source metadata records time and content hash. No vendor contact, signup or form submission occurs.

PDFs, JavaScript-only content, paywalls and blocked sources remain unsupported by mechanical quote verification. Research now prefers accessible HTML and stable release pages instead of PDF exports, SEC pages or ambiguous GitHub pagination. Literal quote presence does not prove source honesty, genuine customer ownership or full semantic entailment; the final judge improves claim checking but remains a model. Domain matching is a common-suffix heuristic rather than a full public-suffix implementation.

Codex receives a temporary private CODEX_HOME with only a symlink to existing file-backed ChatGPT auth. User config, installed plugins and project rules are not loaded. Shell tools, apps and skills are disabled. Research has native web access; final judgement has web disabled. Model processes have a read-only execution policy and disposable working directory. API-key environment variables are removed. Login status and auth.json must both identify ChatGPT subscription authentication with no API key; ambiguous/API-key auth is refused. No paid API SDK or automatic alternate provider is used. Subscription limits still apply. Credentials are not bundled. Keychain-only authentication is currently unsupported. Claude is never called and its environment/configuration remain untouched.

Explicit retrieval-only mode does not invoke a model and cannot replace research; it produces PARTIAL YELLOW results:

```sh
python3 agent.py run inputs/all_tests.json --out runs/direct --backend direct --no-deepen --minutes 10
```

Resume an interrupted version-1.1 run with the identical input and output directory:

```sh
python3 agent.py run inputs/all_tests.json --out runs/YOUR-RUN --resume --minutes 40
```

Successful checkpoints are reused and unfinished phase A is retried. Changed input/context is rejected. For a live round, retain the absolute deadline because elapsed time is reset on process restart. Do not run two writers against one output directory. Do not resume a completed version-1.0 run to upgrade its decisions: start a fresh run instead. The old nine-product results are retained unchanged.

Run all offline tests:

```sh
python3 -m unittest discover -s tests -v
```

Thirty-five tests cover ten-product workloads and shared research/judgement concurrency, deadlines, failures, source rejection, charset/HTML handling, evidence-only decision references, checkpoint recovery and export. Synthetic fixtures exercise GREEN, YELLOW and RED paths; this proves the logic branches, not classification accuracy on unseen products.

Measured results: the user's version-1.0 nine-product run took 457.39 seconds, used 18 model calls and 86 HTTP requests, and returned nine YELLOW/PARTIAL reports. That run exposed the over-conservative decision logic. A bounded version-1.1 smoke on the user-supplied R project URL completed in 38.62 seconds with two model calls and six HTTP requests, producing GREEN/COMPLETE with three selected verified reasons and one rejected citation. The smoke used only phase A. The original native-web IANA capability probe took 15.45 seconds with four web progress events and no unexpected connector startup.

The user then ran version 1.1 on all nine products: 391.982 seconds, eight YELLOW and one RED, all PARTIAL. The run exposed table-format quote mismatches and a contradictory GREEN-with-material-unknowns response that aborted one final judgement. Version 1.2 fixes those paths: formatting separators no longer cause false rejection, contradictory GREEN becomes YELLOW while retaining evidence, and unfinished phase-A cases can enter the second phase. The proposed model colour is now stored separately from the runner guard. The version-1.2 full batch has not been rerun automatically; its throughput and verdict accuracy remain unmeasured. The intended live budget is still ten products within 40 minutes, with configurable concurrency and hard per-phase caps; those caps bound waiting and execution but do not guarantee every investigation finishes. The single-product smoke is not a batch throughput benchmark.
