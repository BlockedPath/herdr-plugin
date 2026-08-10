# Herdr X-Ray Implementation Plan

## Product statement

**Herdr X-Ray** explains what a Herdr plugin can execute before a user installs or updates it.

> Fetch without executing, map the execution surface, compare it with the installed version, flag identity and capability changes, and produce a reproducible trust receipt.

Proposed repository name: `herdr-xray`  
Proposed plugin ID: `blockedpath.xray`  
Proposed tagline: **Pre-install execution graphs and trust receipts for Herdr plugins.**

## Confirmed product decisions

- Runtime: plain Node.js ESM
- npm runtime dependencies: none
- External runtime requirements: Node.js 20+; Herdr 0.8.0+ only for installed-plugin and popup workflows
- Remote acquisition: bounded GitHub REST Git-data requests; no local Git executable required
- Install-time build: none
- Minimum Node.js: 20
- Initial stable platforms: macOS, Linux, and Windows
- Audit depth: bounded tracing
- Product shape: reusable CLI core plus a Herdr popup
- Remote source scope: public GitHub repositories only in v1
- Target code execution: never
- Automatic plugin installation or update: not in v1

## Why this product

The complete Herdr marketplace review found 531 published manifests across 527 repositories. Plugin management, updates, orchestration, worktrees, status dashboards, usage meters, review panes, handoff, remote control, and voice are already crowded.

No listed plugin advertises the complete X-Ray workflow:

1. Fetch a candidate without executing it.
2. Compare it with the installed source and commit.
3. Semantically diff manifest entrypoints and reachable commands.
4. Trace directly referenced scripts and bounded subprocess edges.
5. Distinguish facts, heuristics, and unresolved behavior.
6. Detect plugin-ID and source-owner collisions.
7. Emit human-readable and machine-readable trust receipts before an unattended install.

The marketplace also contains seven plugin IDs claimed by unrelated repositories. Several existing managers perform updates with `herdr plugin install --yes`, making a pre-update policy seam concrete rather than hypothetical.

See:

- [`docs/herdr-marketplace-review.md`](docs/herdr-marketplace-review.md)
- [`docs/herdr-marketplace-inventory.tsv`](docs/herdr-marketplace-inventory.tsv)
- [`docs/herdr-plugin-notes.md`](docs/herdr-plugin-notes.md)

## Product principles

### 1. Report evidence, not safety

X-Ray must never label a plugin “safe,” “malicious,” or “trusted.” Static analysis cannot prove those claims.

Every result belongs to one of three classes:

- **Fact** — directly declared or statically demonstrated
- **Heuristic** — a pattern that deserves review but may be benign
- **Unknown** — behavior X-Ray could not resolve within its language or resource limits

Severity and confidence are separate fields. A high-confidence fact is not automatically high risk, and a high-severity heuristic is not proof of harm.

### 2. Audit without executing

X-Ray must not:

- Run target build, startup, action, event, pane, or link-handler commands
- Run package managers
- Import target JavaScript
- Load target native libraries
- Execute target scripts to discover behavior
- Expand archives supplied by the target
- Initialize submodules or Git LFS

### 3. Preserve unknown edges

Dynamic code must not silently disappear from the report. Unsupported languages, computed subprocess commands, external symlinks, missing files, submodules, generated code, and opaque binaries become explicit unknown graph nodes.

### 4. Keep the auditor auditable

X-Ray itself should ship as readable ESM with:

- No `[[build]]` hook
- No `[[startup]]` hook
- No npm runtime dependencies
- No telemetry
- No automatic updates or installs
- No credential collection

A small TOML parser may be vendored only after source, license, transitive dependency, and behavior review. Its source and provenance must be committed and documented. Do not write a partial ad hoc TOML parser.

### 5. One analysis artifact, multiple renderers

The analysis engine produces one versioned receipt object. Terminal, Markdown, JSON, and popup views render that object; they do not independently analyze source.

## User workflows

### Audit a GitHub plugin

```bash
herdr-xray audit owner/repo[/subdir] --ref <branch-tag-or-sha>
```

### Audit a local checkout

```bash
herdr-xray audit ./path/to/plugin
```

### Audit an installed plugin

```bash
herdr-xray audit-installed <plugin-id>
```

### Compare an installed plugin with a candidate

```bash
herdr-xray compare <plugin-id> owner/repo[/subdir] --ref <ref>
```

