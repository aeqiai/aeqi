# AEQI Open Source User Experience Report

Date: 2026-05-02
Repository reviewed: `/home/claudedev/aeqi`
Version reviewed: `0.14.0`

## Executive Summary

AEQI looks like a serious, active system with a strong Rust workspace, a real web UI, a release pipeline, security docs, issue templates, and a large passing test suite. As a technical open source user, I would trust that there is substantial engineering behind it.

The main problem is the first-user path. The repository presents a polished runtime story, but the README, quickstart, config example, CLI help, and setup/doctor behavior are not aligned. That creates a sharp drop in confidence: a user can install and build successfully, but the first recommended validation command reports problems immediately, and several documented commands do not exist.

The highest-leverage work is not a refactor. It is tightening the public contract:

1. Make `aeqi setup -> aeqi doctor --strict -> aeqi start` work from a clean home directory.
2. Update README and docs so every shown command exists.
3. Pick one public vocabulary for "agents", "projects", "agent_spawns", "companies", "organizations", "events", and "ideas" and apply it consistently.
4. Publish binaries for every platform the install script claims to support, or make unsupported platforms fail with a helpful message before download.
5. Add a small automated "fresh install smoke test" that executes the exact quickstart path in CI.

## What I Tried

I approached the repo as a new user would:

- Read the top-level README, quickstart, contributing guide, security policy, package metadata, and release workflow.
- Built the current CLI from source with `cargo build -p aeqi`.
- Ran `target/debug/aeqi --help`, `setup --help`, `assign --help`, `events --help`, `agent --help`, and `doctor --help`.
- Ran a clean first-time setup in an isolated temporary `HOME`.
- Ran the recommended `aeqi doctor --strict` after that setup.
- Tested the install script with a temporary `AEQI_INSTALL_DIR`.
- Checked the current GitHub release assets for the install script matrix.
- Ran local verification commands:
  - `cargo test --workspace`
  - `npm --prefix apps/ui run check`

## What Works Well

### Build and Test Health

The Rust workspace built successfully:

```bash
cargo build -p aeqi
```

The Rust test suite passed:

```bash
cargo test --workspace
```

The UI check passed:

```bash
npm --prefix apps/ui run check
```

This is a strong signal. The repo is not a toy shell around docs; there is a large body of tested runtime behavior.

### Install Script Works on Linux AMD64

This worked from the local `scripts/install.sh`:

```bash
AEQI_INSTALL_DIR="$tmp" sh scripts/install.sh
"$tmp/aeqi" --version
```

Result:

```text
aeqi 0.14.0
```

Checksum verification also worked for the `aeqi-linux-amd64` artifact.

### Repository Hygiene Is Better Than Average

Positive open source signals:

