# Windows Port — Intelligence Report

**Date:** 2026-04-27
**Status:** Gap identified, scoped, not yet executed
**Owner gap:** unassigned — flag this when scheduling

## TL;DR

aeqi has no native Windows binary. CI builds `linux/{amd64,arm64}` and `darwin/{amd64,arm64}` only. Windows users today must use Docker or WSL2.

This is **not** a fundamental constraint — Rust's `*-pc-windows-msvc` target is first-class and most peers (deno, bun, ripgrep, sqlx, just, stripe-cli) ship Windows binaries day one. It's a CI-matrix gap plus a handful of unix-only primitives in the runtime that need cross-platform abstractions.

For a product positioned as "the operating system for autonomous companies", Windows-on-laptops is a real surface. The fix is normal Rust cross-platform hygiene; the realistic estimate is **2–3 weeks of focused engineering** to land a v1 `.exe` that runs `aeqi start` end-to-end.

## Why this matters

- **Reach.** Half the desktop dev population runs Windows. Telling them "use Docker" is a tax that competitors don't charge.
- **Brand promise.** A runtime that markets itself as universal/foundational shouldn't have a "Linux-and-Mac only" caveat.
- **Onboarding loss.** The first concrete user-encountered failure (this clone) was a `:`-in-path checkout error — Windows-hostile path data. Even the polished pieces had Windows blast radius.

## Audit findings — what's actually unix-only

Searched `crates/` and `aeqi-cli/` for unix-bound primitives. Eight load-bearing categories:

### 1. IPC transport: Unix sockets everywhere — **HIGH**

`tokio::net::UnixStream` / `UnixListener` is the canonical daemon-CLI-web transport.

| File | Role |
|---|---|
| `crates/aeqi-orchestrator/src/daemon.rs:773` | Daemon listens on `~/.aeqi/rm.sock` |
| `crates/aeqi-orchestrator/src/daemon.rs:1059,1123` | Connection accept + handler |
| `crates/aeqi-orchestrator/src/ipc/session_stream.rs:9` | Streamed session IPC |
| `crates/aeqi-web/src/ipc.rs:45,85` | Web tier → daemon |
| `crates/aeqi-web/src/session_ws.rs:236` | WebSocket bridge → daemon |
| `aeqi-cli/src/cmd/primer.rs:21` | Session primer client |
| `aeqi-cli/src/cmd/mcp.rs:42` | MCP bridge client |
| `aeqi-cli/src/helpers.rs:449` | Shared CLI helper |
| `aeqi-cli/src/tui/mod.rs:734` | TUI socket presence check |

**Fix:** Abstract IPC behind a transport trait. On Windows: named pipes (`tokio::net::windows::named_pipe`) or loopback TCP on a fixed local port with token auth. Named pipes are the right peer to unix sockets — same semantics, OS-supervised, no port juggling.

**Cost:** ~1 week. Largest single workstream.

### 2. POSIX signals — **MEDIUM**

| File | Signal | Purpose |
|---|---|---|
| `daemon.rs:619-666` | SIGHUP, SIGTERM | Config reload, graceful shutdown |
| `aeqi-cli/src/cmd/config.rs:62-75` | sends SIGHUP | `aeqi config reload` |
| `aeqi-cli/src/cmd/daemon.rs:683-689` | sends SIGTERM | `aeqi daemon stop` |

**Fix:** Replace signals with control messages over the IPC channel. `SIGHUP` becomes `IpcMessage::ReloadConfig`, `SIGTERM` becomes `IpcMessage::Shutdown`. Keep signals as the unix path so muscle memory and `kill -HUP` from operators still work.

**Cost:** Cheap once IPC transport is in place. ~1 day.

### 3. systemd integration — **LOW (skippable for v1)**

`aeqi-cli/src/service.rs` generates a per-user systemd unit. Already explicitly bails on non-Linux (`anyhow::bail!("...supported on Linux systemd only")`).

**Fix options:**
- **v1: skip.** Windows users run `aeqi start` foreground. Document.
- **v2: Windows Service variant** via the `windows-service` crate. Same UX (`aeqi service install`) — different backend.

**Cost:** v1 = zero (already gated). v2 = ~3 days if/when prioritized.

### 4. bubblewrap sandbox — **MEDIUM, blocking for some flows**

`crates/aeqi-orchestrator/src/sandbox.rs` wraps shell-tool execution in `bwrap` for fs/network isolation. Linux kernel feature, no Windows equivalent.