### Produce machine-readable output

```bash
herdr-xray audit owner/repo --format json --output receipt.json
herdr-xray compare plugin.id owner/repo --format markdown --output update-review.md
```

The binary name above is the CLI contract. A Herdr-managed install may initially expose it through the plugin root rather than placing a global executable on `PATH`. Global npm distribution can be added after the core interface stabilizes.

## CLI contract

### Commands

```text
herdr-xray audit <source>
herdr-xray audit-installed <plugin-id>
herdr-xray compare <plugin-id> <source>
herdr-xray marketplace-collisions
herdr-xray receipt verify <path>
herdr-xray version
```

### Common options

```text
--ref <ref>
--format terminal|json|markdown
--output <path>
--offline
--marketplace-check auto|on|off
--redaction strict|standard
--fail-on-severity low|medium|high
--fail-on-unknown
--require-complete
--max-files <n>
--max-total-bytes <n>
--max-file-bytes <n>
--max-depth <n>
--timeout-ms <n>
```

Defaults must remain conservative and usable. Resource-limit overrides should be bounded by hard maximums.

### Output discipline

- JSON output writes only JSON to stdout.
- Diagnostics, progress, and warnings go to stderr.
- Terminal output removes ANSI/control sequences from untrusted source text before applying X-Ray’s own styling.
- Markdown escapes untrusted headings, links, tables, and code fences.
- Absolute local paths and credential-like values are redacted from persisted receipts.

### Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Analysis completed; findings are contained in the output |
| 2 | CLI usage error |
| 3 | Acquisition/internal execution failed, the manifest could not be parsed, or required completeness was not achieved |
| 4 | A completed analysis reached an explicitly selected severity/unknown policy threshold |
| 5 | Receipt verification failed |

Default execution must not convert subjective findings into a failing exit code. Automation opts into policy failure through `--fail-on-severity`, `--fail-on-unknown`, or `--require-complete`.

Exit precedence is deterministic: CLI usage errors return 2; acquisition/parse failures and unmet required completeness return 3; policy threshold failure returns 4 only after analysis completed to the requested completeness; receipt verification failure returns 5 only for `receipt verify`.

## Architecture

```text
CLI / Herdr popup
        │
        ▼
Input resolver
  ├─ GitHub source
  ├─ local directory
  └─ installed plugin
        │
        ▼
Source abstraction
  ├─ GitObjectSource
  └─ ContainedFilesystemSource
        │
        ▼
Manifest parser + validator
        │
        ▼
Execution graph builder
        │
        ▼
Bounded analyzers
        │
        ▼
Finding/rule engine
        │
        ├─ marketplace collision enrichment
        ├─ installed-version comparison
        └─ receipt canonicalization
              │
              ├─ terminal renderer
              ├─ Markdown renderer
              ├─ JSON renderer
              └─ popup renderer
```

## Proposed repository layout

```text
herdr-plugin.toml
package.json
LICENSE
README.md
plan.md
bin/
  herdr-xray.mjs
src/
  cli/
    main.mjs
    args.mjs
    exit-codes.mjs
  source/
    input.mjs
    github.mjs
    github-rest-source.mjs
    filesystem-source.mjs
    installed.mjs
    limits.mjs
  manifest/
    parse.mjs
    validate.mjs
    normalize.mjs
  graph/
    model.mjs
    build.mjs
    ids.mjs
  analyzers/
    command.mjs
    package-json.mjs
    shell.mjs
    javascript.mjs
    python.mjs
    powershell.mjs
    batch.mjs
    generic-text.mjs
    binary.mjs
  rules/
    registry.mjs
    identity.mjs
    automatic-execution.mjs
    shell-eval.mjs
    network.mjs
    credentials.mjs
    filesystem.mjs
    package-lifecycle.mjs
    opaque-code.mjs
    dynamic-edges.mjs
  compare/
    installed.mjs
    manifest-diff.mjs
    graph-diff.mjs
    finding-diff.mjs
  marketplace/
    fetch-index.mjs
    collisions.mjs
    cache.mjs
  receipt/
    schema.mjs
    canonicalize.mjs
    hash.mjs
    redact.mjs
    verify.mjs
  render/
    terminal.mjs
    markdown.mjs
    json.mjs
  ui/
    open.mjs
    popup.mjs
    input.mjs
    report-view.mjs
  herdr/
    cli.mjs
    context.mjs
vendor/
  toml/
    parser.mjs
    LICENSE
    PROVENANCE.md
schemas/
  receipt-v1.schema.json
test/
  fixtures/
  unit/
  integration/
  security/
```

