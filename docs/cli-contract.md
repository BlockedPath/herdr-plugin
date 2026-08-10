# Herdr X-Ray CLI Contract

## Executable

```text
herdr-xray
```

The source entrypoint is `bin/herdr-xray.mjs`. Node.js 20 or newer is required.

## Commands

```text
herdr-xray audit <source> [options]
herdr-xray audit-installed <plugin-id> [options]
herdr-xray compare <plugin-id> <source> [options]
herdr-xray marketplace-collisions [options]
herdr-xray receipt verify <path>
herdr-xray version
herdr-xray help
```

## Sources

Accepted remote forms:

```text
owner/repo
owner/repo/subdir
https://github.com/owner/repo
```

A ref is data supplied only through `--ref`. GitHub `/tree/`, `/blob/`, issue, pull-request, query, fragment, credential, custom-port, SSH, and arbitrary Git URL forms are rejected.

Any other argument is treated as a local path only when it resolves to an existing directory.

### Installed plugins

`audit-installed <plugin-id>` accepts only a plugin ID matching `^[A-Za-z0-9][A-Za-z0-9._:-]*$`. Installed metadata comes from `herdr plugin list --json` through `HERDR_BIN_PATH`, spawned with an argv array and `shell: false`. X-Ray never reads Herdr's private registry, never guesses plugin roots, and fails with exit code 3 when Herdr is unavailable, returns an incompatible response, reports no matching plugin, reports duplicate plugin IDs, or reports a manifest that is not `herdr-plugin.toml` inside the reported plugin root.

`--ref` applies only to GitHub sources and is a usage error for `audit-installed`.

## Common options

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
--no-color
--help
```

Options reject duplicates unless explicitly documented otherwise. Numeric values must be positive integers and may not exceed the hard limits in [`resource-limits.md`](resource-limits.md).

## Output

### Terminal

Human-readable report on stdout. Progress and acquisition diagnostics go to stderr. Styling is enabled only for a terminal and can be disabled with `--no-color`.

### JSON

Exactly one UTF-8 JSON receipt followed by `\n` on stdout. No progress text, warning banner, or ANSI sequence may be written to stdout.

### Markdown

A deterministic human report rendered from the same receipt object as JSON.

### Output file

When `--output` is present, the selected format is atomically written to that path and stdout contains no report. Diagnostics remain on stderr.

## Policies

Policies never change the receipt contents; they change only the exit code after a completed analysis.

- `--fail-on-severity <level>` fails when a finding at that severity or higher exists.
- `--fail-on-unknown` fails when any unknown finding/edge exists.
- `--require-complete` returns incomplete-analysis exit code 3 unless every required core dimension in [`completeness.md`](completeness.md) is complete. Commands may add required operation dimensions.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Operation completed; findings are in the output |
| 2 | Invalid command, source, option, or value |
| 3 | Acquisition/manifest failure or required completeness not achieved |
| 4 | Completed analysis reached an opted-in finding/unknown policy |
| 5 | Receipt schema or integrity verification failed |

Precedence:

1. Usage error: 2
2. Acquisition, parse, unexpected internal failure, or required-completeness failure: 3
3. Explicit policy failure after completed analysis: 4
4. Receipt verification failure for `receipt verify`: 5

## Stable compatibility surface

Stable v1 promises:

- Command names
- Exit-code meanings
- JSON receipt schema versioning
- Finding rule IDs
- Fact/heuristic/unknown classification

Terminal wording, colors, and popup layout are not machine-readable contracts.
