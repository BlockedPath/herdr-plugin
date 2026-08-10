# Limitations — Herdr X-Ray v0.1.0

X-Ray is evidence, not a safety proof.

- **Lexical, not semantic:** analyzers are bounded regex/token scanners with `singleLineBytes`/`linesPerFile` caps. Computed strings (`fetch(endpoint)`), `eval`/`exec` with indirection, and unsupported languages become `unknown` — not absence.
- **Local filesystem is cooperative:** `realpath` + `lstat`/`O_NOFOLLOW` + `verifyStable` detect mutation and mark `unstable`/`partial`, but a concurrently racing local attacker can still swap parents/reparse points. No `openat` isolation on portable Node.
- **No transitive deps:** `package.json` `dependencies` lifecycle scripts are flagged, but `node_modules`/`pip`/`cargo` trees are not recursively audited.
- **No reputation/CVE DB:** no network reputation, CVE, or authorship attestation; `marketplace` is unreviewed evidence with `marketplace: unavailable` when offline.
- **No private GitHub:** no token/credential helper; only public `https://api.github.com` with `githubRequests`/`githubTotalResponseBytes`/`timeoutMs` budgets. `truncated: true` trees and rate limits produce `source: partial`.
- **Opaque binaries:** ELF/PE/Mach-O/WASM are `unknown` with hash, not disassembled.
- **Platform scope:** `effectivePlatforms` is manifest-declared; runtime `process.platform` filtering is not simulated.
- **Receipts are not signatures:** `receiptHash`/`analysisHash` are integrity hashes over canonical JSON, not cryptographic signatures.
