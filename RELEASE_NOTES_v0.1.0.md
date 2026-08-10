# Herdr X-Ray v0.1.0 — Pre-install execution graphs and trust receipts

First tagged release of Herdr X-Ray (`blockedpath.xray`). Reports evidence and explicit unknowns — never "safe"/"malicious" labels — without executing, installing, or building target plugin code.

## Highlights

**Core audit**

- Local, GitHub (`owner/repo[/subdir]` + `--ref`), and installed (`audit-installed <plugin-id>` via `herdr plugin list --json` + `HERDR_BIN_PATH`, `shell:false`, bounded `herdrResponseBytes`/`diagnosticBytes`/`timeoutMs`, SIGTERM→SIGKILL escalation) sources
- Manifest parsing via vendored `smol-toml@1.7.1` (byte/depth limited, byte-identical `* text=auto eol=lf` via `.gitattributes`)
- Execution graph with stable IDs, platform-aware triggers/commands/link edges, interpreter candidate handling, Windows `.exe` tracing
- Bounded recursive tracing (`traceDepth`, `filesAnalyzed`, `totalAnalysisBytes`, `graphNodes`/`Edges`/`Findings`) with `analysis: partial` + `xray.dynamic.resource-limit` on exhaustion
- Language analyzers: JavaScript, shell, Python (relative imports + `__init__.py`), PowerShell/Batch (comment/string-aware, computed-endpoint `dynamic-endpoint` at medium), `package.json` lifecycle, generic text, binary/WASM opaque

**Compare**

- `compare <plugin-id> <source>` — same tool/rules/limits for baseline + candidate; identity/manifest/graph/finding/completeness/reachable-file diff, order-insensitive + null-safe platform handling; `xray.identity.source-changed` only on verifiable upstream change; `comparisonChanges` bounded (500/2k), `comparison` dimension

**Trust receipt**

- `schemas/receipt-v1.schema.json` Draft 2020-12, closed; `analysisHash` (stable projection) + `receiptHash` (integrity over all but itself); `redactReceipt` for `strict`/`standard`; `receipt verify <path>` exit 0/5 (RECEIPT_INVALID) with contract + hash checks
- Hashed persistence under `HERDR_PLUGIN_STATE_DIR`/`XDG_STATE_HOME` → `receipts/<pluginHash>/<receiptHash>.json` with `open wx` + `rename` atomic, `0644`/`0600`

**Marketplace**

- `fetchMarketplace` from `https://herdr.dev/plugins/` (manual redirect, origin check, `marketplaceResponseBytes`, balanced-brace `initialData` extraction, `schemaVersion:1` validation), file cache under state dir, `findCollisions`/`hasCollision`, `marketplace-collisions` command and `--marketplace-check auto|on|off` + `--offline` enrichment (adds `marketplace` dimension + `xray.identity.plugin-id-collision` when needed)

**Popup (Milestone 4)**

- `herdr-plugin.toml` — no `build`/`startup`/`events`; `open` + `audit-installed` actions, `xray` popup pane (`90%×85%`), `github-plugin` link handler `^https://github\\.com/[^/?#]+/[^/?#]+/?$` → validated repo-root only via `HERDR_PLUGIN_CLICKED_URL`, `HERDR_BIN_PATH` + `shell:false` for `plugin pane open --env`

## CLI

```
herdr-xray audit <source> [--ref <ref>] [--format terminal|json|markdown] [--output <path>] [--marketplace-check auto|on|off] [--offline] [--redaction strict|standard] [--fail-on-severity low|medium|high] [--fail-on-unknown] [--require-complete] [--max-files <n>] [--max-total-bytes <n>] [--max-file-bytes <n>] [--max-depth <n>] [--timeout-ms <n>] [--no-color]
herdr-xray audit-installed <plugin-id> [options]
herdr-xray compare <plugin-id> <source> [options]
herdr-xray marketplace-collisions [--offline] [--format terminal|json|markdown] [--output <path>]
herdr-xray receipt verify <path>
herdr-xray version / help
```

Exit codes: `0` ok, `2` usage, `3` incomplete/unavailable, `4` policy (`--fail-on-*`/`--require-complete`), `5` receipt invalid.

## Constraints

Plain Node.js ESM, Node 20+, no runtime deps, no install-time build, macOS/Linux/Windows (`* eol=lf` + `vendor/** -text`), bounded tracing with explicit incomplete/unknown, `HERDR_BIN_PATH` + `shell:false` everywhere, no telemetry/auto-install/score.

## Verification

```
npm run check  # 108 tests, node --check, biome
```

CI: `ubuntu/macos/windows × Node 20/24` all green.

## Install

```bash
herdr plugin install BlockedPath/herdr-plugin --ref v0.1.0
# or
node bin/herdr-xray.mjs audit owner/repo --ref main --format json --output receipt.json
node bin/herdr-xray.mjs receipt verify receipt.json
```

Commit-pinned install command is also emitted in popup/terminal reports.
