# Threat Model Checklist — Invariant Coverage for Stable v1

Maps every invariant in `docs/threat-model.md` to an automated test or a documented three-platform manual verification. A limit/parse/unsupported/unavailable case must never produce a `complete` receipt.

| # | Invariant | Test / Manual | Evidence |
| --- | ----------- | --------------- | ---------- |
| 1 | Target code never imported/evaluated/launched/loaded | `test/audit-cli.test.mjs` `EXECUTED` sentinel, `test/installed-source.test.mjs` `EXECUTED`, `test/corpus.test.mjs` no `writeFileSync` side-effect | All audits write `throw`/`writeFileSync` payloads and assert absent |
| 2 | Never runs package managers / target build/install | Same as 1 + `src/graph/build.mjs` never spawns | No `npm`/`pip`/`cargo` in analyzers |
| 3 | Remote only via bounded GitHub REST metadata/blob | `test/github-rest-source.test.mjs` + `src/source/github-rest-source.mjs` `githubRequests`/`githubTotalResponseBytes` etc. | Validates commit/tree/blob flow |
| 4 | Every HTTP body streamed through byte counter (`Content-Length` only early) | `test/github-rest-source.test.mjs` `enforces request and streamed response budgets` | `src/source/github-rest-source.mjs` `#readBody` counts decompressed bytes |
| 5 | Redirects refused, only `https://api.github.com` | Same test `refuses redirects` + `src/source/github-rest-source.mjs` `redirect: manual` + origin check |
| 6 | No auth token / Git credential read in v1 | `src/source/github-rest-source.mjs` no `Authorization` header, `grep -rn Authorization src/` dry | Manual: `grep` shows only redaction of `Authorization` |
| 7 | Herdr subprocesses `argv` + `shell:false` + `HERDR_BIN_PATH` | `test/installed-source.test.mjs` `herdr invocation uses argv without a shell` + `src/herdr/cli.mjs` `spawn(..., {shell:false})` + `herdrBinaryPath` |
| 8 | Untrusted values never become shell strings | Same as 7 + `src/cli/main.mjs` `writeAtomic` uses `resolve` + `open wx` | No `exec` with string interpolation |
| 9 | Traversal never follows symlinks/reparse, rejects non-regular | `test/filesystem-source.test.mjs` symlink/other + `src/source/filesystem-source.mjs` `lstat`/`O_NOFOLLOW` | `realpath` once + `verifyStable` |
| 10 | Every read/request/file/byte/graph/depth/finding/deadline bounded | `test/limits.test.mjs`, `test/corpus.test.mjs` within bounds, `src/config/limits.mjs` DEFAULT/HARD | All dimensions have limits |
| 11 | Every limit/unsupported/missing/truncation/mutation → completeness + unknown | `test/corpus.test.mjs` limit case, `test/compare.test.mjs` `change limit truncates`, `src/audit/audit.mjs` `dimensions` |
| 12 | Untrusted terminal text sanitized (C0/C1, ANSI/CSI/OSC, bidi, hyperlinks) | `src/render/terminal.mjs` `safe()` + `src/receipt/redact.mjs` + manual: `printf "\x1b[2J"` shows `�` |
| 13 | Markdown escapes headings/tables/links, safe fence | `src/render/markdown.mjs` `escape()` + `test/audit-cli.test.mjs` markdown render |
| 14 | JSON only JSON to stdout; diagnostics to stderr | `test/audit-cli.test.mjs` `atomic output writes` + `src/cli/main.mjs` `stdout.write` vs `stderr` |
| 15 | Persisted receipts redact paths, auth, URL secrets, env, high-entropy | `test/audit-cli.test.mjs` `both redaction modes` + `src/receipt/redact.mjs` + verify no `root` in serialized |
| 16 | Receipt storage hashed paths + atomic same-dir `wx`+`rename` | `src/receipt/persist.mjs` `hashSegment` + `open wx` + `test/corpus.test.mjs` no absolute paths |
| 17 | `receiptHash` over all but itself, `analysisHash` stable projection | `test/receipt-verify.test.mjs` `any mutation invalidates` + `src/receipt/hash.mjs` |
| 18 | Temp dirs/files private, tracked, `finally` cleanup; failure reported | `src/source/filesystem-source.mjs` `verifyStable`, `src/audit/audit.mjs` `finally`, manual: `lsof` shows no leak |
| 19 | No telemetry | `grep -rn fetch` dry (only `api.github.com` and `herdr.dev`), no `telemetry` strings |

**Manual three-platform verifications (run on Ubuntu, macOS, Windows with Herdr 0.8.0):**

- `herdr plugin list --json` shape → `test/herdr-contract.test.mjs` + live `herdr plugin list --json` on each OS
- Popup keyboard-only: `herdr plugin pane open --plugin blockedpath.xray --entrypoint xray` navigable via `Tab`/`Enter`/`Esc`, `SIGINT` cleans temp
- Link handler: `https://github.com/owner/repo` opens X-Ray, `.../tree/main`/`/blob/...`/`?query`/`#fragment` ignored with `ignoring non-repository` to stderr, never as shell
- Market: `herdr-xray marketplace-collisions --offline` uses cache, `--marketplace-check on` unavailable → `completeness.marketplace: unavailable` + exit 3

**Gate:** Every row above has a `test/*.test.mjs` or a documented manual step above. No invariant relies solely on prose. A limit breach/parse failure/unsupported edge/unavailable enrichment never yields `complete: true` — verified by `validateReceiptContract` + `test/receipt-verify.test.mjs`.
