# Herdr X-Ray Resource Limits

## Principles

- Every attacker-controlled dimension has a default and a hard maximum.
- A caller may lower limits freely and raise them only to the hard maximum.
- Crossing a limit aborts the affected operation promptly.
- Limit exhaustion appears in receipt completeness and as `xray.dynamic.resource-limit` when it affects interpretation.
- Partial output must not be described as complete.

## Initial limits

These values are the Milestone 0 contract. Representative-plugin measurement may lower defaults before stable v1; raising hard limits requires threat-model review.

| Dimension | Default | Hard maximum |
| --- | ---: | ---: |
| Wall-clock audit deadline | 60 s | 300 s |
| GitHub requests | 48 | 128 |
| GitHub source total response bytes | 24 MiB | 96 MiB |
| GitHub commit response | 1 MiB | 2 MiB |
| GitHub recursive tree response | 8 MiB | 8 MiB |
| GitHub encoded blob response | 2 MiB | 8 MiB |
| GitHub decoded blob | 1 MiB | 5 MiB |
| GitHub error response | 64 KiB | 256 KiB |
| GitHub fetched blobs | 40 | 120 |
| Files enumerated | 10,000 | 50,000 |
| Files analyzed | 2,000 | 10,000 |
| Total decoded analysis bytes | 20 MiB | 100 MiB |
| Manifest bytes | 1 MiB | 2 MiB |
| TOML nesting depth | 64 | 128 |
| Single text file | 1 MiB | 5 MiB |
| Single binary hash | 20 MiB | 100 MiB |
| Single line/token scan | 64 KiB | 256 KiB |
| Lines analyzed per file | 20,000 | 100,000 |
| Analyzer facts per file | 500 | 2,000 |
| Analyzer issues per file | 500 | 2,000 |
| Static references per file | 500 | 2,000 |
| Trace depth | 4 | 8 |
| Graph nodes | 2,000 | 10,000 |
| Graph edges | 5,000 | 25,000 |
| Findings | 1,000 | 5,000 |
| Captured stderr/diagnostic body | 64 KiB | 256 KiB |
| Persisted evidence excerpt | 160 UTF-16 code units | 512 |
| Marketplace response | 16 MiB | 32 MiB |
| HTTP redirects | 0 | 0 |

## Accounting rules

### Network

Count compressed bytes as delivered when exposed by the runtime and always count decompressed bytes consumed by X-Ray. Enforce the stricter observable count. `Content-Length` rejection does not replace streaming accounting.

Commit, tree, blob, and GitHub error bodies consume the GitHub source total-response budget in addition to their operation-specific cap. Each request consumes the request budget even when it fails. The operation-specific cap is authoritative for that response; there is no conflicting generic single-response cap.

Marketplace enrichment has a separate response cap and does not consume the GitHub source budget. It still shares the wall-clock audit deadline.

### Base64 blobs

The complete JSON/base64 HTTP body is bounded by `githubBlobResponseBytes`. Check the base64 length and estimated decoded size before decode. The decoded blob is independently bounded by `githubBlobDecodedBytes` and counted against total analysis bytes. Abort if actual decoded size exceeds either declaration or limit.

### Local files

Count bytes actually read from handles. File metadata size is an early rejection signal only. Stop after the configured limit even if a file grows during reading and mark the source unstable.

### Graph and findings

Before adding a node, edge, or finding that crosses a cap, add one reserved resource-limit unknown record if capacity remains, set completeness false, and stop that expansion branch. The implementation reserves capacity for completeness metadata outside attacker-controlled arrays.

### Rendering

Renderers may summarize omitted lists but may not reread source. Output size is bounded indirectly by receipt limits and excerpt limits; renderers must still stream/write without unbounded concatenation where practical.

## CLI mapping

```text
--max-files       files analyzed
--max-total-bytes total decoded analysis bytes
--max-file-bytes  single text file
--max-depth       trace depth (not TOML parser depth)
--timeout-ms      wall-clock deadline
```

GitHub request/response caps are not user-adjustable in the first release. Programmatic library overrides remain bounded by hard maximums.
