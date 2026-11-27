# Gates: independent Stackgini fallback

OWNS: **

Scope: isolated runnable agent with deadline scheduling, verified evidence, subscription backend and atomic exports; no protected datasets or Claude checkout access.

- [x] G1: mocked workload verifies concurrency, deadlines, failure recovery and incremental exports
  CHECK: python3 -m unittest discover -s tests -v
  EXPECT: /(?:^|\n)OK(?:\n|$)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=12032fba8abad9b1c4623c31ffb2129246cdd061a7481b10df27c92970b035c2; exit=0; EXPECT=matched; output-sha256=03eb8207361bcb68c26caa2168cb2186679d687347c66529231f204b228f7d07; output-bytes=4568; shell=/bin/sh; cwd=/Users/5exclamations/Documents/Codex/2026-11-27/referenced-chatgpt-conversation-this-is-an-2/outputs/stackgini-codex-fallback; path=726e6fc1af01/23 entries

- [x] G2: CLI runs without model billing and reports backend health
  CHECK: python3 agent.py doctor
  EXPECT: doctor_complete
  EVIDENCE: automatic-evidence=v1; definition-sha256=e6ea0ca966c69af7a2f7f0a78a842cd8311d55b251364d17eaf593400cead1d7; exit=0; EXPECT=matched; output-sha256=332c8b6ce710542b708b5d2d3848833e48fa4bf4c0eeb3e432076a20d8354e22; output-bytes=161; shell=/bin/sh; cwd=/Users/5exclamations/Documents/Codex/2026-11-27/referenced-chatgpt-conversation-this-is-an-2/outputs/stackgini-codex-fallback; path=726e6fc1af01/23 entries

- [x] G3: official brief and safety scope are reconciled with implementation and README
  EVIDENCE: Official PDF downloaded HTTP 200 and extracted with pypdf; README reconciled against all three pages. Only this standalone directory and scratch work were accessed; no protected datasets or Claude project files were read. Code uses explicit input only and no Claude calls.

- [x] G4: a small real Codex web probe establishes actual backend capability and records measured latency
  EVIDENCE: Isolated native-web IANA probe on 2026-11-27 completed in 15.45 seconds with four web progress events and unexpected_mcp=false; exact returned quote was independently HTTP-fetched and accepted. Separate retrieval/export integration passed in 0.39 seconds with three HTTP requests. Ten-product model throughput was not measured.

- [x] G5: balanced evidence decisions survive blocked optional sources and legacy HTML without admitting fabricated quotes
  CHECK: python3 -m unittest discover -s tests -p test_v11.py -v
  EXPECT: /(?:^|\n)OK(?:\n|$)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=66df34d6d309f518720eabfb12c5e0638ef578fb115e7aa91453840569c70dab; exit=0; EXPECT=matched; output-sha256=84eead5bfdf910665cc5f7933f8c61d0d230ccd5f20e14bf23f4b31a90bbe4f1; output-bytes=2197; shell=/bin/sh; cwd=/Users/5exclamations/Documents/Codex/2026-11-27/referenced-chatgpt-conversation-this-is-an-2/outputs/stackgini-codex-fallback; path=726e6fc1af01/23 entries

- [x] G6: one approved product completes the revised evidence-only final judgement in a bounded live smoke
  EVIDENCE: User-supplied R project single-product phase-A smoke completed in 38.62 seconds, two subscription model calls, six HTTP requests; GREEN/COMPLETE with three selected mechanically verified reasons, one rejected quote excluded, separate limitations and no material unknowns. Original nine-product reports remain unchanged; revised full batch was not launched.

- [x] G7: table-format differences and contradictory final colours recover without dropping phase-B retries
  CHECK: python3 -m unittest discover -s tests -p test_v12.py -v
  EXPECT: /(?:^|\n)OK(?:\n|$)/
  EVIDENCE: automatic-evidence=v1; definition-sha256=fbe70d8e6a6c86a8f12c747d9c4924f076a13203f1f8616318be133500ecd0a4; exit=0; EXPECT=matched; output-sha256=b6a83e999c22652ab699e15de08c810d1fcf746615c5d94317ed488cf7354b5b; output-bytes=690; shell=/bin/sh; cwd=/Users/5exclamations/Documents/Codex/2026-11-27/referenced-chatgpt-conversation-this-is-an-2/outputs/stackgini-codex-fallback; path=726e6fc1af01/23 entries