Module boundaries are intentional:

- Source adapters expose files; analyzers never know how source was acquired.
- Analyzers emit facts and unknown edges; they do not render output.
- Rules turn evidence into findings; they do not read files directly.
- Comparison operates on normalized receipts rather than renderer text.
- Renderers are pure functions over a receipt.
- The popup calls the same CLI/core entrypoint used by automation.

## Secure source acquisition

### GitHub source

Accepted remote forms in v1:

- `owner/repo`
- `owner/repo/subdir`
- `https://github.com/owner/repo`
- Optional ref supplied separately with `--ref`

Do not accept arbitrary Git URLs, SSH URLs, `file:` URLs, local Git transports, or GitHub tree/blob/issue/PR URLs in v1.

Remote acquisition uses GitHub’s public REST Git-data APIs through Node’s `fetch`; it does not invoke Git or check out repository files:

1. Structurally parse and validate owner, repository, optional subdirectory, and ref.
2. Resolve the requested ref to an exact commit SHA through the commits API.
3. Fetch the commit tree recursively with a hard response-byte cap.
4. Reject or mark incomplete a truncated GitHub tree response.
5. Locate the manifest and build a bounded tree index.
6. Fetch only the manifest, package metadata, and graph-reachable blobs by validated GitHub blob SHA.
7. Decode bounded blob responses in memory; never write or execute target files.
8. Never initialize submodules or Git LFS; represent them as unknown edges.

Every HTTP response is streamed through both `Content-Length` prechecks and an actual byte-counting reader. Requests use `redirect: "manual"`, an allowlisted `https://api.github.com` origin, abort deadlines, a request-count budget, and bounded headers/error bodies. No authorization header or local credential is read in v1. Rate-limit exhaustion produces an explicit incomplete/unknown result.

Refs are URL-encoded as data and are never used as Git refspecs or command arguments. Reject control characters and excessive length. Record requested ref and resolved commit separately.

Default GitHub budgets must be specified in Milestone 0, including total response bytes, tree bytes, blob count, blob bytes, request count, redirect count of zero, and wall-clock deadline. A response that exceeds a budget is aborted and reported as incomplete rather than partially trusted.

### Local and installed source

Use a contained filesystem adapter under a cooperative-filesystem contract:

- Resolve the root with `realpath`.
- Never intentionally follow symlinks or Windows reparse points during traversal; report each as an unknown edge.
- Reject FIFOs, sockets, devices, and every non-regular entry.
- Open and read bounded regular-file handles rather than trusting pre-read metadata alone.
- Detect loops and repeated identities where the platform exposes them.
- Use relative POSIX-style paths in receipts.
- Recheck file metadata around reads and mark a local audit unstable if files or parent directories changed during analysis.
- Never read `.git`, plugin state, or credential directories unless they are explicitly inside and referenced by the plugin package.

Portable Node APIs cannot guarantee containment against a concurrently malicious process swapping parents or reparse points. Local and installed audits therefore promise a best-effort snapshot of a cooperative filesystem, not isolation from an active local attacker. Any observed mutation makes the receipt unstable/incomplete.

Installed plugin metadata comes from:

```bash
herdr plugin list --json
```

Use the public CLI response rather than reading Herdr’s private registry format. If the Herdr binary or installed metadata is unavailable, installed comparison fails explicitly instead of guessing paths.

Milestone 0 must capture and commit sanitized Herdr 0.8.0/protocol-19 contract fixtures proving the required `plugin list --json` fields: `plugin_id`, `manifest_path`, `plugin_root`, and GitHub source `owner`, `repo`, and `resolved_commit`; `subdir` and `requested_ref` are optional when absent from Herdr output. It must also capture the public `plugin.pane.open` schema proving its `env` object. Runtime adapters validate these fields and fail closed on incompatible response shapes.

## Manifest handling

Parse complete TOML through a reviewed vendored parser. Validate X-Ray’s normalized manifest model against the installed Herdr 0.8.0 public schema and documented plugin fields:

- Top-level identity and platforms
- `[[build]]`
- `[[startup]]`
- `[[actions]]`
- `[[events]]`
- `[[panes]]`
- `[[link_handlers]]`

