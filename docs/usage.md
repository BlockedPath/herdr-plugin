# Usage — Herdr X-Ray v0.1.0

## Install

```bash
herdr plugin install BlockedPath/herdr-plugin --ref v0.1.0
# or standalone
node bin/herdr-xray.mjs --help
```

Requires Node 20+, no `npm install` build.

## Quick start

```bash
# Audit a local checkout
herdr-xray audit ./my-plugin --format terminal

# Audit a public GitHub plugin (no checkout, no exec)
herdr-xray audit owner/repo --ref main --format json --output receipt.json
herdr-xray receipt verify receipt.json

# Audit what is currently installed
herdr-xray audit-installed my.plugin.id

# Compare installed vs candidate (same tool/rules/limits for both)
herdr-xray compare my.plugin.id owner/repo --ref <commit>
herdr-xray compare my.plugin.id ./candidate --format markdown --output review.md

# Marketplace collisions
herdr-xray marketplace-collisions
herdr-xray audit owner/repo --marketplace-check auto --format json
```

## Popup

`herdr plugin pane open --plugin blockedpath.xray --entrypoint xray` — keyboard: `Tab`/`Enter`/`Esc`, `Ctrl-C` cleans temp. Clicking a `https://github.com/owner/repo` link (repo root only) opens X-Ray with that source; `/tree/`, `/blob/`, `?`/`#`, non-`github.com` are ignored.

## Interpreting a receipt

- `findings[].class`: `fact` (declared), `heuristic` (inferred), `unknown` (bounded but unresolved — dynamic import, opaque binary, missing file, `resource-limit`)
- `summary.unknowns > 0` → `analysis: partial`; check `completeness.dimensions` and `findings` with `unknown`
- `xray.dynamic.resource-limit` → rerun with higher `--max-*` or `--timeout-ms` (up to hard limits in `docs/resource-limits.md`)
- `xray.identity.plugin-id-collision` → marketplace lists `>1` repo claiming same `id`; verify desired `owner/repo`
- `comparison` → `graph: changed` with `high` on `trigger|build`/`|startup`/`|event` means new automatic execution

Never a safety score. Redacted receipt (`strict` default) removes absolute paths, `Authorization`, URL secrets.

## Policy exits (automation)

```bash
herdr-xray audit ./plugin --fail-on-severity high --fail-on-unknown --require-complete
# 0 ok, 2 usage, 3 incomplete/unavailable, 4 policy, 5 receipt invalid
```

## Limits

See `docs/resource-limits.md`. Override with `--max-files`, `--max-total-bytes`, `--max-file-bytes`, `--max-depth`, `--timeout-ms` (capped by hard limits). `marketplace` fetch respects `marketplaceResponseBytes` and `--offline`.
