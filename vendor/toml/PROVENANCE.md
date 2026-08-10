# Vendored TOML Parser Provenance

## Selection

Herdr X-Ray vendors the parse-only runtime from **smol-toml 1.7.1**.

- Package: `smol-toml@1.7.1`
- Upstream: <https://github.com/squirrelchat/smol-toml>
- Tag: `v1.7.1`
- Peeled tag commit: `3e978a945ef9b15056d55f6ad92dd48fb05fe28e`
- npm publication: `2026-07-26T08:34:54.252Z`
- License: BSD-3-Clause; retained in [`LICENSE`](LICENSE)
- npm tarball: `https://registry.npmjs.org/smol-toml/-/smol-toml-1.7.1.tgz`
- npm SHA-1: `ba3e28d2e4348874a824fd8e1d73fec618cb763b`
- Downloaded tarball SHA-256: `0a5a44e4a1189c7c36d5a516fa169591ce5de56a5d495d07a7847e1a1afaeccb`
- npm integrity: `sha512-PPlsspAZ4jbMBu5DMFhfUGDQLu/vrL4SyBROVS37x8ynnVmFIs1VPBz1Co8Xks3TvpIaZXmU85y4DrQ+UyVFoQ==`

## Why selected

- ESM runtime compatible with Node.js 20+
- No runtime dependencies
- Readable generated JavaScript
- TOML 1.1 parser, covering Herdr’s TOML usage
- Parser exposes a depth bound
- Explicit handling for `__proto__` keys avoids prototype-setter assignment
- Upstream documents broad `toml-test` coverage and known JavaScript precision/date limitations

X-Ray does not rely on precise 64-bit integer or sub-millisecond date behavior for plugin manifests. Manifest validation rejects values outside Herdr’s expected field types.

## Included files

Only parse-time runtime files are included. Serializer, CommonJS bundle, declarations, maps, README, and TypeScript sources are not required at runtime.

| File | SHA-256 |
| --- | --- |
| `date.js` | `da5549142bbb43537c03dd9164ad434c3d5ffcc7f674e39e076e8cd23cc719c7` |
| `error.js` | `9f8d7d23f463a2993afa0aafe54a66e959949dbda7499949693f88115b461312` |
| `extract.js` | `473b6bb27daa2871e477bda09c626aef59c30fda09818a2221d32e96e2aa3b2a` |
| `parse.js` | `bf0c4aeb2645fb80d6743bc662990c4807c2858f55548113f60fe98fac6a8210` |
| `primitive.js` | `9bda902c6b763b75bcb154689dccd25fbd4fb7eca12d3ddffc6915c6c013e3ce` |
| `struct.js` | `8a7bdf55cd5e27e031e4b0dab6af8f28507e58eb81ef9c8dc84ba618d9eda647` |
| `util.js` | `d08c0ca8aad365eb8b51f961564a57e0275176ff5acc036e4939d47a2b945663` |
| `LICENSE` | `fa5659948374d4f555594f47f6da073b40dc503e921aeeece30df4362b3051a5` |

## Review notes

A static review of the included files found:

- No Node built-in imports
- No filesystem, network, subprocess, environment, dynamic import, `eval`, or `Function` use
- Only relative imports among the included modules
- Explicit own-property handling for object construction

The parser still processes attacker-controlled input. X-Ray therefore applies its own manifest byte limit before parsing and calls `parse` with a bounded `maxDepth`.

## Upgrade procedure

1. Download with `npm pack smol-toml@<version> --ignore-scripts` into a temporary directory.
2. Verify npm integrity and record tarball SHA-256.
3. Review package metadata, license, imports, dynamic execution, object construction, and changed parser behavior.
4. Copy only the parse-time runtime files.
5. Update every hash in this document.
6. Run manifest fixtures, malicious-input tests, and official/example Herdr manifest parsing.
7. Record the new upstream tag/commit and known compatibility changes.