Preserve:

- Original argv token boundaries
- Item-level platform overrides
- Manifest order
- Source path and line evidence when available
- Unknown top-level fields for forward-compatibility reporting

Fatal manifest parse errors stop graph construction but still produce a bounded incomplete receipt when possible.

## Execution graph

### Node types

- Plugin identity
- Trigger
- Command invocation
- Script/source file
- Package lifecycle script
- Subprocess invocation
- Network endpoint
- Environment variable
- Filesystem path/capability
- Native/opaque binary
- Unknown dynamic edge

### Trigger types

- Install build
- Server startup
- Manual action
- Herdr event
- Plugin pane
- Link click

### Edge types

- Declares
- Invokes
- Imports/sources
- Spawns
- Reads environment
- Reads/writes path
- Connects to
- Resolves dynamically
- Could not resolve

Every trigger, command node, and invocation edge carries normalized `effectivePlatforms` after top-level inheritance and item-level override. Every graph edge also carries provenance: manifest declaration identity/index, relative path, line/column when known, rule/analyzer ID, and confidence.

Stable node IDs derive from normalized node type, subject identity, and effective platform set—not array position—so candidate-versus-installed diffs remain useful when manifest entries reorder. Preserve duplicate declarations as distinct provenance records even when their normalized commands match.

## Bounded analysis

### Initial language support

| Surface | MVP handling |
| --- | --- |
| Manifest argv | Exact parsing/classification |
| `package.json` | Exact JSON parsing and lifecycle-script extraction |
| Shell scripts | Conservative lexical tracing and heuristics |
| JavaScript/ESM/CommonJS | Relative import, process, network, env, and filesystem heuristics |
| Python | Import, subprocess, network, env, and filesystem heuristics |
| PowerShell | Invocation, download, env, and filesystem heuristics |
| Batch/CMD | Invocation, download, env, and filesystem heuristics |
| Native/WASM binaries | Magic/hash/type fact plus opaque unknown edge |
| Other source languages | Generic URL/env/path scan plus explicit unsupported-language unknown |

The MVP does not promise a complete AST for every language. Fixed lexical rules must avoid executing code, cap line and token lengths, and report computed expressions as unknown.

### Command classification

Recognize at minimum:

- Shells and inline evaluation flags: `sh -c`, `bash -c`, `cmd /c`, PowerShell `-Command`
- Interpreters and local script arguments
- Package managers and install/build commands
- Downloaders and network clients
- Relative executable paths
- Direct native binaries
- Common subprocess APIs
- `eval`, encoded-to-shell, dynamic import, and command construction indicators

### Default resource limits

Initial values should be validated with representative plugins before being frozen:

```text
files enumerated       10,000
files analyzed          2,000
analysis bytes         20 MiB
manifest bytes          1 MiB
TOML nesting depth          64
single text file        1 MiB
single binary hash     20 MiB
trace depth                 4
execution graph nodes    2,000
findings                 1,000
HTTP/Herdr timeout       60s
GitHub request count       48
GitHub source bytes      24 MiB
GitHub tree response      8 MiB
GitHub blob response      2 MiB
GitHub decoded blob       1 MiB
```

Hitting a limit creates an explicit unknown/incomplete finding. It must never silently truncate the graph.

## Findings model

Each finding contains:

```json
{
  "id": "stable-instance-id",
  "ruleId": "xray.shell.inline-eval",
  "class": "fact | heuristic | unknown",
  "severity": "info | low | medium | high",
  "confidence": "low | medium | high",
  "category": "identity | execution | network | credential | filesystem | package | opaque | dynamic",
  "title": "Shell evaluates an inline command",
  "explanation": "Why this matters without claiming malicious intent",
  "evidence": [
    {
      "path": "scripts/install.sh",
      "line": 14,
      "column": 3,
      "excerpt": "redacted and bounded"
    }
  ],
  "remediation": "What the user should inspect"
}
```

Initial high-value rules:

- Build/startup automatic execution
- Event-driven recurring execution
- Shell inline evaluation
- Pipe/download-to-shell patterns
- Package lifecycle scripts
- Network destinations
- Credential-like environment-variable access
- Writes outside plugin config/state paths
- Invocation of opaque native binaries
- Dynamic subprocess construction
- Missing referenced files
- External symlink edges
- Unsupported analyzable language
- Submodule/LFS dependency
- Plugin ID collision
- Installed source owner/repository change
- Minimum Herdr/platform compatibility changes

