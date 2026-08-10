# JSON Integration Guide — Herdr X-Ray v0.1.0

Receipts are `schemas/receipt-v1.schema.json` (Draft 2020-12, closed). `audit`/`compare` emit one receipt object; `receipt verify` checks it.

## Consuming

```bash
herdr-xray audit owner/repo --ref <sha> --format json --output receipt.json
herdr-xray receipt verify receipt.json  # exit 0 valid, 5 invalid
node -e 'const r=require("./receipt.json"); console.log(r.completeness.complete, r.summary)'
```

- `receiptHash` covers every field except itself; `analysisHash` covers the stable projection (excludes `generatedAt`, `receiptHash`, `marketplace` enrichment volatility — see `src/receipt/hash.mjs`). Any mutation breaks the respective hash.
- `subject.source` is `github`|`local`|`installed` (installed may include `owner`/`repo`/`subdir`/`resolvedCommit` when upstream verifiable, else `localRootHash`).
- `subject.installedBaseline` is `null` except for `compare` (then `{source, plugin, analysisHash}` of baseline).
- `comparison` is `null` except for `compare` (then `{baselineAnalysisHash, changes: [{kind, change, subject, severity}]}` where `kind` in `identity,manifest,graph,finding,completeness,reachable-file` and `change` in `added,removed,changed`).

## Fields managers care about

- `completeness.dimensions.{source,manifest,executionGraph,reachableSource,analysis,cleanup}` + optional `marketplace,comparison` (each `{status: complete|partial|unavailable, reason, limit}`) and top-level `complete` + `unstable`
- `summary` `{facts,heuristics,unknowns,bySeverity: {info,low,medium,high}}`
- `graph.{nodes,edges}` — stable IDs; `type` in `plugin,trigger,command,source-file,package-lifecycle,subprocess,network-endpoint,environment-variable,filesystem-path,opaque-binary,unknown`
- `findings[]` — `{id, ruleId: xray.*.* , class: fact|heuristic|unknown, severity, confidence, category, title, explanation, evidence: [{path,line,column,excerpt}], remediation}`
- `provenance.files[]` — `{path, sha256, bytes, role: manifest|metadata|reachable-source|opaque}`

## Policy

Use exit codes + `summary`/`findings`, not terminal text. Example gate:

```js
const r = JSON.parse(await readFile("receipt.json","utf8"));
const bad = r.findings.some(f => f.severity==="high") || r.summary.unknowns>0 || !r.completeness.complete;
process.exit(bad ? 1 : 0);
```

Never scrape `terminal`/`markdown`; they are not stable.

## Example (truncated)

```json
{
  "schemaVersion": 1,
  "tool": {"name":"herdr-xray","version":"0.1.0","rulesVersion":1},
  "subject": {"source":{"kind":"github","owner":"o","repo":"r","resolvedCommit":"abc..."},"plugin":{"id":"example.plugin"}},
  "completeness": {"complete": false, "dimensions": {"analysis": {"status":"partial","reason":"dynamic import","limit":null}}},
  "summary": {"facts":1,"heuristics":0,"unknowns":1,"bySeverity":{"high":1}},
  "findings": [{"ruleId":"xray.execution.dynamic-import","class":"unknown","severity":"medium"}]
}
```