**Fix options:**
- **v1: warn-and-run-unsandboxed on Windows.** Print a clear warning when shell tools fire; give users an opt-in flag to acknowledge.
- **v2: Windows Sandbox / `wsb` integration** — heavier, slow startup, only available on Pro/Enterprise SKUs. Not worth v1.
- **v2 alt: container per-quest** — leverage the existing `Dockerfile` story, run shell commands inside. Cross-platform if Docker Desktop is installed.

**Cost:** v1 = ~1 day (cfg-gate + warning). v2 = open question.

### 5. Shell tool hardcodes `bash` — **MEDIUM**

`Command::new("bash")` in:
- `crates/aeqi-tools/src/shell.rs:133,154`
- `crates/aeqi-core/src/shell_hooks.rs:133`
- `crates/aeqi-core/src/frontmatter.rs:195`
- `crates/aeqi-orchestrator/src/sandbox.rs:264,323`

Windows doesn't have `bash` on PATH by default (only via git-bash/WSL/MSYS).

**Fix:** Platform-aware shell selection. On Windows default to PowerShell 7 (`pwsh`) with bash as opt-in. Skill TOMLs that hardcode bash syntax become bash-only — flag those at runtime.

**Cost:** ~3 days, mostly because skill-author UX needs thought.

### 6. File permissions / security — **MEDIUM**

`std::os::unix::fs::PermissionsExt` used to set `0o600` on:
- `~/.aeqi/rm.sock` — daemon socket
- credentials cipher files
- security-tested write paths

In `secure_path.rs:329` symlink creation uses `std::os::unix::fs::symlink`.

**Fix:** Branch to Windows equivalents:
- Permissions → Windows ACLs via the `windows-acl` crate, or accept the platform default and document the weaker model.
- Symlinks → `std::os::windows::fs::symlink_dir` / `symlink_file` (requires Developer Mode or admin on older Windows; document).

**Cost:** ~3 days for proper ACL handling, or ~1 day for "document the gap" v1.

### 7. Hardcoded unix paths — **LOW**

| Location | Path |
|---|---|
| `crates/aeqi-hosting/src/types.rs:78` | `/var/lib/aeqi/hosting.json` |
| `crates/aeqi-core/src/config.rs:823` | `/var/lib/aeqi/hosting.json` |

Plus test fixtures using `/tmp/...` (low-risk; tests can stay unix-only or use `tempfile::tempdir()`).

