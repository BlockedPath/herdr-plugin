# Bounded Static Analyzers

Herdr X-Ray analyzers inspect only files reached from manifest commands, statically resolved references, and `package.json`. They never import or execute target code.

## Supported surfaces

| Surface | Extracted evidence |
| --- | --- |
| JavaScript/TypeScript | Relative imports/requires, subprocess calls, environment reads, URLs, filesystem writes, eval/Function, computed imports |
| Shell | Sourced scripts, shell child scripts, environment reads, URLs, redirects/writes, eval/`sh -c`, command substitution, download-to-shell |
| Python | Run-path references, subprocess calls, environment reads, URLs, write APIs, eval/exec |
| PowerShell | Script invocation, environment reads, Start-Process, Invoke-Expression, URLs, write/remove commands |
| Batch/CMD | Called scripts, environment reads, command-interpreter evaluation, URLs, write/remove commands |
| `package.json` | Lifecycle scripts and directly referenced interpreter scripts |
| Native/PE/ELF/Mach-O/WASM | File type and explicit opaque unknown finding |
| Other text | Network endpoints; supported-code extensions without an analyzer become explicit unknowns |

## Evidence semantics

Analyzers emit:

- **Facts** for literal destinations, variable names, command strings, and APIs visible in source
- **References** for statically resolvable local imports, sourced files, and child scripts
- **Unknowns** for computed commands/paths, dynamic evaluation, unsupported languages, opaque binaries, malformed inputs, and exhausted limits

Network evidence stores only the URL origin. Credential-like environment evidence stores only the variable name, never its value. Persisted excerpts are control-sanitized and bounded.

## Recursive tracing

- Starts from manifest-reachable files and `package.json`
- Resolves references relative to the referring file
- Keeps Windows backslash semantics separate from POSIX/Git literal backslashes
- Rejects absolute and root-escaping references
- Preserves effective platform scopes
- Stops at file, byte, line, reference, fact, graph, finding, and depth limits
- Converts every stop or unresolved edge into incomplete status and an unknown finding

## Limitations

The analyzers are deliberately conservative lexical scanners, not complete parsers or runtime emulators. They can produce false positives and cannot resolve arbitrary string construction, reflection, generated code, framework loaders, native behavior, or dependency internals. Absence of a finding is not proof that behavior is absent.
