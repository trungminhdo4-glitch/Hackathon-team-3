# VERITAS handoff for the team merge

VERITAS checks other pipelines' findings. It does not replace research. It re-checks every cited reason against the cited page, drops or narrows what the page does not say, and blocks a verdict that an established or open material issue contradicts. Branch: `feat/adversarial-fact-checking`. All code is in `veritas/`. No new dependencies.

## Recommended use: guard mode over the strongest pipeline

On the 40 dev rows, the Python agent on `shuhan-miao` measured 27/40 (its own `agent/RESULTS.md`). Keyless VERITAS on its own measured 17/40 (`README.md`, Phase 3 table A). VERITAS alone is conservative: Green needs independent evidence. Use it as a **guard**, which keeps the teammate verdict unless VERITAS has a verified reason against it (`replay.js guard()`):

| Situation | Guard result |
| --- | --- |
| VERITAS establishes a material negative | Red |
| Teammate Green, but a material issue is open or established as a caveat | Yellow |
| Teammate Red, but no red reason survives the citation audit | Yellow |
| Otherwise | teammate verdict |

In every case, reasons whose quote is not on the cited page are removed or narrowed. On 7 real teammate outputs, guard mode kept all 7 verdicts and removed 7 unverifiable citations (README, Phase 3 table B).

## Entry points

| Use | Call | Input → output |
| --- | --- | --- |
| JS pipeline (SaaSLens, `server/live.js`) | `assessVendor(url, research, { provider, fetcher, judge, controller, signal })` in `adapters.js` | SaaSLens v2 research → `{ row, flags, tasks }`. `row` has the 9 CSV columns plus `_ledger` and `_findings` |
| Any pipeline, offline | research cache file + `npm run veritas:dataset -- --research-cache file.json --cache-only` | cache → scored report |
| Python agents' audit JSON | `node veritas/replay.js --agent-audit verdicts.json --report report.json --refetch` | teammate output → citation audit, VERITAS verdict and guard verdict |
| Blind batch | `npm run veritas:batch -- --input blind.csv --output submission.csv --audit audit.json --deadline <ISO>` | CSV/JSON with `id,url` → submission CSV, audit JSON (ledger per row) |
| Raw claims | `verifyClaims(claims, evidence, provider, budget, options)` in `index.js` | see the README "Integration for teammates" section |

## Research cache format (what a teammate exports)

```json
{ "_meta": { "format": "veritas-research-cache", "version": 1, "source": "agent.py", "mode": "cached", "created_at": "2026-11-27T17:00:00Z" },
  "entries": {
    "https://product.example/": {
      "productName": "Product",
      "documents": [ { "id": "S1", "url": "https://product.example/changelog", "title": "Changelog", "text": "<full page text as fetched>" } ],
      "flags": [ { "kind": "green|yellow|red", "material": true, "topic": "maintenance|security|customer|identity|licensing|...",
                   "text": "the reason as written", "evidence": [ { "sourceId": "S1", "quote": "verbatim excerpt", "relation": "vendor|news|authority|customer|review|other", "vendorAuthored": true } ] } ],
      "incomplete": false, "limitations": [] } } }
```

- `mode` is one of `live`, `cached`, `fixture`, `fetch-only`, `imported` or `keyless`. Reports always state it.
- **Store the full page `text`.** Without it a quote cannot be checked offline. Importers for the existing agent outputs (`cache.js importAgentAudit` and `importReport`) leave `text` empty for that reason, and then `--refetch` is required.
- Entries with `failed: true`, a missing `documents[]`, or evidence pointing at an unknown `sourceId` are reported and not used. A URL missing from the cache is reported as missing. Nothing is fabricated.
- Never put dataset labels or reviewer reasoning in a cache entry.

Minimal runnable example (no keys, no network): `node veritas/examples/handoff-example.js`. It shows a fabricated customer source being rejected, a regulator fine verified and decisive, the guard overriding a teammate Green, and the ledger and validation output.

## Modes without keys

| Command | What runs |
| --- | --- |
| `--researcher collect --provider none --judge none` | Keyless collector: the submitted page plus at most 5 same-site purpose pages (changelog, legal, security, docs, status), robots.txt honoured, public GitHub repository metadata if the vendor links a repository |
| `--researcher cache --research-cache f.json` | Replay of stored research |
| `--researcher fetch` | Submitted page only (floor) |

## Deadline configuration

- `--deadline <ISO time>`: the global stop, with a 15 s safety margin.
- `--per-vendor-ms` (default 150000): the cap on each vendor's fair share of the remaining time.
- `--concurrency` (default 4).
- When a vendor's share ends, its `AbortController` cancels research, fetch, search and judge calls.
- Under 20 s left, a vendor gets an explained Yellow "not assessed before the deadline" row.
- Resume with `--resume`, which reuses only completed rows of the same configuration.

## Known integration conflicts

- This branch still has the v1 `server/live.js`. `origin/main` has v2. The adapter accepts both, but v2 is only tested with a synthetic fixture (`tests/fixtures/saaslens-v2.js`).
- `server/fetch.js` differs between this branch and `main` (20 lines on main). VERITAS uses only `fetchPublicText(url, { signal })` and its `links` field.
- The Python agents (`agent/`, `stackgini-agent/`) are separate stacks. VERITAS integrates with them through their JSON outputs (importers) or the cache format, not through imports.
- The output column format is assumed to equal the 9-column dataset CSV. If the official blind format differs, adapt `toCsv` in `export.js`.

## Required final checks (after the team merge)

```powershell
npm run test:veritas
```
```powershell
npm test
```
```powershell
npm run veritas:batch -- --input blind.csv --output submission.csv --audit audit.json --deadline <ISO>
```

The batch command must end with `validation: OK` (exit code 0). Exit code 3 means validation problems, listed in the output. Exit code 2 means a requested component is unavailable and nothing ran.