No aggregate safety score in v1.

## Marketplace collision check

When online and enabled:

1. Fetch the canonical `https://herdr.dev/plugins/` marketplace page.
2. Extract the embedded JSON data without executing page JavaScript.
3. Validate schema/version and apply response-size limits.
4. Cache only the marketplace metadata under `HERDR_PLUGIN_STATE_DIR` with generated timestamp and content hash.
5. Match normalized plugin IDs to repositories/manifests.
6. Report every distinct source claiming the candidate ID.

The marketplace is unreviewed evidence, not authority. Network failure degrades to a clear “collision check unavailable” unknown unless `--marketplace-check on` made it required.

## Installed comparison

Compare candidate and installed analyses produced by the same X-Ray/rules version.

### Identity diff

- Plugin ID
- Name/version
- GitHub owner/repository/subdirectory
- Requested/resolved commit
- Minimum Herdr version
- Platforms

### Execution-surface diff

- Added/removed/changed triggers
- Added/removed/changed argv commands
- Added/removed reachable scripts
- Added/removed subprocess edges
- Added/removed network destinations
- Added/removed credential-variable access
- Added/removed external write indicators
- Added/removed opaque binaries
- Added/removed unknown dynamic edges

### Reachable-file diff

Hash only files reached by the bounded graph plus manifest/package metadata. Do not imply that unchanged reachable files mean the whole repository is unchanged.

Prominently flag:

- Same plugin ID from a different owner/repository
- New build or startup entrypoint
- New automatic event hook
- New shell interpreter/eval boundary
- New network destination
- New credential-like variable access
- New opaque binary
- Increased unknown/incomplete surface

## Trust receipt

### Receipt schema v1

```json
{
  "schemaVersion": 1,
  "tool": {
    "name": "herdr-xray",
    "version": "0.1.0",
    "rulesVersion": 1
  },
  "generatedAt": "ISO-8601",
  "subject": {
    "source": {},
    "plugin": {},
    "installedBaseline": null
  },
  "limits": {},
  "completeness": {},
  "summary": {},
  "graph": {
    "nodes": [],
    "edges": []
  },
  "findings": [],
  "comparison": null,
  "provenance": {},
  "analysisHash": "sha256:...",
  "receiptHash": "sha256:..."
}
```

### Receipt requirements

- Publish and test `schemas/receipt-v1.schema.json`.
- Canonicalize map keys and stable arrays before hashing.
- Define `receiptHash` as an integrity hash over every receipt field except `receiptHash` itself; any mutation, including `generatedAt`, must invalidate it.
- Define a separate `analysisHash` over a versioned stable projection that excludes explicitly documented volatile and online-enrichment fields.
- Include source/ref/commit, X-Ray version, rules version, limits, and completeness.
- Redact absolute local paths, environment values, authorization material, URL query secrets, and suspicious high-entropy strings.
- Bound excerpts and finding counts.
- Include file hashes for analyzed/reachable files.
- Verify hash and schema through `receipt verify`.
- A receipt records what X-Ray observed; it is not a signature or attestation.

Receipts created through the popup are stored under a safe state root:

```text
<state-root>/receipts/<sha256-plugin-id>/<sha256-subject>/receipt.json
```

The original plugin ID remains inside validated receipt metadata and is never used as a path component. State-root resolution is explicit:

- Herdr execution: `HERDR_PLUGIN_STATE_DIR`
- Linux standalone: `${XDG_STATE_HOME:-~/.local/state}/herdr-xray`
- macOS standalone: `~/Library/Application Support/herdr-xray/state`
- Windows standalone: `%LOCALAPPDATA%\\herdr-xray\\state`

Writes use a private directory where supported, a same-directory temporary file opened exclusively, file sync where available, and atomic rename. Existing symlinks/reparse points or unexpected non-regular targets cause refusal. Concurrent writers use content-addressed destinations and never overwrite a different receipt silently.

## Herdr integration

### Manifest shape

X-Ray should have no build, startup, or event hooks in its own manifest.

