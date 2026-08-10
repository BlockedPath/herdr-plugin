# Herdr 0.8.0 Contract Baseline

Captured for Herdr X-Ray Milestone 0.

## Version

```text
herdr 0.8.0
API protocol 19
```

## Installed plugin discovery

X-Ray uses only:

```bash
herdr plugin list --json
```

Observed envelope:

```json
{
  "id": "cli:plugin",
  "result": {
    "type": "plugin_list",
    "plugins": []
  }
}
```

Required per-plugin fields for installed auditing:

- `plugin_id`
- `manifest_path`
- `plugin_root`
- `source.kind`

Required for GitHub installed-versus-candidate identity comparison:

- `source.owner`
- `source.repo`
- `source.resolved_commit`

Optional when present:

- `source.subdir`
- `source.requested_ref`
- `source.managed_path`
- `source.installed_unix_ms`

X-Ray validates the envelope and fields at runtime. It must fail explicitly if an installed audit lacks `plugin_root`/`manifest_path`, or narrow identity comparison if optional GitHub metadata is unavailable. It must not read Herdr’s private registry as a fallback.

Sanitized observed fixture: [`../test/fixtures/herdr-0.8.0/plugin-list.json`](../test/fixtures/herdr-0.8.0/plugin-list.json).

## Popup environment forwarding

Public command:

```text
herdr plugin pane open --plugin <ID> --entrypoint <ID> --env <KEY=VALUE>
```

The command help describes `--env` as:

```text
Set an environment variable for the launched process
```

Protocol-19 request schema `PluginPaneOpenParams` includes:

```json
{
  "env": {
    "type": "object",
    "additionalProperties": { "type": "string" }
  }
}
```

Sanitized schema fixture: [`../test/fixtures/herdr-0.8.0/plugin-pane-open.schema.json`](../test/fixtures/herdr-0.8.0/plugin-pane-open.schema.json).

## Runtime rules

- Locate Herdr through `HERDR_BIN_PATH` during plugin execution.
- Spawn with argv arrays and `shell: false`.
- Treat malformed JSON, protocol incompatibility, or missing required fields as explicit errors.
- Never construct raw socket/named-pipe requests in v1.
- Keep fixture-backed adapters isolated under `src/herdr/`.

## Refresh procedure

For each newly supported Herdr version:

1. Capture `herdr --version`.
2. Capture and sanitize `herdr plugin list --json`.
3. Capture `herdr api schema --json`.
4. Extract the popup request schema.
5. Diff fixtures and update adapter tests.
6. Record protocol and semantic changes here.
