# Claude Code vs AEQI: Competitive Analysis

_Date: 2026-04-19. Claude Code repo: anthropics/claude-code (public, shallow clone)._

---

## What Claude Code Does Better

**1. Rich plugin ecosystem with marketplace distribution.**
Claude Code has a full plugin system: slash commands, specialized agents, hooks, skills, and MCP servers packaged together under a `plugin.json` manifest. Plugins are installable from a marketplace via `/plugin install`. AEQI has presets and skills but no equivalent installable plugin unit — extending AEQI requires editing the repo or writing MCP tools by hand.

**2. Lifecycle hooks that fire on real events.**
Claude Code's hook system (PreToolUse, PostToolUse, Stop, SessionStart, PreCompact) lets users intercept any tool call in-process and either block, warn, or modify its input — all defined in markdown config files, no code required. AEQI has `shell_hooks.rs` and bwrap sandboxing, but the user-facing hook authoring experience is absent. There is no equivalent to `/hookify "block rm -rf"` in AEQI today.

**3. Structured multi-phase feature workflow (`/feature-dev`).**
The feature-dev plugin orchestrates a 7-phase workflow: discovery → codebase exploration (parallel subagents) → clarifying questions → architecture design (parallel subagents, 3 options presented) → implementation → review (parallel subagents) → summary. This is systematic and repeatable. AEQI has quests (worktree-scoped tasks) but no opinionated workflow that guides a developer from vague requirement to reviewed code.

**4. Polished terminal UX and keyboard ergonomics.**
Fullscreen mode, `/effort` slider, `/tui`, `/loop`, `/recap`, `/context`, `/resume` with session picker, push notifications via Remote Control, clickable URLs via OSC 8 — Claude Code has invested heavily in the interactive experience. AEQI's UI is React-based (separate from the terminal) and the CLI is functional but comparatively bare.

**5. Granular permission model with deny-list rules.**
`permissions.deny` rules, `sandbox.network.deniedDomains`, per-path allow/deny for Bash with glob matching, protection against `env`/`sudo`/`watch` wrappers — the security model is defense-in-depth and auditable. AEQI uses bwrap + `tool_deny` per-agent, which is correct architecturally, but the deny-list configuration surface is smaller.

---

## What AEQI Does Better

**1. Persistent, queryable knowledge (Ideas).**
AEQI's idea store with FTS5 + vector hybrid search is a first-class primitive. Context is not injected silently — events fire explicitly and attach idea_ids. Claude Code has no persistent memory between sessions beyond what you put in CLAUDE.md; there is no structured recall or semantic search built in.

**2. Explicit event-driven context assembly.**
AEQI events (pattern + idea_ids + query_template) give the developer precise control over what context enters the agent at runtime. Claude Code's session context is assembled by the runtime heuristically. AEQI's approach is auditable and reproducible.

**3. Multi-agent tree with scoped identity and memory.**
AEQI's `AgentConfig.ancestor_ids` enables hierarchical memory scoping — a subagent can recall its parent's context without any special prompt injection. Session types (Perpetual vs Async) with formal delegation rules prevent runaway recursion. Claude Code subagents are powerful but the memory scoping across agent generations is informal.

**4. Secret redaction before persistence.**
AEQI's `sanitize.rs` / `security.rs` scrub secrets before writing to the idea store. This is architectural, not advisory. Claude Code relies on privacy safeguards described in policy docs.

**5. Rust backend with SQLite — no Node.js runtime required.**
AEQI compiles to a single binary. Claude Code's CLI moved to a native binary recently (2.1.113) but historically was a Node.js bundle and still scaffolds around npm tooling.

---

## Top 3 Stealable Ideas

### 1. Markdown-config lifecycle hooks (from hookify)
A user-writable `.aeqi/hooks/` directory where each file is a markdown doc with YAML frontmatter defining `event`, `pattern`, `action: block|warn`. AEQI's MCP server reads these at session start and runs them as PreToolUse / PostToolUse interceptors. No Rust recompile, no config schema — just drop a file. The patterns feed directly into AEQI's existing event system.

### 2. Structured multi-phase quest workflow command
A `/feature-dev`-equivalent command (could be an AEQI skill or quest template) that launches parallel code-explorer subagents, gates implementation behind explicit approval, then runs parallel reviewer subagents and presents findings before marking the quest done. AEQI already has worktree-scoped quests and a subagent delegation model — the missing piece is a canned workflow that chains these phases with user checkpoints.

### 3. `/recap` — session re-entry summary
When resuming a session after N minutes away, run a cheap summarization pass over the transcript and surface a 3-bullet "here's where you were" note. AEQI already compacts sessions and has `session_file` for resumability. A recap step fired by the Perpetual session loop on re-entry (detect gap > threshold) would be a small addition to the agent loop with high daily value for a solo developer.

---

## Summary

Claude Code wins on **developer experience surface area**: hooks, plugins, terminal polish, and structured workflows. AEQI wins on **architectural correctness**: explicit context, persistent queryable memory, scoped multi-agent identity, and secret hygiene. The biggest single gap is hooks — Claude Code users can intercept and modify any tool call from a markdown file; AEQI has no equivalent user-facing mechanism today.
