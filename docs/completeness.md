# Receipt Completeness Contract

## Core dimensions

Every receipt contains exactly these required core dimensions:

| Dimension | Question answered |
| --- | --- |
| `source` | Was the requested source resolved and acquired within network/filesystem bounds? |
| `manifest` | Was `herdr-plugin.toml` found, parsed, and structurally usable? |
| `executionGraph` | Were all manifest entrypoint declarations converted into platform-aware graph nodes/edges? |
| `reachableSource` | Were all statically resolved local references traced within depth/file/byte limits? |
| `analysis` | Did every enabled analyzer finish over the reachable surface without unsupported or dynamic behavior being silently omitted? |
| `cleanup` | Were all temporary source, analysis, and output artifacts removed or atomically promoted to their intended final path? |

Optional enrichment/operation dimensions:

- `marketplace` — marketplace collision lookup
- `comparison` — installed-versus-candidate comparison

Optional dimensions do not make a normal audit incomplete unless the caller explicitly required that operation. A `compare` command requires `comparison`; `--marketplace-check on` requires `marketplace`.

## Status values

- `complete` — the dimension completed within its declared scope and limits
- `partial` — useful results exist, but a limit, mutation, unsupported construct, or unresolved edge prevents completeness
- `unavailable` — the dimension produced no usable result

Every partial/unavailable status includes a neutral reason. `limit` names the controlling resource limit when applicable.

Top-level `complete: true` is valid only when:

- All six core dimensions are `complete`
- The source status is `resolved`
- Plugin identity was parsed
- At least one manifest provenance file exists
- `unstable` is false

## Failure mapping

| Condition | Dimension effects |
| --- | --- |
| Input rejected before acquisition | No receipt required; CLI usage exit 2 |
| GitHub ref not found / API unavailable before any object | `source: unavailable`; downstream core dimensions `unavailable` |
| GitHub rate/request/byte/time limit after partial metadata | `source: partial`; unavailable downstream dimensions remain explicit |
| GitHub recursive tree says `truncated: true` | `source: partial`; any graph/source results based on it cannot be top-level complete |
| Local root missing or unreadable | `source: unavailable`; downstream unavailable |
| Local mutation observed | `source: partial`, `unstable: true`; affected downstream dimensions partial/unavailable |
| Manifest missing | `manifest: unavailable`; graph/reachable/analysis unavailable; `plugin: null` |
| TOML parse/depth/byte failure | `manifest: unavailable`; graph/reachable/analysis unavailable; `plugin: null` |
| Unknown manifest field | `manifest: partial` when it can affect execution semantics; otherwise a forward-compatibility fact with complete parse |
| Unsupported entrypoint field/shape | `executionGraph: partial` |
| Missing referenced file | `reachableSource: partial` plus unknown finding/edge |
| Trace depth/file/byte/node/edge limit | The expansion dimension is `partial` plus `xray.dynamic.resource-limit` |
| Dynamic import/subprocess/path | `analysis: partial` plus explicit unknown edge/finding |
| Unsupported reachable language | `analysis: partial` plus `xray.dynamic.unsupported-language` |
| Native/WASM opaque target | `analysis: partial` plus opaque unknown finding |
| Marketplace offline/unavailable in `auto` mode | `marketplace: unavailable`; core completeness unchanged |
| Marketplace unavailable with `--marketplace-check on` | Required operation incomplete; exit 3 |
| Installed baseline unavailable for `compare` | `comparison: unavailable`; exit 3 |
| Candidate comparison succeeds but has findings | `comparison: complete`; policy may independently return exit 4 |
| No temporary artifacts were allocated | `cleanup: complete` |
| All temporary artifacts were removed/promoted | `cleanup: complete` |
| Temporary cleanup fails after any operation | `cleanup: partial`, top-level `complete: false`, and exit 3; preserve the primary failure and report residual paths only after redaction |

## Exit interaction

`--require-complete` requires all six core dimensions. Command-specific required dimensions are added as described above. Failure to meet required completeness returns exit 3 before finding-policy evaluation.

Unknown findings caused by genuinely dynamic behavior make `analysis` partial. Unknown findings from optional unavailable enrichment do not alter core completeness but remain visible.
