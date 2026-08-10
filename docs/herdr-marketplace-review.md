# Herdr Marketplace Review

A complete metadata-level review of the official [Herdr plugin marketplace](https://herdr.dev/plugins/) snapshot, performed to avoid building an already-saturated plugin idea.

The complete flattened inventory is saved in [`herdr-marketplace-inventory.tsv`](./herdr-marketplace-inventory.tsv).

## Snapshot

The marketplace page embeds a canonical JSON snapshot with:

- Generated at: `2026-08-09T01:31:09.700Z`
- Published plugin manifests: **531**
- Repositories represented: **527**
- GitHub topic repositories collected: **541**
- Blacklisted repositories: **2**
- Repositories missing a manifest: **8**
- Invalid manifests: **0**
- Extra manifests from multi-manifest repositories: **4**
- Truncated: **false**

The live GitHub topic search returned 569 repositories when this review was performed. The official marketplace snapshot is therefore the authority for what was actually displayed on the linked page, but newly tagged repositories may not yet be represented.

## Method

Every published manifest entry was flattened into one inventory row containing:

- Repository and URL
- Stars and primary language
- Manifest path
- Plugin ID, name, and version
- Minimum Herdr version
- Declared platforms
- Manifest description

All 531 rows were reviewed through complete-inventory searches and thematic classification. Selected high-proximity repositories were then inspected directly through their README and implementation documentation.

Marketplace descriptions are unreviewed author-supplied metadata. Category presence does not prove correctness, maintenance, popularity, or security.

## Marketplace shape

### Star distribution

| Stars | Plugins |
| ---: | ---: |
| 0 | 205 |
| 1 | 102 |
| 2–4 | 120 |
| 5–9 | 47 |
| 10–24 | 32 |
| 25–99 | 17 |
| 100+ | 8 |

A majority of listings have little adoption evidence: 307 have zero or one star.

### Main implementation languages

| Language | Plugins |
| --- | ---: |
| Rust | 127 |
| Shell | 121 |
| Python | 83 |
| JavaScript | 82 |
| Go | 57 |
| TypeScript | 41 |
| Lua | 6 |
| PowerShell | 6 |
| Swift | 3 |
| Other/unknown | 3 |

### Platform coverage

| Declared platforms | Plugins |
| --- | ---: |
| Linux + macOS | 398 |
| Linux + macOS + Windows | 67 |
| macOS only | 45 |
| Linux only | 16 |
| Windows only | 5 |

Platform order variations have been normalized in the totals above.

### Minimum Herdr versions

| Minimum version | Plugins |
| --- | ---: |
| 0.7.0 | 312 |
| 0.7.5 | 97 |
| 0.7.4 | 74 |
| 0.8.0 | 29 |
| 0.7.3 | 10 |
| 0.7.1 | 6 |
| 0.7.2 | 3 |

## Saturated categories

Counts below are non-exclusive because many plugins span several areas.

| Category | Approximate listings | Assessment |
| --- | ---: | --- |
| Agent status, lifecycle, attention, or telemetry | 60 | Extremely crowded |
| Worktree/workspace lifecycle | 44 | Extremely crowded |
| Usage, context, cost, cache, or quota | 37 | Crowded |
| PR, issue, and SCM status tooling | 26 | Crowded, mostly GitHub-centric |
| Layout scaffolding and pane control | 24 | Crowded |
| Project/workspace launch and switching | 23 | Crowded |
| Editors and editor integration | 22 | Crowded, especially Vim navigation |
| File exploration, viewing, and search | 21 | Crowded |
| Remote/mobile interaction | 19 | Crowded |
| Diff and code review | 19 | Crowded |
| Agent notifications | 20 | Crowded |
| Resume, restore, and handoff | 20 | Crowded |
| Directional/Vim/pane navigation | 16 | Crowded |
| Command/action/keybinding palettes | 14 | Crowded |
| Agent output review, gates, and validation | 13 | Moderate to crowded |
| Browser/dev-server/runtime surfaces | 13 | Moderate |
| Agent orchestration and delegation | 12 | Established |
| Git clients/status | 12 | Moderate |
| Test/build/CI execution | 8 | Underserved |
| Sandbox/isolation/environment | 8 | Underserved, but strong existing leaders |
| Scheduling and continuation | 7 | Established |

### Ideas to avoid

Do not build another generic:

- Plugin manager or marketplace browser
- Automatic plugin updater
- Declarative plugin distro or lockfile manager
- Project/session fuzzy launcher
- Static workspace layout loader
- Worktree setup/copy/bootstrap hook
- Pane mover/equalizer
- Vim directional navigation bridge
- Command palette
- Read-only file explorer
- Hunk/diff viewer
- GitHub PR dashboard or status badge
- Agent status board
- Usage/context/quota sidebar meter
- Notification relay
- Telegram or mobile controller
- Session resume picker
- Voice controller

These areas already contain several mature or overlapping products.

## Important existing competitors

### Plugin management

- `natori-hrj/herdr-lazy` — declarative plugin list, lockfile, restore/update, curated distro, and marketplace UI
- `speardragon/herdr-plugin-manager` — popup install/update/enable/uninstall and marketplace browser
- `dio16/herdr-auto-update` — automatic upstream commit checking and reinstall
- `JanTvrdik/herdr-command-palette` — discovers and invokes installed plugin actions

A new plugin should integrate with these tools rather than replace them.

### Parallel agents and orchestration

- `StructuPath/herdr-swarm` — fans the same shared task out to multiple agents in isolated worktrees, shows changes, and harvests a selected result
- `ribbons-digital/pi-herd` — visible Pi role orchestration with isolated worktrees and durable artifacts
- `jeffory/herdr-walkietalkie` — token-efficient cross-agent delegation
- `bon5co/bermuda` — flows, scheduled jobs, shared threads, and claims
- `nelsonPires5/herdr-board` — Kanban pipeline dispatch into visible agents
- `mikhail-angelov/herdr-review-loop` — repeated independent review/fix cycles

This substantially reduces the uniqueness of a simple “agent bakeoff” or generic multi-agent coordinator. A comparative-evaluation product would need normalized repeated trials, shared validation, cost/latency capture, and evidence-based scoring—not merely fan-out and winner selection.

### Agent handoff

- Agent Handoff — transfers an in-progress session to another installed agent
- Catchup — cross-agent coding-session handoff, summarization, and forking
- Fork — copies or forks an agent conversation into another pane
- ai-memory — cross-agent continuity through managed workstreams

A generic cross-agent handoff plugin is already occupied.

### Usage and provider visibility

- `senna-lang/herdr-agent-usage`
- `silverwolfdoc/herdr-usage-bar`
- `gecm0/herdr-plugin-agents-usage`
- `szrenwei/herdr-agent-metrics`
- `Davidcreador/herdr-token-dashboard`
- Multiple Claude, Codex, cache-TTL, and cost-specific meters

A new provider tool must make a decision or take an action rather than display another gauge.

### Voice and audio

- `aneym/herdr-voice` — OpenAI Realtime voice control for creating spaces, panes, layouts, and agent prompts
- `eliasstravik/herdr-call` — manage Herdr through an ElevenLabs voice call
- `RanolP/herdr-handsfree` — voice dictation and webcam gaze control
- `nhclink16/herdr-announcer` — spoken agent completion/input summaries
- `Javamomma/herdr-scribe` — live meeting transcription and analyst panes

Voice Dispatch is no longer a sufficiently unique first-plugin direction.

## Duplicate plugin IDs

The marketplace contains seven IDs claimed by unrelated repositories:

| Plugin ID | Repositories |
| --- | --- |
| `herdr-caffeinate` | `nwarwick/herdr-caffeinate`, `neefrehman/herdr-caffeinate` |
| `herdr-lazygit` | `Crokily/herdr-lazygit`, `JacquesvanWyk/herdr-lazygit` |
| `herdr-linear` | `JacquesvanWyk/herdr-linear`, `talent-factory/herdr-linear` |
| `herdr-navigator` | `thanhdat77/herdr-navigator`, `kaar/nvim-herdr-navigator` |
| `official.browser` | `ogulcancelik/herdr-browser`, `Epsomsaltskerosinelamp950/herdr-browser` |
| `sessionizer` | `andrewchng/herdr-sessionizer`, `salkhalil/herdr-sessionizer` |
| `usagebar` | `senna-lang/herdr-agent-usage`, `silverwolfdoc/herdr-usage-bar` |

This is not merely cosmetic. A GitHub-managed plugin can potentially be replaced by another GitHub source claiming the same plugin ID. Locally linked plugins receive stronger replacement protection.

Collision detection and source-ownership changes are therefore concrete high-value checks for a trust auditor.

## Reassessment of proposed ideas

### Herdr X-Ray / pre-install trust auditor

**Status: strengthened.**

No listing advertises the complete workflow of:

1. Fetching a candidate plugin without executing it.
2. Comparing it to the currently installed commit/source.
3. Semantically diffing build, startup, action, event, pane, and link-handler execution surfaces.
4. Recursively tracing referenced scripts, subprocesses, downloads, dependency installers, and binaries.
5. Flagging plugin-ID/source collisions.
6. Producing a policy/trust receipt before an unattended `--yes` install or update.

Closest adjacent products:

- `StructuPath/herdr-guard` — runtime command policy and best-effort interruption, not package analysis
- `herdr-lazy` — update commit subjects and lockfile management, not semantic source auditing
- `herdr-plugin-manager` — install/update UI, not package auditing
- `herdr-auto-update` — automatic reinstall, which increases the value of a pre-update gate
- Vercel/E2B/Crabbox plugins — workload sandboxing, not plugin-package analysis
- Approval Gate and Conductor — task/transcript gates, not installation gates

Several inspected managers invoke `herdr plugin install ... --yes`, bypassing the native interactive preview. A machine-readable preflight auditor could complement those managers as a policy gate.

**Recommended differentiation:** candidate-versus-installed semantic execution graph, bounded static tracing with explicit unknown edges, ID/source collision warnings, and machine-readable trust receipts. Do not build another manager UI.

### Herdr Bakeoff

**Status: still open, but less unique than initially believed.**

No listing advertises normalized repeated head-to-head evaluation with a common task, common validation gate, latency/cost/reliability capture, and ranked results. However, `herdr-swarm` already owns same-task worktree fan-out and winner harvesting.

A Bakeoff product would need to focus on controlled experiments and accumulated model evidence rather than orchestration.

### RouteProof

**Status: open and potentially valuable.**

No listing advertises a complete pre-execution route combining:

- Available provider/model discovery
- Authentication health
- Tool/modality/context compatibility
- Prompt and cache-loss economics
- Provider quota state
- Optional reliability probe
- Executable agent/model recommendation

The risk is significant provider-adapter and OAuth maintenance. It should consume existing usage tools where possible rather than duplicate them.

### Semantic behavior visualization

**Status: open.**

Mermaid Preview renders diagrams provided by agents, and several plugins show Git graphs, widget trees, diffs, or agent-state visualizations. No description advertises derived before/after program behavior, affected invariants, and falsification evidence.

This remains differentiated if positioned as semantic behavior explanation—not another diff viewer.

## Best remaining opportunities

1. **Herdr X-Ray** — pre-install/update semantic execution graph and trust receipts
2. **RouteProof** — evidence-based provider/model preflight and launch routing
3. **Semantic Change Lab** — before/after behavior graphs plus invariant/test probes
4. **Controlled Agent Eval** — repeated normalized trials built on top of existing fan-out tools
5. **End-to-End Validation Runner** — start service, wait for health, capture logs/browser evidence, run targeted checks, and return structured evidence to the originating agent

## Current recommendation

Continue with **Herdr X-Ray**, but define it as an integration layer for existing managers:

> Before any plugin install or unattended update, compute the candidate-versus-installed execution-surface diff, flag source/ID ownership changes and risky dynamic edges, then emit a human-readable and machine-readable trust receipt.

That is more specific, more defensible, and better supported by the complete marketplace review than a general plugin-security scanner or another plugin manager.
