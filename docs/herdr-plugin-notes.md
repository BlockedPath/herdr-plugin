# Herdr Plugin Authoring Notes

A practical reference compiled from the Herdr configuration, plugin, marketplace, CLI, socket API, and preview documentation.

## Sources reviewed

- [Configuration](https://herdr.dev/docs/configuration/)
- [Config reference](https://herdr.dev/docs/config-reference/)
- [Plugins](https://herdr.dev/docs/plugins/)
- [Marketplace](https://herdr.dev/docs/marketplace/)
- [CLI reference](https://herdr.dev/docs/cli-reference/)
- [Socket API](https://herdr.dev/docs/socket-api/)
- [Preview documentation](https://herdr.dev/docs/preview/)
- [Example plugins](https://github.com/ogulcancelik/herdr-plugin-examples)

At the time of review, the stable and preview plugin/configuration pages were materially equivalent. Recheck the live documentation and installed CLI before depending on exact fields or commands.

## Mental model

A Herdr plugin is a shareable executable workflow package. It is not an in-process SDK extension.

A plugin consists of:

1. A directory containing `herdr-plugin.toml`.
2. Commands implemented in any executable language: Bash, JavaScript, Lua, Python, Rust, Go, PowerShell, and so on.
3. Optional actions, events, startup hooks, terminal pane entrypoints, link handlers, and install-time build commands declared in the manifest.

Herdr owns:

- Installation and registration
- Manifest validation
- Invocation and runtime context
- Keybinding integration
- Terminal pane placement
- Event dispatch
- Plugin command logs
- CLI and socket access

The plugin owns:

- Its implementation language
- Dependencies and toolchain requirements
- User-editable configuration
- Durable state and migrations
- Error handling and cleanup

There is no separate plugin SDK or restricted plugin command set. The complete Herdr CLI is the primary plugin API. The raw socket API is available when direct request/response control or event subscriptions are necessary.

## Minimal structure

```text
my-plugin/
├── herdr-plugin.toml
└── index.js
```

```toml
id = "example.workspace-tools"
name = "Workspace Tools"
version = "0.1.0"
min_herdr_version = "0.7.0"
description = "Small workspace helpers"
platforms = ["linux", "macos", "windows"]

[[actions]]
id = "list-workspaces"
title = "List workspaces"
contexts = ["workspace"]
command = ["node", "index.js"]
```

Required top-level fields:

- `id`
- `name`
- `version`
- `min_herdr_version`

`description` is optional. Declaring `platforms` is strongly recommended; a locally linked plugin without it produces a warning.

### Identifier rules

Plugin IDs may contain ASCII letters, digits, dots, colons, underscores, and hyphens.

Action, pane, and link-handler IDs are local to the plugin. They may contain ASCII letters, digits, colons, underscores, and hyphens, but not dots. Each ID type must be unique inside the plugin.

Herdr forms globally qualified action IDs such as:

```text
example.workspace-tools.list-workspaces
```

### Commands are argv arrays

Manifest commands are argument arrays and are not automatically passed through a shell:

```toml
command = ["node", "index.js"]
```

Shell expansion, pipelines, redirection, and shell variables only work when the command explicitly starts a shell:

```toml
command = ["sh", "-c", "printf '%s\n' \"$VALUE\""]
```

Prefer putting language-specific logic in a script rather than embedding a large shell command in the manifest.

## Manifest surfaces

### Build commands

```toml
[[build]]
command = ["npm", "ci"]

[[build]]
command = ["npm", "run", "build"]
platforms = ["linux", "macos"]
```

Build commands run during GitHub installation after the trust preview and before registration. A failed build aborts installation.

Important:

- `herdr plugin link` does not run build commands.
- Local authors must build their working tree themselves.
- Build commands do not receive runtime plugin context or Herdr socket variables.
- Herdr reports missing toolchains but does not install them.
- Changing `herdr-plugin.toml` during an install build aborts installation.

### Startup hooks

```toml
[[startup]]
command = ["node", "dist/restore.js"]
```

Startup hooks run once per enabled plugin after session restore and after the API socket is ready. They run again when a new server takes over during live handoff.

They do not run merely because:

- A client attaches
- Configuration reloads
- A plugin is linked
- A plugin is enabled

Startup hooks are one-shot initialization commands, not supervised daemons. Restore state, call the required APIs, and exit. A startup failure is logged but does not stop the server.

### Actions

```toml
[[actions]]
id = "apply"
title = "Apply layout"
contexts = ["workspace"]
command = ["node", "dist/apply.js"]
```

Actions can be invoked through the CLI, socket API, keybindings, or a same-plugin link handler.

Runtime action registration is not available in plugin v1; actions must be declared in the manifest.

### Event hooks

```toml
[[events]]
on = "worktree.created"
command = ["node", "dist/bootstrap.js"]
```

An enabled plugin runs the command whenever Herdr emits the matching event. The event payload is provided through `HERDR_PLUGIN_EVENT_JSON`.

A misspelled or unknown event name produces a warning when linking rather than necessarily rejecting the plugin. Inspect warnings from `plugin link` and `plugin list`.

Relevant event families include workspace, tab, pane, layout, agent-state, and worktree lifecycle events. Verify exact event names against the live socket API schema:

```bash
herdr api schema --json
```

### Terminal pane entrypoints

```toml
[[panes]]
id = "board"
title = "Project board"
placement = "overlay"
command = ["node", "dist/board.js"]
```

Supported placement values:

- `overlay` — temporary zoomed overlay; manifest default
- `popup` — session-modal terminal outside the tiled pane layout
- `split`
- `tab`
- `zoomed`

Popup example:

```toml
[[panes]]
id = "picker"
title = "Picker"
platforms = ["linux", "macos"]
placement = "popup"
width = "80%"
height = 20
command = ["sh", "picker.sh"]
```

Popup caveats:

- A popup is not a Herdr pane.
- It has no pane ID and receives no `HERDR_PANE_ID`.
- It emits no pane lifecycle events.
- It does not participate in pane, layout, persistence, or agent APIs.
- It is session-modal and receives terminal input until it exits.
- Only one popup can occupy the session UI resource.

Split, tab, zoomed, and overlay entrypoints become normal Herdr panes after opening. Pane ownership follows them if they are moved.

Native non-terminal plugin UI is not part of plugin v1.

### Link handlers

```toml
[[link_handlers]]
id = "github-issue"
title = "Open GitHub issue"
pattern = "^https://github\\.com/[^/]+/[^/]+/(issues|pull)/[0-9]+$"
action = "open"
```

A modified click on a matching terminal URL invokes an action from the same plugin. Patterns use Rust regular-expression syntax.

The modifier is Control on all platforms, including macOS. Link-handler context includes the clicked URL and handler ID.

Handlers are checked in manifest order inside each plugin.

## Runtime environment

Runtime commands execute with the plugin directory as their working directory.

Common injected variables:

- `HERDR_BIN_PATH`
- `HERDR_SOCKET_PATH`
- `HERDR_ENV=1`
- `HERDR_PLUGIN_ID`
- `HERDR_PLUGIN_ROOT`
- `HERDR_PLUGIN_CONFIG_DIR`
- `HERDR_PLUGIN_STATE_DIR`
- `HERDR_PLUGIN_CONTEXT_JSON`
- `HERDR_WORKSPACE_ID`, when available
- `HERDR_TAB_ID`, when available
- `HERDR_PANE_ID`, when available

Entrypoint-specific variables:

- Actions: `HERDR_PLUGIN_ACTION_ID`
- Startup hooks: `HERDR_PLUGIN_EVENT=startup`
- Event hooks: `HERDR_PLUGIN_EVENT` and `HERDR_PLUGIN_EVENT_JSON`
- Pane commands: `HERDR_PLUGIN_ENTRYPOINT_ID`
- Link handlers: `HERDR_PLUGIN_CLICKED_URL` and `HERDR_PLUGIN_LINK_HANDLER_ID`

`HERDR_PLUGIN_CONTEXT_JSON` may include workspace, tab, focused pane, worktree, agent, selected text, clicked URL, and link-handler information depending on the invocation.

Always treat context fields as optional. Parse JSON defensively and provide useful errors when required context is unavailable.

## Calling Herdr from a plugin

Prefer `HERDR_BIN_PATH` over assuming `herdr` is on `PATH`:

```js
import { spawnSync } from "node:child_process";

const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const result = spawnSync(herdr, ["workspace", "list"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
```

Using the injected binary path keeps the plugin portable between Unix sockets and Windows named pipes.

Use the raw socket API only for needs such as:

- Long-lived event subscriptions
- Direct JSON request/response handling
- Atomic API operations unavailable as convenient CLI wrappers
- High-frequency or protocol-level interactions

The installed binary is the authority for the current socket schema:

```bash
herdr api schema
herdr api schema --json
herdr api schema --output herdr-api.schema.json
```

## Configuration and state

Use the paths Herdr provides:

- `HERDR_PLUGIN_CONFIG_DIR` for user-editable settings, credentials, and `.env` files.
- `HERDR_PLUGIN_STATE_DIR` for runtime state, databases, caches, and restoration data.
- `HERDR_PLUGIN_ROOT` only for installed source and packaged assets.

Do not store credentials or durable state in `HERDR_PLUGIN_ROOT`. GitHub-installed roots are managed checkouts and may be replaced during reinstall.

Herdr provides path discovery but no managed plugin storage API in v1. The plugin owns:

- File formats
- Validation
- Migrations
- Locking and concurrency
- Cleanup
- Secret-handling guidance

Find a plugin's configuration directory with:

```bash
herdr plugin config-dir example.plugin
```

## Host configuration integration

Plugins do not add arbitrary keys to Herdr's global `config.toml`. Plugin settings should live in the plugin config directory.

A user can bind a plugin action in Herdr configuration:

```toml
[[keys.command]]
key = "prefix+l"
type = "plugin_action"
command = "example.layout.apply"
description = "apply layout"
```

Plugins may also report custom sidebar metadata tokens through `pane report-metadata` or `workspace report-metadata`. Users choose whether and how those `$name` tokens appear through their local sidebar configuration.

## Local development workflow

Link a working directory:

```bash
herdr plugin link /path/to/plugin
```

Inspect registration and warnings:

```bash
herdr plugin list --plugin example.plugin
herdr plugin list --json
```

List and invoke actions:

```bash
herdr plugin action list --plugin example.plugin
herdr plugin action invoke example.plugin.action
```

Open a declared pane:

```bash
herdr plugin pane open \
  --plugin example.plugin \
  --entrypoint board
```

Inspect recent command logs:

```bash
herdr plugin log list --plugin example.plugin
```

Enable or disable:

```bash
herdr plugin disable example.plugin
herdr plugin enable example.plugin
```

Unregister local development files without deleting them:

```bash
herdr plugin unlink example.plugin
```

Installed and linked plugins, including enabled state, are global to the current user and available in every Herdr session.

## GitHub installation and removal

Install from GitHub shorthand:

```bash
herdr plugin install owner/repo[/subdirectory]
```

Useful options:

```bash
herdr plugin install owner/repo --ref TAG_OR_COMMIT
herdr plugin install owner/repo --yes
```

Installation:

1. Clones with Git.
2. Shows an interactive trust preview unless bypassed.
3. Runs applicable build commands.
4. Stores the source in a Herdr-managed checkout.
5. Registers the plugin.

Use `--yes` only for sources already trusted. Use `--ref` to pin a revision when reproducibility matters.

There is no separate `plugin update` command in v1. Reinstall the GitHub source to refresh its managed checkout.

Remove a managed install:

```bash
herdr plugin uninstall example.plugin
# or
herdr plugin uninstall owner/repo[/subdirectory]
```

`uninstall` unregisters the plugin and removes a Herdr-managed GitHub checkout. `unlink` unregisters a local plugin but leaves its files intact.

Installing over a locally linked plugin is refused; unlink or uninstall the local registration first.

## Marketplace publication

The marketplace is an automatic, unreviewed index of public GitHub repositories.

To publish:

1. Create a public GitHub repository containing `herdr-plugin.toml` at its root or in an installable subdirectory.
2. Give the repository a useful name and description.
3. Add the GitHub topic `herdr-plugin`.
4. Share the install command:

   ```bash
   herdr plugin install owner/repo[/subdirectory]
   ```

The marketplace refreshes approximately every 30 minutes. It excludes archived repositories and forks.

Marketplace listings currently use GitHub repository metadata rather than parsing `herdr-plugin.toml`. They show information such as owner, repository name, description, stars, primary language, and last push time.

A listing is not an endorsement or security review.

## Security model

Plugins execute ordinary code as the current user. They are not sandboxed and can access the user's environment and the complete Herdr CLI.

Before installing a third-party plugin, inspect:

- `herdr-plugin.toml`
- Build commands
- Startup hooks
- Event hooks
- Executed scripts and binaries
- Dependency installation behavior
- Network requests
- Credential and state handling

Plugin documentation should clearly state:

- Required runtimes and external tools
- Required permissions
- Network services contacted
- Where credentials are stored
- How to remove or reset state
- Supported platforms and minimum Herdr version

## Patterns from the example repository

The example repository demonstrates four useful patterns:

### Layout action

A Lua action calls `HERDR_BIN_PATH` to rename and split panes, extracts returned pane IDs from Herdr's JSON, starts commands, and preserves focus intentionally.

Use this pattern for repeatable workspace or tab layouts.

### GitHub link preview

A Bash link handler receives the clicked URL, invokes a declared plugin pane, passes the URL through a launch environment variable, and renders `gh` output in a right-side split.

Use this pattern for URL-aware terminal workflows.

### Agent Telegram notifications

A JavaScript event hook receives `pane.agent_status_changed`, filters for `done` and `blocked`, reads credentials from the plugin config directory, and stores enabled/disabled state in the plugin state directory.

Use this pattern for notifications and event-driven integrations. Filter events early because a hook may be invoked frequently.

### Rust release check

A Rust action uses an install-time Cargo build and reads the active repository path from `HERDR_PLUGIN_CONTEXT_JSON`.

Use this pattern for compiled plugins. Remember that local linking requires a manual build.

These examples are reference material, not maintained official plugins. Copy useful patterns rather than taking a runtime dependency on the examples repository.

## Common gotchas

1. `plugin link` does not execute build commands.
2. Manifest commands are argv arrays, not shell strings.
3. `min_herdr_version` is required.
4. Item-level `platforms` overrides the plugin-level list rather than extending it.
5. Action, pane, and link-handler local IDs cannot contain dots.
6. Runtime actions and panes must be declared in the manifest.
7. Popup entrypoints are not panes and have no pane ID.
8. Startup hooks are one-shot commands, not daemon supervisors.
9. Plugin config and state are owned by the plugin; Herdr only supplies directories.
10. Installed plugin roots may be replaced, so they are not state directories.
11. Marketplace inclusion is automatic and unreviewed.
12. Reinstallation, not a separate update command, refreshes GitHub plugins in v1.
13. Unknown event names may only produce warnings; inspect link/list output.
14. Context fields vary by invocation and must be treated as optional.
15. Prefer `HERDR_BIN_PATH` for cross-platform CLI calls.

## Suggested design process

When starting a plugin, answer these questions first:

1. What user problem does it solve?
2. What triggers it?
   - Manual action
   - Keybinding
   - Herdr event
   - Startup restoration
   - Terminal pane UI
   - Clicked URL
3. Does it need a persistent interactive terminal UI or only a short-running command?
4. What invocation context does it require?
5. What user configuration or credentials are needed?
6. What state must survive server restarts or plugin reinstalls?
7. Which platforms are supported?
8. Which runtime and external tools must users install?
9. What is the oldest Herdr version supporting every API and manifest field used?
10. What security-sensitive operations should be disclosed?

Start with the smallest possible manifest and one action. Add events, startup restoration, panes, or link handling only when the workflow requires them.

## Pre-publication checklist

- [ ] Required manifest metadata is present.
- [ ] `min_herdr_version` is verified.
- [ ] Plugin and local entrypoint IDs follow the allowed formats.
- [ ] Supported platforms are declared accurately.
- [ ] Every command is a valid argv array on its target platforms.
- [ ] Missing context is handled gracefully.
- [ ] Configuration uses `HERDR_PLUGIN_CONFIG_DIR`.
- [ ] Durable state uses `HERDR_PLUGIN_STATE_DIR`.
- [ ] No credentials or state are written to `HERDR_PLUGIN_ROOT`.
- [ ] Runtime and external-tool requirements are documented.
- [ ] Build commands work from a clean checkout.
- [ ] Local-link instructions mention manual builds where necessary.
- [ ] Actions, events, panes, startup hooks, and link handlers have been tested.
- [ ] `herdr plugin log list` shows useful errors and no unexpected failures.
- [ ] Install, reinstall, disable/enable, unlink, and uninstall paths are understood.
- [ ] Security and network behavior are documented.
- [ ] The repository has a useful GitHub description.
- [ ] The `herdr-plugin` topic is added when marketplace listing is desired.