```toml
id = "blockedpath.xray"
name = "Herdr X-Ray"
version = "0.1.0"
min_herdr_version = "0.8.0"
description = "Pre-install execution graphs and trust receipts for Herdr plugins."
platforms = ["linux", "macos", "windows"]

[[actions]]
id = "open"
title = "X-Ray: audit a plugin"
contexts = ["workspace", "pane"]
command = ["node", "src/ui/open.mjs"]

[[actions]]
id = "audit-installed"
title = "X-Ray: audit installed plugin"
contexts = ["workspace", "pane"]
command = ["node", "src/ui/open.mjs", "--installed"]

[[panes]]
id = "xray"
title = "Herdr X-Ray"
placement = "popup"
width = "90%"
height = "85%"
command = ["node", "src/ui/popup.mjs"]

[[link_handlers]]
id = "github-plugin"
title = "Audit GitHub plugin with X-Ray"
pattern = "^https://github\\.com/[^/?#]+/[^/?#]+/?$"
action = "open"
```

The link action reads `HERDR_PLUGIN_CLICKED_URL`, structurally parses it, and requires HTTPS, exact host `github.com`, no credentials, no custom port, no query/fragment, and exactly two non-empty path segments (an optional `.git` suffix may be normalized). It does not infer refs or subdirectories from `/tree/`, `/blob/`, issue, or pull-request URLs. The action opens the declared popup with the source passed through the public `plugin pane open --env` facility. All Herdr subprocess calls use `HERDR_BIN_PATH` and `shell: false`.

### Popup MVP

Screens:

1. Choose source: GitHub, local, installed, compare
2. Enter/select source and optional ref
3. Acquisition progress
4. Summary
5. Execution graph
6. Findings
7. Candidate-versus-installed changes
8. Export receipt

Controls:

- Arrow keys or `j`/`k`
- Enter
- Tab/Shift+Tab where appropriate
- `/` search/filter in report lists
- `e` export
- `q`/Escape close

Mouse support is desirable but deferred until keyboard behavior and accessibility are stable. The popup must remain usable at narrow terminal widths and must not rely on Kitty graphics.

The popup does not offer an “Install” button in v1. It may print a commit-pinned command for the user to review and execute separately:

```bash
herdr plugin install owner/repo/subdir --ref <resolved-sha>
```

## Threat model and security invariants

Assume the audited repository intentionally tries to attack the auditor through:

- Malicious filenames and paths
- Symlink escape and loops
- Huge files or repository trees
- Invalid UTF-8
- ANSI/control characters and terminal escape injection
- Unicode bidi/confusable text
- Catastrophic regex inputs
- Shell metacharacters in source/ref/path values
- Dynamic code and encoded payloads
- Git submodules/LFS pointers
- Native binaries
- Markdown/JSON injection
- GitHub API truncation, rate limits, redirects, hangs, and oversized responses
- Local source changes during analysis
- Concurrent local parent/symlink/reparse-point mutation outside the cooperative-filesystem guarantee

Required invariants:

1. No target-controlled text reaches a shell command string.
2. Every subprocess uses an argv array and `shell: false`.
3. Target code is never imported or executed.
4. Remote GitHub source is read only as bounded API metadata/blobs and is never checked out.
5. Local traversal never intentionally follows symlinks/reparse points; observed mutation or ambiguous containment marks the audit unstable/incomplete rather than claiming adversarial isolation.
6. Every read, graph, finding, output, process, request count, response byte count, and network deadline is bounded.
7. Every truncation or unsupported edge becomes visible in completeness/unknown output.
8. Untrusted terminal text is sanitized before rendering.
9. Persisted receipts are redacted and use relative source paths.
10. Temporary source data is private and cleaned up.
11. Network fetches do not forward credentials to untrusted origins.
12. No telemetry or audit result leaves the machine.

Before implementation, write `docs/threat-model.md` from these invariants and make it part of review acceptance.

## Cross-platform requirements

### All platforms

- Use `node:` APIs and argv spawning only.
- Use `path`, `url`, and `os` rather than manual separators.
- Normalize receipt paths to relative `/` separators.
- Use `fs.mkdtemp` under `os.tmpdir()` with private permissions where supported.
- Use `process.execPath` when X-Ray launches its own Node child process.
- Avoid Unix signals as the only cancellation mechanism.
- Sanitize CRLF and terminal mode differences.
- Do not require Bash, Python, jq, curl, sed, or awk.

### Windows