- Top-level `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, and `LICENSE`.
- GitHub issue templates for bugs and feature requests.
- Release workflow with checksums.
- CI covers Rust, UI, security audit tooling, formatting, linting, tests, docs, and coverage.
- Clear crate/module layout in the README and contributing guide.
- The BSL license is explicit rather than hidden.

## First-Time User Experience

### Expected Path

The public path is:

```bash
curl -fsSL https://raw.githubusercontent.com/aeqiai/aeqi/main/scripts/install.sh | sh
aeqi setup
aeqi secrets set OPENROUTER_API_KEY <key>
aeqi doctor --strict
aeqi start
```

That is the right shape. A single binary plus SQLite is a compelling onboarding promise.

### Actual Path

In a clean temporary home directory, `aeqi setup` completed and wrote:

```text
~/.aeqi/aeqi.toml
~/.aeqi/agents/leader/agent.md
~/.aeqi/agents/researcher/agent.md
~/.aeqi/agents/reviewer/agent.md
~/.aeqi/agents/shared/WORKFLOW.md
```

Then the recommended command failed:

```bash
aeqi doctor --strict
```

Output included:

```text
[WARN] OpenRouter API key not set (config or secret store)
[WARN] Agent dir not found for 'leader'
[WARN] Agent dir not found for 'researcher'
[WARN] Agent dir not found for 'reviewer'
4 issues found. Run `aeqi doctor --fix` to auto-repair.
Error: doctor found 4 unresolved issue(s)
```

The agent directories did exist. This is a first-run trust break.

Likely cause: `setup` writes agents under the setup root (`~/.aeqi/agents/...`) when outside a workspace, but `doctor` uses `find_agent_dir`, which searches `agents/<name>`, `../agents/<name>`, and ancestors of the current working directory. It does not appear to search relative to the discovered config file or configured data/workspace root.

Relevant files:

- `aeqi-cli/src/cmd/setup.rs`: writes starter agents under `root.join("agents")`.
- `aeqi-cli/src/helpers.rs`: `find_agent_dir` searches from the current working directory.
- `aeqi-cli/src/cmd/doctor.rs`: reports missing agent directories through `find_agent_dir`.

## Highest-Priority Issues

### P0: Fresh Setup Fails Its Own Recommended Doctor Check

Impact: New users hit a warning/error immediately after following setup output.

Evidence:

- `setup` prints `2. aeqi doctor --strict`.
- `doctor --strict` then reports starter agent dirs missing.
- The dirs exist under `~/.aeqi/agents`.

Recommendation:

- Teach `doctor` and helpers to search relative to the discovered config path and/or configured AEQI workspace root.
- Alternatively, in non-workspace mode, run commands from `~/.aeqi` or print `cd ~/.aeqi` in next steps, but that is weaker UX.
- Add a CI smoke test:

```bash
tmp="$(mktemp -d)"
HOME="$tmp/home" aeqi setup
HOME="$tmp/home" aeqi doctor --strict
```

If a provider key is intentionally missing, either make the test use `--runtime ollama_agent` with a mocked doctor path, or separate "configuration structure" checks from live provider health checks.

### P0: README Shows Commands That Do Not Exist or Do Not Work

Impact: The CLI looks unstable from the outside.

Examples:

- README shows `aeqi event create ...`, but the CLI has `aeqi events install-defaults` only. There is no singular `event` command and no `create` subcommand.
- README shows `aeqi assign "quest description"`, but actual usage requires `--root <ROOT>`.
- README says "Add an event via CLI (`aeqi event create`)", but that command is absent.

Recommendation:

- Generate the CLI section from `clap` output or maintain a small doctested command list.
- Replace examples with commands that work today.
- If event creation is intended but not implemented, mark it as API-only or roadmap, not quickstart.

### P0: Config Example Uses Stale Schema

Impact: A contributor following `CONTRIBUTING.md` is told to copy `config/aeqi.example.toml`, but parts of it are ignored by the current parser.

Evidence:

- `config/aeqi.example.toml` uses `[[companies]]`.
- `AEQIConfig` has `agent_spawns`, and tests use `[[agent_spawns]]`.
- Running `aeqi --config copied-example config show` prints an empty `[[projects]]` section.

Recommendation:

- Update `config/aeqi.example.toml` to the current schema.
- Add a test that parses `config/aeqi.example.toml` and asserts the expected project/agent entries are loaded.
- Decide whether the public schema should be `[[projects]]`, `[[agent_spawns]]`, or something else. Do not expose all three names.

## Important Issues

### P1: Install Script Claims More Platforms Than Releases Provide

The install script supports:

- `linux/amd64`
- `linux/arm64`
- `darwin/amd64`
- `darwin/arm64`

The current latest release (`v0.14.0`) publishes only:

- `aeqi-linux-amd64`
- `aeqi-darwin-arm64`
- `SHA256SUMS.txt`

The release workflow comments out Linux ARM and does not include Darwin AMD64.

Impact:

- Intel Mac users and Linux ARM users get a download failure despite the script recognizing their platform.

Recommendation:

- Either publish all recognized targets or make the script's platform matrix match release reality.
- If a target is temporarily unavailable, fail before download with a message like:

```text
AEQI does not currently publish linux/arm64 binaries.
Build from source with: cargo build --release -p aeqi
```

### P1: Public Product Vocabulary Is Inconsistent

A newcomer sees several competing concepts:

- README says "agents are stored in the database" and "there are no agent definition files on disk".
- `setup` writes `agents/<name>/agent.md`.
- `CONTRIBUTING.md` explains agents as disk files.
- Config/code/docs use or mention `projects`, `agent_spawns`, `companies`, `organizations`, roots, entities, agents.
- The README quickstart uses `event`, while the CLI uses `events`.

Impact:

- Users cannot form a stable mental model.
- Contributors will hesitate before changing anything because it is unclear which abstraction is current and which is legacy.

Recommendation:

- Add a short "Current Vocabulary" section near the top of the README.
- Mark legacy names explicitly in code/docs or remove them from outward-facing docs.
- Make `aeqi config show` use the same vocabulary as the config file.
- Add a migration note if `companies` became `agent_spawns` or `projects`.

### P1: Quickstart Overpromises a Setup Wizard

`docs/quickstart.md` says setup prompts for provider keys and settings. Actual `aeqi setup` is non-interactive and prints next commands.

Impact:

- Not catastrophic, but it creates a small "am I in the right version?" moment.

Recommendation:

- Either implement the wizard or change the docs:

```text
`aeqi setup` is non-interactive. It writes starter config and prints the next provider-specific command.
```

### P1: README Omits Dashboard Auth Secret

The README run block sets provider key and starts AEQI, but does not mention `AEQI_WEB_SECRET`. The dedicated quickstart does mention it.

Impact:

- Users may start the server and then be unsure how to authenticate.

Recommendation:

- Include `export AEQI_WEB_SECRET=...` or explain the default auth mode in the top-level quickstart.
- Prefer a generated local secret during `setup` if the dashboard requires one.

### P1: Start Command Produces Sparse Startup Feedback

With isolated setup and `AEQI_WEB_SECRET=change-me`, `aeqi start --bind 127.0.0.1:18400` printed:

```text
Starting AEQI (daemon + web)...
WARN OpenRouter API key is empty
WARN failed to open idea store: initial_schema failed
```

Then it kept running until killed by timeout.

Impact:

- A user cannot tell whether the dashboard is ready, degraded, or broken.

Recommendation:

- Print explicit readiness:

```text
Web UI: http://127.0.0.1:8400
Daemon: running
Provider: missing OPENROUTER_API_KEY, chat disabled until configured
Ideas: BM25-only fallback active
```

- If an idea store schema failure matters, make it fatal or print the exact recovery step.

## Medium-Priority Improvements

### P2: Add a First-Run Smoke Test Script

Create one script that CI and humans can run:

```bash
scripts/smoke-fresh-install.sh
```

It should verify:

- `aeqi --version`
- `aeqi setup --runtime ollama_agent`
- `aeqi config show`
- `aeqi agent list`
- `aeqi doctor` in non-strict mode
- `aeqi start --bind 127.0.0.1:0` or equivalent readiness probe

This catches the exact failures an open source user will hit.

### P2: Separate User Docs From Internal Audit/Planning Docs

The `docs/` directory includes strong docs, but also many dated audits and internal migration plans. That is useful for maintainers but noisy for first-time users.

Recommendation:

- Keep user-facing docs in `docs/`.
- Move historical audits/plans into `docs/internal/`, `notes/`, or `docs/archive/`.
- Add a docs index with "Start here", "Operate", "Extend", "Architecture", and "Archive".

### P2: Add Copy-Paste Examples for Real Tasks

The README explains primitives well, but it needs more end-to-end examples:

- "Create a root/project and assign a quest."
- "Run one local one-shot prompt."
- "Use Ollama with no cloud key."
- "Create an idea and make it active on session start."
- "Enable one integration pack."

Each example should be tested or at least periodically checked against CLI help.

### P2: Clarify License Positioning

The BSL license is visible and explained. That is good. Still, open source users will ask: "Can I use this at work?"

Recommendation:

- Add a short "License in plain English" section:
  - allowed: self-host for internal/productive use
  - not allowed without commercial license: offering AEQI as a competing hosted or embedded service
  - converts to Apache 2.0 on April 5, 2030

This reduces legal ambiguity without replacing the license text.

## Suggested Issue Breakdown

1. Fix first-run `setup -> doctor --strict` path.
2. Replace stale README CLI examples with verified commands.
3. Update `config/aeqi.example.toml` to current schema and test it.
4. Align install script platform detection with release artifacts.
5. Add `scripts/smoke-fresh-install.sh` and run it in CI.
6. Normalize public vocabulary across README, quickstart, config, and CLI output.
7. Improve `aeqi start` readiness output.
8. Reorganize docs into user-facing docs and archive/internal docs.

## Overall Assessment

AEQI has the engineering weight of a real project, but the open-source entry point currently feels brittle because public docs and first-run behavior are out of sync with the implementation. I would not start by adding features. I would spend one focused pass making the first 10 minutes boring:

```bash
install
setup
doctor
start
open dashboard
assign first quest
```

Once that path is reliable and documented with exact commands, the existing technical depth will come through much more clearly.
