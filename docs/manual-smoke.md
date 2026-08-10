# Manual Smoke Checklist — Herdr 0.8.0 × Ubuntu / macOS / Windows

Run with Herdr 0.8.0 + Node 20 and 24. All `herdr-xray` invocations must exit with documented codes and produce no `EXECUTED` side-effect.

## 1. Core audit

```bash
herdr-xray audit ./test/fixtures/manifests/examples/agent-telegram-notify --format json --output /tmp/r.json && herdr-xray receipt verify /tmp/r.json
# expect 0, receiptHash valid, no /tmp/EXECUTED
herdr-xray audit ./nonexistent --format json; echo $? # 3
```

## 2. Installed

```bash
herdr plugin list --json | jq .result.plugins[0].plugin_id
herdr-xray audit-installed <id> --format terminal
herdr-xray audit-installed <id> --ref main; echo $? # 2 (ref only for GitHub)
```

## 3. Compare

```bash
herdr-xray compare <id> ./test/fixtures/manifests/examples/agent-telegram-notify
herdr-xray compare <id> ./candidate --fail-on-severity high; echo $? # 4 if high added
```

## 4. Popup (keyboard-only)

- `herdr plugin pane open --plugin blockedpath.xray --entrypoint xray` → popup appears (90%×85%)
- `Tab`/`Enter`/`Esc` navigates, `Ctrl-C` closes and cleans temp (no `/tmp/herdr-xray-*` left)
- Source picker: GitHub `owner/repo` + `./local` both audit and render `terminal` report with commit-pinned `herdr plugin install … --ref <sha>`

## 5. Link handler

- In Herdr, click `https://github.com/owner/repo` → X-Ray popup opens with that source
- Click `https://github.com/owner/repo/tree/main`, `/blob/...`, `?q=`, `#frag`, `http://github.com/...`, `https://evil.com/...` → ignored, stderr `ignoring non-repository`, never as shell

## 6. Marketplace

```bash
herdr-xray marketplace-collisions --format json | jq .collisions
herdr-xray audit owner/repo --marketplace-check on --offline; echo $? # 3 if cache missing, else marketplace: unavailable
herdr-xray audit owner/repo --marketplace-check auto # degraded to unavailable, top-level may still be complete
```

## 7. Receipt verify

```bash
herdr-xray audit ./plugin --format json --output /tmp/r.json
jq '.findings=[]' /tmp/r.json > /tmp/t.json && herdr-xray receipt verify /tmp/t.json; echo $? # 5 analysisHash mismatch
jq '.generatedAt="2000-01-01T00:00:00.000Z"' /tmp/r.json > /tmp/t.json && herdr-xray receipt verify /tmp/t.json; echo $? # 5 receiptHash mismatch
```

## 8. Limits

```bash
herdr-xray audit ./large --max-files 1 --max-total-bytes 1024 --format json | jq .completeness.dimensions
# expect partial + xray.dynamic.resource-limit, never complete: true
```

Tick each OS/arch column; attach `receipt.json` hashes to release notes.