- Support drive-letter and UNC local paths.
- Never depend on executable file mode bits.
- Detect `.exe`, `.dll`, `.cmd`, `.bat`, and `.ps1` explicitly.
- Test `PATHEXT`, spaces, Unicode paths, and long paths.
- Handle named-pipe Herdr access only through `HERDR_BIN_PATH`; do not implement raw socket transport.
- Ensure timeouts terminate or detach Herdr child processes predictably.

### macOS/Linux

- Detect Mach-O and ELF binaries.
- Test symlink containment and executable shebang handling.

## Testing strategy

Use only `node:test`, `node:assert`, and project-owned fixture helpers.

### Unit tests

- CLI parsing and exit codes
- Input normalization and rejection
- Manifest parsing/validation/normalization
- Stable graph IDs
- Every analyzer and rule
- Redaction
- Receipt canonicalization/hash/verification
- Manifest, graph, finding, and identity diffs
- Terminal and Markdown escaping

### Fixture tests

Create fixtures for:

- Minimal valid plugin
- Every manifest entrypoint type
- Platform inheritance/override
- Unknown manifest fields
- Malformed TOML
- Missing referenced script
- Shell inline execution
- Download-to-shell
- JavaScript static and dynamic subprocess calls
- Python subprocess/network/env access
- PowerShell download/execute
- Batch command execution
- Package lifecycle scripts
- Native ELF, Mach-O, PE, and WASM signatures
- External and looping symlinks
- Submodule/LFS pointers
- Invalid UTF-8 and control characters
- Oversized tree/file/graph limits
- Duplicate plugin IDs
- Same ID with changed source owner
- Candidate-versus-installed execution changes

### Integration tests

- Mocked GitHub commit/tree/blob API acquisition with capped streaming responses
- Truncated tree, rate-limit, redirect, timeout, oversized-response, and request-budget behavior
- Local filesystem source with spaces and Unicode
- Fake Herdr binary returning `plugin list --json`
- Popup-open command construction without invoking real target code
- Marketplace page fixture extraction and collision matching
- Clean JSON stdout with diagnostics on stderr
- Receipt round-trip through every renderer

### Security regression tests

- Ref beginning with `-`
- Shell metacharacters in all user inputs
- Repository paths containing newlines/control characters
- ANSI/OSC escape injection
- Markdown fence and link injection
- Symlink race/escape
- Huge line and regex stress
- URL credentials/query-secret redaction
- GitHub redirect/origin/header isolation
- GitHub response and request-count exhaustion
- Local source mutation during audit
- Output path traversal

### CI matrix

Run on:

- Ubuntu latest
- macOS latest
- Windows latest
- Node 20, current LTS, and current stable where practical

Required checks:

```bash
node --check bin/herdr-xray.mjs
node --test
node bin/herdr-xray.mjs version
```

Add a test that rejects any runtime dependency in `package.json` and any `[[build]]`/`[[startup]]` entry in X-Ray’s own manifest.

Network tests should not gate pull requests. A scheduled/manual job may audit pinned public plugin commits and compare sanitized fixtures for upstream drift.

## Milestones

## Milestone 0 — Contract and threat model

Deliver:

- README product contract
- `docs/threat-model.md`
- Receipt v1 draft schema
- Rule taxonomy
- CLI help/exit-code contract
- Default and hard resource limits, including GitHub request/response budgets
- Sanitized Herdr 0.8.0/protocol-19 CLI/API contract fixtures
- Vendored TOML parser selection, license, provenance, and validation fixtures

Acceptance gate:

- No unresolved decision about what “audit without executing” permits.
- Every failure/truncation path maps to a visible receipt completeness state.
- TOML parser handles every official/example Herdr manifest fixture.
- Cross-platform subprocess and path rules are written before acquisition code.
- GitHub acquisition has an exact bounded request contract and does not invoke Git.
- Herdr installed-source and popup-env assumptions are attested by committed public-schema fixtures.
- Cooperative local-filesystem guarantees and adversarial exclusions are explicit.

## Milestone 1 — Fact-only CLI vertical slice

Deliver:

- `audit` for local directory and GitHub shorthand/ref
- Contained filesystem source
- Bounded GitHub REST Git-data source
- Manifest parsing and validation
- Trigger/command execution graph
- Terminal and JSON output
- Resource limits and incomplete-state reporting

Acceptance gate:

- Audits official example manifests without executing target code.
- GitHub acquisition performs no checkout, Git invocation, submodule, LFS, or package command.
- Oversized/truncated/rate-limited GitHub responses fail visibly and within hard byte/request/time budgets.
- Malicious source/ref/path fixtures never alter URL structure or subprocess argv boundaries.
- JSON stdout is machine-clean.
- Linux, macOS, and Windows CI pass.

