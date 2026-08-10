# Regression Corpus — Pinned Marketplace Plugins

Pinned at `v0.1.0` generation for Milestone 5 hardening. Each entry is a public repository with a `herdr-plugin.toml` at HEAD, pinned by commit for reproducibility. Corpus covers diverse languages, platforms, and known edge cases (duplicate IDs, large trees, opaque binaries).

| # | Repository | Commit (pinned) | Manifest path | Plugin ID | Notes |
| --- | ------------ | ----------------- | --------------- | ----------- | ------- |
| 1 | `openclaw/crabbox` | `b563503e57682acc172484f1108af87c0d45b3f3` | `plugins/herdr/herdr-plugin.toml` | `crabbox` | Go, warm remote boxes, duplicate `crabbox` ID edge |
| 2 | `persiyanov/herdr-reviewr` | `792b4b31475ddbf263ee4d421a984e7418031506` | `herdr-plugin.toml` | `persiyanov.reviewr` | Rust, code-review sidebar |
| 3 | `smarzban/herdr-file-viewer` | `71d4c1c3706e7958c714789b035a99d949620a9e` | `herdr-plugin.toml` | `herdr-file-viewer` | Rust, read-only TUI |
| 4 | `AltanS/collie` | `8f4276cf184a75f13950edc70c719290e63fc546` | `herdr-plugin.toml` | `herdr.collie` | TypeScript, PWA |
| 5 | `ogulcancelik/herdr-browser` | `be6888b71cf4eb5939ee79a746bd1a1c22ade046` | `herdr-plugin.toml` | `official.browser` | TypeScript, duplicate `official.browser` ID |
| 6 | `cloudmanic/herdr-plus` | `a9aca9da3ca6d7406f3d878a1df1c1b9775e2723` | `herdr-plugin.toml` | `cloudmanic.herdr-plus` | Go, projects + quick actions |
| 7 | `nicosuave/memex` | `94f7170285bbcf77efa6f6e1b274463117582cf0` | `herdr-plugin.toml` | `nicosuave.memex` | Rust, transcript search |
| 8 | `devashish2203/herdr-worktrunk` | `a3107ca566bafcd463bc138007a0c01051970784` | `herdr-plugin.toml` | `worktrunk` | Shell, duplicate `worktrunk` ID |

Plus duplicate-ID control: `thanhdat77/herdr-navigator` (`herdr-navigator` collides with `herdr-navigator` in another repo) — used to verify `marketplace-collisions` and `xray.identity.plugin-id-collision`.

**Reproducibility:** `herdr-xray audit owner/repo --ref <commit> --format json --output receipt.json && herdr-xray receipt verify receipt.json` must exit `0` and `receiptHash` must validate. For corpus, `npm run check` includes `test/corpus.test.mjs` which audits synthetic equivalents of the above (same manifest shapes, bounded) without live network, ensuring CI determinism. Live network verification is via manual `scripts/corpus-live.sh` (not run in CI by default).

**Update procedure:** On new marketplace snapshot, re-pin commits via `https://herdr.dev/plugins/` `headCommit`, update this table, and re-run `npm run check`.
