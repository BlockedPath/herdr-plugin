# Herdr X-Ray Rule Taxonomy

## Model

A rule converts analyzer evidence into a finding. Rules do not read files, fetch network resources, or render output.

Each finding has independent fields:

- `class`: `fact`, `heuristic`, or `unknown`
- `severity`: `info`, `low`, `medium`, or `high`
- `confidence`: `low`, `medium`, or `high`
- `category`: identity, execution, network, credential, filesystem, package, opaque, or dynamic

Severity describes review priority, not maliciousness. Confidence describes the evidence quality, not safety.

## Stable rule-ID format

```text
xray.<category>.<specific-behavior>
```

Rule IDs are append-only after stable v1. Changed semantics require a new ID or a rules-version increment documented in release notes.

## Initial registry

| Rule ID | Class | Default severity | Purpose |
| --- | --- | --- | --- |
| `xray.execution.install-build` | fact | high | Manifest declares install-time execution |
| `xray.execution.server-startup` | fact | high | Manifest declares Herdr server startup execution |
| `xray.execution.event-hook` | fact | medium | Manifest declares event-driven execution |
| `xray.execution.link-handler` | fact | low | Link clicks can invoke an action |
| `xray.execution.shell-inline-eval` | fact | high | Shell/cmd/PowerShell evaluates inline command text |
| `xray.execution.download-to-shell` | heuristic | high | Download output appears piped to an interpreter |
| `xray.execution.dynamic-subprocess` | unknown | high | Subprocess target or argv cannot be resolved statically |
| `xray.execution.dynamic-import` | unknown | medium | Import/source path is computed |
| `xray.execution.dynamic-code` | unknown | high | Runtime evaluation such as eval/exec is present |
| `xray.package.lifecycle-script` | fact | high | Package metadata exposes lifecycle execution |
| `xray.network.endpoint` | fact | medium | A statically resolved network destination is referenced |
| `xray.network.dynamic-endpoint` | unknown | medium | Network destination is computed or unresolved |
| `xray.credential.environment-read` | heuristic | high | Credential-like environment variable name is read |
| `xray.filesystem.external-write` | heuristic | high | A statically resolved write appears outside plugin config/state roots |
| `xray.filesystem.dynamic-write` | unknown | medium | Write destination cannot be resolved |
| `xray.opaque.native-binary` | unknown | high | Reachable native executable/library is opaque to X-Ray |
| `xray.opaque.wasm` | unknown | medium | Reachable WASM module is opaque to X-Ray |
| `xray.dynamic.missing-reference` | unknown | medium | Declared/reachable local path is missing |
| `xray.dynamic.external-symlink` | unknown | high | Source contains a referenced symlink/reparse edge |
| `xray.dynamic.unsupported-language` | unknown | medium | Reachable code uses an unsupported language |
| `xray.dynamic.submodule` | unknown | high | Reachable source depends on a Git submodule |
| `xray.dynamic.git-lfs` | unknown | high | Reachable file is an unresolved Git LFS pointer |
| `xray.dynamic.resource-limit` | unknown | high | Analysis stopped at an explicit limit |
| `xray.dynamic.unknown-manifest-field` | unknown | medium | Manifest contains a field whose execution semantics are unknown |
| `xray.identity.platforms-missing` | heuristic | low | Plugin omits an explicit top-level platform declaration |
| `xray.identity.plugin-id-collision` | heuristic | high | Distinct marketplace sources claim the same plugin ID |
| `xray.identity.source-changed` | fact | high | Installed and candidate plugin IDs match but source identity changed |
| `xray.identity.platform-changed` | fact | medium | Effective execution platforms changed |
| `xray.identity.herdr-version-changed` | fact | low | Minimum Herdr version changed |

## Evidence requirements

Every finding must include:

- Stable instance ID
- Rule ID and rules version
- Classification, severity, confidence, and category
- Neutral title and explanation
- At least one provenance record unless the finding is global
- Bounded redacted excerpt when useful
- Review guidance that does not imply safety

Global findings such as API truncation must identify the acquisition operation and limit that caused them.

## Rule-writing constraints

- Do not use attacker-supplied regular expressions.
- Matchers must be bounded by analyzer token/line limits.
- A negative match is not evidence that behavior is absent.
- Dynamic behavior becomes an unknown finding/edge.
- Duplicate evidence is deduplicated by normalized rule, subject, platform set, and provenance—not title text.
- Platform inheritance and item overrides must remain visible.

## Aggregate presentation

Reports may show counts by class, severity, category, and completeness. They must not calculate or display a safety/trust score.