## Milestone 2 — Bounded analyzers and findings

Deliver:

- Package JSON, shell, JavaScript, Python, PowerShell, Batch, binary, and generic analyzers
- Fact/heuristic/unknown finding model
- Provenance and stable rule IDs
- Terminal and Markdown reports
- Redaction and terminal/Markdown sanitization

Acceptance gate:

- Every analyzer has positive, negative, dynamic-edge, and resource-limit fixtures.
- Unsupported or computed behavior appears as unknown, never as absence.
- No aggregate safety score or maliciousness claim appears in output.
- Renderers produce equivalent summaries from the same receipt.

## Milestone 3 — Installed comparison and trust receipts

Deliver:

- `audit-installed`
- `compare`
- Public Herdr CLI adapter using `plugin list --json`
- Identity, manifest, graph, capability, and unknown-surface diff
- Receipt v1 canonicalization, hash, schema, verification, and persistence
- Marketplace collision check and cache

Acceptance gate:

- Same-ID/different-owner is prominent and machine-readable.
- New build/startup/event/network/credential/binary/unknown edges are separately reported.
- Candidate and installed versions are analyzed with the same rules version.
- `receiptHash` catches mutation to every field; `analysisHash` remains stable across documented volatile/enrichment changes.
- Receipt storage uses hashed path components and atomic, no-follow writes on all platforms.
- Offline mode is deterministic and clearly marks unavailable enrichment.

## Milestone 4 — Herdr popup integration

Deliver:

- `herdr-plugin.toml` with actions, popup pane, and repository-root-only GitHub link handler
- Source picker and installed-plugin selector
- Report navigation and filtering
- Export flow
- Commit-pinned install command display
- Responsive narrow-terminal rendering

Acceptance gate:

- X-Ray’s manifest contains no build/startup/event hook.
- Only structurally valid repository-root GitHub URLs reach the popup as data, never shell syntax.
- Closing or cancelling cleans temporary data.
- The popup does not install or update plugins.
- Keyboard-only operation works on all three platforms.

## Milestone 5 — Hardening and stable release

Deliver:

- Full three-platform CI and manual smoke checklist
- Representative pinned-plugin regression corpus
- Security review against `docs/threat-model.md`
- Performance/limit tuning
- Installation, usage, interpretation, and limitations documentation
- JSON integration guide for plugin managers
- Release process with commit-pinned examples

Acceptance gate:

- All threat-model invariants have a test or documented manual verification.
- No npm runtime dependencies or install build commands exist.
- Audit results contain no secrets from fixtures.
- Large/malformed repositories fail boundedly.
- Existing plugin managers can consume JSON receipts without scraping terminal output.
- Residual limitations are explicit in README and receipts.

## Deferred until after stable v1

- Automatic install/update after approval
- Plugin-manager UI replacement
- Mandatory manager policy enforcement
- Deep transitive npm/pip/cargo dependency auditing
- CVE databases or reputation services
- Non-GitHub remote Git sources
- Private GitHub repositories and OAuth
- Arbitrary custom Git credentials
- Full multi-language AST framework
- Native GUI
- Centralized receipt service or telemetry
- Cryptographic signing/attestation
- Sandboxing target plugins
- Runtime command interception
- Automatic safety score
- Mouse-first popup controls

## Definition of done for v1

Herdr X-Ray v1 is complete when a user on macOS, Linux, or Windows can:

1. Open X-Ray from Herdr or call its CLI.
2. Audit a public GitHub, local, or installed plugin without executing target code.
3. See every manifest trigger and normalized argv command.
4. See bounded reachable-script facts, heuristics, explicit unknowns, effective platform scope, and completeness limits.
5. Compare a candidate with an installed plugin through an attested Herdr 0.8.0 public CLI contract.
6. Receive prominent plugin-ID/source collision warnings.
7. Export a redacted, versioned, verifiable JSON or Markdown receipt.
8. Obtain a commit-pinned install command without X-Ray running it.
9. Understand from the report exactly what was analyzed, skipped, truncated, or unresolved.

The implementation is not done if it relies on a safety score, silently drops unknown behavior, requires an install-time build, executes target code, or supports only Unix assumptions while claiming Windows support.
