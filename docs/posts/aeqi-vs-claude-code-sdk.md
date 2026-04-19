# AEQI vs Claude Code Agent SDK: two takes on "the agent has context"

Anthropic's Claude Code and its Agent SDK are the cleanest production-grade agent harness on the market. They're the baseline a new runtime has to justify itself against. AEQI is a different philosophical take on the same primitive problem — *how does the model end up with the context it needs?* — and the contrast is sharper than it looks from the outside.

Both ship useful products. They disagree about who owns the prompt.

---

## What Claude Code gets right

Claude Code is fast, frictionless, and opinionated in the ways a well-designed tool should be:

- **CLAUDE.md auto-loading.** A file in the repo root is read into every session's system prompt. Zero setup, strong convention. Most teams get 80% of the benefit of a knowledge base for the cost of writing one markdown file.
- **Skills are filesystem-native.** Agents live at `.claude/agents/*.md` with YAML frontmatter declaring model, tools, and description. A skill's description determines when it gets surfaced to the parent agent. Plain files, greppable, diffable.
- **Subagents via the Task tool.** Spawn an isolated agent with its own context window and a specialized tool allowlist. Parallel research, bounded blast radius, results return as a single message.
- **Hooks are visible events.** `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`. You can log, gate, or rewrite at specific lifecycle points. This is the part of Claude Code that is genuinely anti-magic — you can see every hook that fires.
- **MCP for tool surface.** External capabilities mount as a standard protocol. Your agent gets your tools without the harness inventing a new integration layer.

If you are a working developer who wants the fastest path from "question" to "agent doing the thing," Claude Code is the right default. Its priors are: **fast defaults, good conventions, trust the harness.**

## Where AEQI diverges: the context channel

Claude Code's power also describes its contract. Several channels inject tokens into the system prompt without a line you can point at:

- **Skill auto-selection.** A skill's description is scanned against the running context; when it matches, the skill is loaded. This is useful and mostly correct. It is also non-deterministic from the operator's perspective — the same task can pull different skills on different runs.
- **Auto-memory.** Opt-in but opaque once enabled: the agent writes to a memory directory and reads from it across sessions. You can grep the files, but you can't easily answer *which memory contributed to this specific system prompt?*
- **CLAUDE.md search.** Nested `CLAUDE.md` files are discovered up the directory tree and merged. Simple and usually helpful — but the operator has to know to look up the tree to audit what's in play.

None of these are bugs. They are deliberate product choices that favor frictionless behavior over prompt-level auditability. That is the right call for the SDK's target user.

AEQI starts from the opposite prior. Every prompt token that reaches an LLM must be attributable to:

1. A user-configured event with a visible `query_template`, or
2. A visible transcript event.

That is the whole rule. No description-based skill auto-selection, no background memory recall, no silent CLAUDE.md merge. If something shows up in the system prompt, you can point at the event row in the Events page that put it there.

## The concrete difference

Claude Code's mental model:

> The harness finds the relevant context for you. Trust the defaults; inspect the files if you get surprised.

AEQI's mental model:

> The runtime only injects context that a visible event configured it to inject. There is no other channel. Preview the assembled prompt before every quest.

Mechanically this means:

- **Events are the only context channel.** `crates/aeqi-orchestrator/src/event_handler.rs`. Each event carries `idea_ids` (static references) and an optional `query_template` (dynamic semantic expansion). Nothing else reaches the model.
- **Preflight shows the assembly before tokens are spent.** `POST /api/quests/preflight` (`crates/aeqi-orchestrator/src/ipc/quests.rs:607`) runs the *same* `assemble_ideas_for_quest_start` the runtime runs, returns the exact system prompt plus the tool allow/deny set, and the UI renders it verbatim. No other agent harness in this class previews the full prompt before commit.
- **Human-in-the-loop skill promotion.** A quest's tool traces are mined for patterns (`candidate_skill_ideas_from_traces`, `scheduler.rs:1161`). Candidates land in the Ideas canvas tagged `[skill, candidate]`. Nothing injects them until a human flips the tag to `promoted`.
- **Telemetry is load-bearing.** The Events page shows `fire_count` and `last_fired` per event. When those numbers are wrong, that's a bug of the same severity as a missing tool call — and [we treat it as one](./observability-as-a-feature.md).

The trade is explicit: AEQI costs you a click to promote a skill and a preflight glance before a quest. In exchange, you never debug a mystery prompt.

## What Claude Code does better

Being honest about where AEQI is not the right pick:

- **Time-to-first-useful-run.** CLAUDE.md plus good tool defaults means a Claude Code session is productive in about thirty seconds. AEQI expects you to configure at least one event before its closed loop earns its keep.
- **Skill ecosystem.** `.claude/agents/*.md` has community momentum. AEQI's ideas are portable markdown with tags, but the ecosystem is a quarter the size.
- **Subagent ergonomics.** The Task tool with a `subagent_type` selector is genuinely excellent. AEQI has sub-agents as first-class primitives with their own ideas and events, but the spawn-and-return ergonomics are still catching up.
- **Managed hosting.** Anthropic runs Claude Code's infra. AEQI is a self-hosted Rust runtime plus a React UI — a $5 VPS works but the operational surface is larger.

## What AEQI gives you in return

- **Zero opaque behaviour.** Every tool call, every retrieved idea, every injected skill passes through a named event you can read, edit, or delete from the Events page.
- **Every prompt is auditable.** Preflight is not a debug feature — it is the same assembly code path the runtime uses. If the UI shows a prompt, that prompt is what the model will see.
- **Compounding skills without silent drift.** Skills accumulate the way a well-maintained team's playbook does: a human reviewed each entry once, you can grep the `[promoted]` tag, and the `rejected` tag keeps rationale for next quarter's audit.

## When this matters

If you are iterating solo on a greenfield project and "agent productivity" is the metric, Claude Code's priors are correct. The harness deciding some things for you is a feature.

The moment the agent touches production, or multiple agents share a worktree, or a regulator asks *why did the model produce that output?*, the contract inverts. You need to answer from a row in a database, not a dependency graph of heuristics. AEQI's bet is that this moment arrives sooner than most teams expect, and building the audit trail from day one is cheaper than bolting accountability onto a clever harness later.

Two reasonable takes on the same problem. Claude Code optimizes for "the agent just works." AEQI optimizes for "I can prove why the agent did that." Pick the one whose prior matches your blast radius.
