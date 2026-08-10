# Herdr X-Ray Threat Model

## Purpose

Herdr X-Ray inspects a Herdr plugin before installation or update. It reports declared execution entrypoints, bounded statically reachable behavior, heuristics, and unresolved edges. It does not prove that a plugin is safe or malicious.

## Security objective

An audit must not execute target-controlled code and must terminate within explicit resource bounds while producing an honest completeness record.

## Assets

X-Ray protects:

- The user account and host filesystem
- Environment variables and credentials
- Terminal integrity
- Herdr state and installed plugins
- Receipt integrity
- Availability of the X-Ray process
- Accuracy of the audit’s provenance and completeness claims

## Trust boundaries

### Trusted

- The X-Ray source and vendored TOML parser
- Node.js runtime
- Herdr 0.8.0 public CLI/API contract for Herdr-integrated workflows
- GitHub HTTPS origin identity as established by the runtime TLS stack

### Untrusted

- Repository owner, repository, subdirectory, ref, filenames, metadata, and blobs
- Plugin manifest fields and descriptions
- Local plugin contents
- Installed plugin contents
- Marketplace metadata
- Terminal dimensions and clicked URLs
- Receipt paths supplied by a CLI caller
- GitHub API status, truncation, rate-limit, and response bodies

### Cooperative local-filesystem assumption

Portable Node.js cannot provide `openat`-style containment against a concurrently malicious process swapping parent directories, symlinks, or Windows reparse points. Local and installed audits therefore assume the source tree is not actively racing X-Ray.

X-Ray still:

- Never intentionally follows symlinks or reparse points
- Rejects non-regular files
- Uses bounded file handles
- Rechecks metadata around reads
- Marks observed changes as unstable/incomplete

Protection from an active local attacker is out of scope for v1 and must not be implied by a receipt.

## Attacker capabilities

Assume a remote repository can contain:

- Malicious paths, control characters, invalid UTF-8, and Unicode bidi controls
- Huge trees, blobs, lines, and encoded payloads
- TOML/JSON parser edge cases
- Shell metacharacters and computed command strings
- Submodules and Git LFS pointers
- Native, WASM, or otherwise opaque binaries
- Markdown, JSON, ANSI, CSI, OSC, and hyperlink escape injection
- URLs containing credentials or secret-looking query parameters
- Deliberately expensive lexical patterns

Assume network behavior can include:

- Delays and hangs
- Oversized bodies despite a false or absent `Content-Length`
- Redirects
- Truncated GitHub tree responses
- Rate limiting
- Invalid JSON or base64

## Invariants

1. Target code is never imported, evaluated, launched, or loaded.
2. X-Ray never runs package managers or target build/install commands.
3. Remote source is read only through bounded GitHub REST metadata/blob requests.
4. Every HTTP body is streamed through an actual byte counter; `Content-Length` is only an early rejection signal.
5. HTTP redirects are refused and only exact `https://api.github.com` requests are allowed.
6. No authorization token, Git credential, or local credential helper is read in v1.
7. Herdr subprocesses use explicit argv arrays with `shell: false` and `HERDR_BIN_PATH`.
8. Untrusted values never become shell command strings.
9. Traversal never intentionally follows symlinks/reparse points; non-regular local entries are rejected.
10. Every read, request, file, byte, graph, depth, finding, output, and deadline dimension is bounded.
11. Every limit, unsupported construct, missing edge, API truncation, and observed mutation is represented in receipt completeness and, where useful, an unknown finding.
12. Untrusted terminal text has C0/C1 controls, ANSI/CSI/OSC sequences, bidi controls, and unsafe hyperlinks removed before rendering.
13. Markdown output escapes headings, tables, links, and dynamically chooses a safe code-fence length.
14. JSON mode writes only JSON to stdout; diagnostics go to stderr.
15. Persisted receipts redact absolute local paths, authorization material, URL secrets, environment values, and suspicious high-entropy excerpts.
16. Receipt storage uses hashed path components and atomic same-directory writes; target-controlled plugin IDs never become paths.
17. `receiptHash` covers every receipt field except itself. `analysisHash` covers a separately versioned stable projection.
18. Temporary directories/files containing source or receipt data are private, tracked by the operation, and removed in `finally` cleanup; cleanup failure is reported.
19. X-Ray sends no telemetry or audit results to a central service.

## Attack surfaces and controls

### Input parsing

- Parse GitHub inputs structurally; reject credentials, ports, query strings, fragments, and unsupported URL paths.
- Cap owner, repository, subdirectory, ref, and local-path lengths.
- Normalize receipt paths to relative `/` form without resolving target-controlled `..` outside a root.
- Use a reviewed complete TOML parser; never import the target manifest as code.

### GitHub acquisition

- Resolve a ref to a commit SHA, then address trees and blobs by validated hexadecimal SHA.
- Stream and cap commit, tree, and blob responses.
- Abort on redirect or origin change.
- Treat `truncated: true`, missing objects, invalid base64, and rate limits as incomplete.
- Keep request count, total bytes, operation-specific response bytes, decoded blob bytes, and wall-clock deadline independent.
- Keep remote blobs in bounded memory in v1; do not persist a source cache.

### Local acquisition

- `realpath` the requested root once.
- Traverse with `lstat`; do not descend into symbolic links/reparse points.
- Open only regular files and compare pre/post metadata.
- Refuse FIFOs, sockets, devices, and oversized files.
- Never scan `.git` by default.

### Static analysis

- Use fixed, reviewed lexical matchers with bounded line/token lengths.
- Avoid attacker-supplied regular expressions.
- Convert computed commands and unsupported syntax into unknown edges.
- Do not infer absence of behavior from an unsupported language.

### Rendering

- Sanitize before styling.
- Bound every excerpt and list.
- Avoid terminal hyperlinks derived from unvalidated URLs.
- Redact before persistence and hashing of the persisted receipt.

### Temporary data

- Prefer bounded in-memory acquisition and analysis for remote blobs.
- Create any required temporary directory with private permissions where supported.
- Register every temporary path with the owning audit operation before writing data.
- Remove temporary data in `finally` blocks on success, failure, timeout, and cancellation.
- Report cleanup failures to stderr and receipt completeness without replacing the primary failure.
- Never reuse a target-controlled temporary filename.

### State and receipts

- Derive directory names from SHA-256 values.
- Create private directories where supported.
- Refuse existing symlink/reparse/non-regular destinations.
- Write an exclusive temporary file, sync where available, then rename atomically.
- Never silently replace different content at a content-addressed destination.

## Explicit non-goals

X-Ray v1 does not:

- Sandbox or monitor plugin runtime behavior
- Audit transitive package dependency contents
- Query vulnerability or reputation databases
- Authenticate private GitHub requests
- Prove source authorship
- Cryptographically sign receipts
- Prevent attacks by a privileged or concurrently malicious local process
- Automatically install or update plugins
- Produce a safety score

## Security review gate

Before stable v1, every invariant above must have either:

- An automated unit/integration/security regression test, or
- A documented three-platform manual verification with residual risk

A limit breach, parser failure, unsupported edge, or unavailable enrichment must never produce a “complete” receipt.