**Fix:** Use `dirs::data_local_dir()` / `dirs::cache_dir()` for runtime data. On Windows that resolves to `%LOCALAPPDATA%\aeqi\`. Trivial.

**Cost:** ~half a day.

### 8. Shell scripts in `scripts/` — **LOW (separate concern)**

`install.sh`, `deploy.sh`, `pre-push.sh`, `security-scan.sh`, etc. are bash. Not part of the runtime — these are operator/dev tooling.

**Fix:** Add a `scripts/install.ps1` mirroring `install.sh` so PowerShell users get the same one-liner experience. Other scripts are dev-only and can stay bash.

**Cost:** ~half a day for install.ps1.

## Existing cfg-gating

`grep cfg\((target_os|unix|windows)` shows 23 hits of `cfg(unix)` and only 2 hits of `cfg(windows)` (both in `aeqi-web/src/validation.rs`). The codebase is unix-assumed throughout, with `cfg(unix)` sprinkled defensively where someone half-anticipated multi-platform.

The pattern to adopt: every `cfg(unix)` block needs a matching `cfg(windows)` block (or a properly-abstracted cross-platform helper). Today many `cfg(unix)` blocks just have nothing on the windows side — the code compiles on Windows but does the wrong thing or silently no-ops.

## CI / release pipeline gap

`.github/workflows/release.yml` matrix:

```yaml
- target: x86_64-unknown-linux-gnu
- target: aarch64-unknown-linux-gnu
- target: x86_64-apple-darwin
- target: aarch64-apple-darwin
```

Add:
```yaml
- target: x86_64-pc-windows-msvc
  os: windows-latest
- target: aarch64-pc-windows-msvc
  os: windows-latest  # cross-compile from x64 runner
```

Artifact naming: `aeqi-windows-amd64.exe`, `aeqi-windows-arm64.exe`.

`scripts/install.sh` does platform detection but only handles `linux` / `darwin` — would need a sibling `install.ps1` for Windows, since PowerShell can't run `.sh`.

## Workstream brief

Five parallelizable tracks. Recommended order: **WS-1 must land before WS-2/WS-3/WS-5** (they all depend on the IPC abstraction).

| WS | Scope | Est. | Dependency |
|---|---|---|---|
| **WS-1** | IPC transport trait — unix socket on unix, named pipe on windows | ~1 wk | none |
| **WS-2** | Replace SIGHUP/SIGTERM with IPC control messages | ~1 day | WS-1 |
| **WS-3** | Shell tool: PowerShell on windows, bash on unix | ~3 days | none |
| **WS-4** | File-permissions, symlinks, hardcoded paths cross-platform | ~1–3 days | none |
| **WS-5** | Sandbox: cfg-gate bwrap, warn-and-run-unsandboxed on windows | ~1 day | none |
| **WS-6** | CI matrix: add `*-pc-windows-msvc` targets, write `install.ps1` | ~half day | WS-1..WS-5 green |

**Total focused effort: ~2.5 weeks** for a v1 `aeqi-windows-amd64.exe` that boots, talks to itself over named pipes, runs PowerShell shell tools, and ships from CI.

## Acceptance criteria for v1 Windows

- [ ] `cargo build --release --target x86_64-pc-windows-msvc` green in CI on every release.
- [ ] Release pipeline publishes `aeqi-windows-amd64.exe` and `aeqi-windows-arm64.exe` as GitHub release assets.
- [ ] `scripts/install.ps1` mirrors `install.sh` UX — one-line `iwr | iex` install.
- [ ] On a fresh Windows 11 box: `iwr install.ps1 | iex` → `aeqi setup` → `aeqi secrets set OPENROUTER_API_KEY <key>` → `aeqi start` opens the dashboard at `http://localhost:8400`.
- [ ] `aeqi chat --agent cto` works — full IPC roundtrip on named pipes.
- [ ] At least one shell-using skill (e.g. `code-review`) runs end-to-end with PowerShell on the windows side.
- [ ] Sandbox warning is printed on first shell-tool fire on Windows; user can opt in via `--allow-unsandboxed` or a config flag.
- [ ] README "Quick Start" gets a Windows section with the install.ps1 one-liner — alongside, not below, the Linux/macOS path.

## Out of scope for v1 (deferred to v2)

- Windows Service installer (`aeqi service install` on Windows). v1 = foreground only.
- Native Windows sandboxing (Windows Sandbox or container-per-quest).
- Full ACL parity for credential file permissions — v1 documents the weaker security model and points users at the runtime-native key wallet flow when it lands.
- arm64 windows native CI build — cross-compile is fine, but native test runner on `windows-11-arm` runners can wait until the user demand is real.

## Risks & open questions

- **IPC token auth on loopback TCP fallback.** If named pipes prove too painful (they're slightly different from unix sockets in tokio's API), the fallback is loopback TCP. That introduces a new attack surface — any local process can connect to `127.0.0.1:NNNN`. Mitigate with a per-startup token written to `%LOCALAPPDATA%\aeqi\auth.token` with restricted ACL, presented on every connect. **Decision pending — defer to WS-1 author.**
- **PowerShell vs `pwsh` vs bash.** Some skills will hardcode bash syntax (`grep`, `awk`, pipefail). We need a per-skill `shell:` field in skill TOMLs (`shell = "bash"` / `shell = "powershell"` / `shell = "auto"`). Touches the skill schema — cheap if done early, painful as a retrofit.
- **Will Docker Desktop on Windows be the recommended path even after the native port lands?** For users who want sandbox parity, yes. The native binary is for laptop dev / quick-start; the Docker path stays as the production-on-Windows-server story.

## Why this report exists

Solo project, fast-moving, easy to lose the long-tail issues. The user noticed the gap during the first Windows clone attempt — `error: invalid path '.sigil/persist/sigil:sigil:1/entity_memory.md'` — which we've already fixed at the data level. But that bug was a symptom: the project as a whole has never been exercised on Windows. This report exists so the next person who picks up the runtime knows exactly what's missing, what the fix shape is, and how big it is, without having to redo the audit.

Update this file when:
- Any of the workstreams ship — strike the row, link the PR.
- New unix-only code lands — append it to the audit table.
- Estimates change after WS-1 lands and the IPC pattern is concrete.
