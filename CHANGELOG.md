# Changelog

All notable changes to aeqi are documented here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/) on the workspace `version` field.

Per-release detail (full commit list, contributors, artifacts) lives at
[github.com/aeqiai/aeqi/releases](https://github.com/aeqiai/aeqi/releases).

## [0.13.0] — 2026-04-25

- Add `aeqi-pack-slack` (Channels / Messages / Reactions / Users / Search) and
  `aeqi-pack-notion` (Pages / Databases / Blocks / Users) on the OAuth2 lifecycle.
- Inbox: ink-panel treatment for `question.ask` in chat; chat-reply clears
  awaiting state.
- Runtime: `ban_after_wrong` dial + denormalised `wrong_feedback_count`; cap
  wiring for tag policies.
- Hermes micro-absorptions: `max_result_chars`, completion guards.
- Prompt-cache discipline via frozen-snapshot pattern; cache breakpoints driven
  by tag policies.
- Inbox capability + ACL coherence pass; sharper `question.ask` discipline.

## [0.12.1] — 2026-04-25

- Destructive credential migration onto the credential substrate (T1.9.1).
- Director Inbox at `/` via the `question.ask` tool.

## [0.12.0] — 2026-04-25

- Add `aeqi-pack-google-workspace` (Gmail / Calendar / Meet) and
  `aeqi-pack-github` (Issues / PRs / Files / Releases / Search) packs on the
  OAuth2 / GitHub-App lifecycles.
- Wire MCP client integration into the daemon and session manager (T1.10).
- UI: integrations panel — typed API client, IntegrationCard,
  ConnectIntegrationModal, status pill primitive.

## [0.10.0] — 2026-04-25

- Collapse the connection vocab to a `mention / embed / link` substrate (3
  relations, cross-type edges).
- `sessions.search` via FTS5 over message transcripts; shared `sqlite::fts`
  helpers extracted.

## [0.9.0] — 2026-04-25

- TagPolicy gains three optional dials: blast-radius, dedup window, supersession
  default (T1.1).
- `event_invocations` records `outcome_score` and `outcome_details` (T1.2).
- `meta:placeholder-providers` resolver (T1.3) and per-item validator hook on
  `ideas.store_many` (T1.4).
- Reflection: `session:quest_end` dispatched from every terminal path (IPC
  close, LLM tool-close, queue-finalize); refresh stale event tool_calls.
- Providers: route around SiliconFlow's silent-empty bug for deepseek-v3.2.

## [0.8.0] — 2026-04-24

- Session refactor: delete `SessionType::Perpetual` and the parking loop. Every
  execution is ephemeral — one turn per spawn.
- Route web `session_send` through the `pending_messages` rail.
- Step-boundary user-message injection.
- `AgentConfig::can_self_delegate` + `session.spawn` gate.
- UI: `Combobox` and `Popover` primitives; migrate raw `<select>` callsites.

## [0.7.0] — 2026-04-20

- Truthful per-step `EventFired` emission and `session:stopped` seed event.
- Lifecycle correctness pass and second-release polish.
- UI: design-token convergence with landing (paper/card/ink); profile row in
  sidebar footer; path-based favicon.

## [0.6.0] — 2026-04-19

- **Tool-calls unification.** Events are now `pattern + tool_calls`. Single
  `ToolRegistry` for LLM-fired and event-fired calls with a `CallerKind`
  (LLM / Event / System) ACL.
- **Compaction-as-delegation.** `context:budget:exceeded` fires `session.spawn`
  + `transcript.replace_middle`. Inline compaction pipeline becomes the
  fallback when no `PatternDispatcher` is present.
- **Middleware → detectors.** Detectors fire patterns
  (`loop:detected`, `guardrail:violation`, `graph_guardrail:high_impact`,
  `shell:command_failed`); events own the response. `DEFAULT_HANDLERS`
  preserves old behavior as a fallback.
- Validate event `tool_calls` arguments against tool input schemas at save
  time.
- Event invocation trace log; lifecycle + middleware seed events.
- Persistent root agent picker in the left sidebar.

## [0.5.0] — 2026-04-11

- Unified prompt system; connection pooling; production hardening.
- Tool taxonomy: `agents_`, `quests_`, `events_`, `insights_`, `prompts_`.
- Chat refactor: precision-instrument composer, message queue during streaming,
  per-step turn separators, full-width tool content.

## [0.2.0] — 2026-04-08

- First public-tagged release. Daemon, ideas store with FTS5, quest DAG,
  middleware chain, OpenRouter / Anthropic / Ollama providers, web UI shell.
