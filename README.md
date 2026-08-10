# Herdr X-Ray

**Pre-install execution graphs and trust receipts for Herdr plugins.**

Herdr X-Ray explains what a Herdr plugin can execute before you install or update it. It will fetch a public GitHub candidate without checking it out, map manifest entrypoints and bounded reachable behavior, compare the candidate with an installed plugin, report plugin-ID/source collisions, and export a reproducible receipt.

X-Ray reports evidence and unknowns. It does **not** label plugins safe or malicious, execute audited code, or install plugins.

## Status

**v0.3.0** — Herdr X-Ray CLI (`v0.1.0`) + **Herdr Mixtape** popup. CLI: bounded audits, compare, marketplace, receipts. Popup: `Herdr Mixtape` — `git log` as Side A/B mixtape, `Enter` to play `git show`, Kitty-ready.

All commands are implemented; no placeholder exit code 3 remains.

## Design constraints

- Plain Node.js ESM
- Node.js 20+
- No npm runtime dependencies
- No install-time build
- macOS, Linux, and Windows support
- Public GitHub, local directory, and installed-plugin inputs
- Bounded tracing with explicit incomplete/unknown results
- Terminal, Markdown, and versioned JSON receipts
- No target code execution
- No telemetry
- No automatic install/update
- No safety score

## Current CLI

```bash
node bin/herdr-xray.mjs help
node bin/herdr-xray.mjs version
node bin/herdr-xray.mjs audit owner/repo[/subdir] --ref <ref>
node bin/herdr-xray.mjs audit ./local/plugin --format json
node bin/herdr-xray.mjs audit-installed <plugin-id>
node bin/herdr-xray.mjs compare <plugin-id> owner/repo --ref <ref>
node bin/herdr-xray.mjs marketplace-collisions
node bin/herdr-xray.mjs receipt verify receipt.json
```

See [`docs/cli-contract.md`](docs/cli-contract.md) for output and exit-code guarantees.

## Development

```bash
npm test
npm run check
```

The test suite uses only Node’s built-in test runner.

## Architecture and contracts

- [`plan.md`](plan.md) — implementation architecture, milestones, and definition of done
- [`docs/threat-model.md`](docs/threat-model.md) — trust boundaries, invariants, and non-goals
- [`docs/resource-limits.md`](docs/resource-limits.md) — default and hard resource budgets
- [`docs/completeness.md`](docs/completeness.md) — required dimensions and failure mapping
- [`docs/rules.md`](docs/rules.md) — fact/heuristic/unknown taxonomy and stable rule IDs
- [`docs/analyzers.md`](docs/analyzers.md) — analyzer coverage, recursion, bounds, and limitations
- [`docs/herdr-contract.md`](docs/herdr-contract.md) — Herdr 0.8.0/protocol-19 public contract baseline
- [`docs/usage.md`](docs/usage.md) — install, quick start, popup, interpretation
- [`docs/json-integration.md`](docs/json-integration.md) — receipt schema, `receipt verify`, manager integration
- [`docs/limitations.md`](docs/limitations.md) — what X-Ray does not do
- [`docs/manual-smoke.md`](docs/manual-smoke.md) — three-platform smoke checklist
- [`docs/regression-corpus.md`](docs/regression-corpus.md) — pinned marketplace corpus
- [`docs/threat-model-checklist.md`](docs/threat-model-checklist.md) — invariant → test mapping
- [`schemas/receipt-v1.schema.json`](schemas/receipt-v1.schema.json) — draft trust-receipt schema
- `vendor/toml/PROVENANCE.md` — vendored parser source, license, hashes, and review

## Research

The product direction follows a metadata-complete review of the current Herdr marketplace:

- [`docs/herdr-marketplace-review.md`](docs/herdr-marketplace-review.md)
- [`docs/herdr-marketplace-inventory.tsv`](docs/herdr-marketplace-inventory.tsv)
- [`docs/herdr-plugin-notes.md`](docs/herdr-plugin-notes.md)

## Roadmap

1. **Milestone 0 — contracts and threat model:** complete
2. **Milestone 1 — fact-only CLI vertical slice:** complete
3. **Milestone 2 — bounded analyzers and findings:** complete
4. **Milestone 3 — installed comparison and trust receipts:** complete
5. **Milestone 4 — Herdr popup integration:** complete
6. **Milestone 5 — hardening and stable release:** complete (docs, corpus, 114 tests, 3-platform CI)

## License

Herdr X-Ray is MIT licensed. The vendored TOML parser retains its BSD-3-Clause license under [`vendor/toml/LICENSE`](vendor/toml/LICENSE).
