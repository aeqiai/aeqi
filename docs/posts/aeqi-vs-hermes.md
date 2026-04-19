# AEQI vs Hermes Agent: two takes on the learn-from-runs loop

The autonomous-agent landscape has converged on a single idea: the agent should get better at your codebase the longer it runs. Hermes Agent (NousResearch, 90k+ stars) ships this as auto-promoted skills backed by FTS5 session recall and a persistent user model. AEQI ships it as a four-primitive runtime — agents, ideas, quests, events — where every injected prompt token is traceable back to a configured event with a visible query template.

Both are correct about the problem. They disagree about the contract with the user. This is the cleanest A/B in the category right now, and the contrast is worth writing down.

---

## What Hermes does well

Hermes makes a credible pitch as a solo-developer autonomous agent. The README-visible surface is strong:

- **Autonomous skill creation after complex tasks**, with "skills self-improve during use." When the agent solves something non-trivial, it crystallises the pattern into a reusable skill without the operator having to curate.
- **FTS5 session search with LLM summarisation** for cross-session recall. Past conversations are queryable by content, and the retrieved snippets are compressed by an LLM before being handed back to the model.
- **Honcho dialectic user modelling.** A persistent model of the user's preferences and working style accumulates across sessions and influences behaviour on future runs.
- **Cheap deployment.** It's designed to run unattended on a $5 VPS — Docker, SSH, or serverless — talking back through a gateway module.

The architecture, as far as one can read it from the repository (`agent/`, `skills/`, `hermes_cli/`, `hermes_state.py`, `hermes_logging.py`, `gateway/`), is sensible and modular. The `skills/` directory implements the `agentskills.io` open standard, which means portability across harnesses if that standard gets traction.

If you're a solo developer who wants a coding agent that runs 24/7 on a cheap box and quietly gets better, Hermes is a reasonable default. Its priors are: **less friction, more autonomy, trust the loop.**

## Where AEQI diverges: the anti-magic principle

AEQI starts from the opposite prior. Every prompt token that reaches an LLM must be attributable to:

1. A user-configured event with a visible `query_template`, or
2. A visible transcript event.

That's the whole rule. No background memory recall, no opaque "relevant context" auto-attach, no long-running user model silently steering the next turn. If something shows up in the system prompt, you can point at the event row that put it there.

Mechanically this means:

- **Events are the only context channel.** Defined in `crates/aeqi-orchestrator/src/event_handler.rs`. Each event carries `idea_ids` (static references) and an optional `query_template` (dynamic expansion). Nothing else reaches the model.
- **Preflight shows the assembly before any tokens are spent.** `POST /api/quests/preflight` (`crates/aeqi-orchestrator/src/ipc/quests.rs:607`) calls the same `assemble_ideas_for_quest_start` that the runtime calls, returns the exact system prompt plus the tool allow/deny set, and the UI renders it for the user to inspect. No other agent harness in this class previews the full prompt before commit.
- **Human-in-the-loop skill promotion.** Candidate skills are written to the ideas store tagged `[skill, candidate]`. Nothing injects them until a human flips the tag to `promoted` in the Ideas canvas (`apps/ui/src/components/IdeaCanvas.tsx:249`, `handlePromote`).

The trade is explicit: AEQI costs you a click to promote a skill. In exchange, you never debug a mystery prompt.

## The closed loop, line by line

AEQI's learning loop (internal codename lu-005) closed end-to-end in the last week. Here is the flow, with the exact files a skeptical engineer should read:

**1. Tool invocations are persisted as transcript events.** During a quest, each `ChatStreamEvent::ToolComplete` the worker emits is persisted into `session_messages` with type `tool_complete`. See `persist_tool_complete` in `crates/aeqi-orchestrator/src/agent_worker.rs:1955`. The regression tests at lines 2005–2052 pin that only `ToolComplete` variants survive the filter, so text deltas and other streaming events don't get misclassified (commit `bcb6276`, landing on top of the feature in `8d1a4e8`).

**2. On quest completion, the scheduler's post-complete hook looks at the trace.** In `crates/aeqi-orchestrator/src/scheduler.rs:922`, immediately after `complete_run` and the `quest_completed` activity emission, the scheduler calls `ss.tool_traces_for_quest(&quest_id)` and feeds the traces to `candidate_skill_ideas_from_traces` (`scheduler.rs:1161`). The rule is deliberately dumb: any tool invoked at least twice within the quest becomes one candidate-skill idea. Dumb is the feature — the rule is legible to the operator.

**3. The candidate is written as an idea, tagged `[skill, candidate]`.** `scheduler.rs:929-940`. It does not reach any prompt yet. It shows up in the Ideas canvas under a Candidate Skills section.

**4. A human promotes or rejects.** In `apps/ui/src/components/IdeaCanvas.tsx`, `handlePromote` (line 249) swaps the `candidate` tag for `promoted`. Reject (line 266) swaps for `rejected` and appends a rationale section to the idea body so you can read back why later. The UI blocks both buttons until the operator has seen the candidate.

**5. The next quest picks the promoted skill up.** The default `session:quest_start` event carries `query_template: "skill promoted {quest_description}"`. When the scheduler fires `on_quest_start` (`scheduler.rs`, around the `quest_start` dispatch wired in commit `3a46767`), `assemble_ideas_for_quest_start` in `crates/aeqi-orchestrator/src/idea_assembly.rs:62` expands the template against the live `AssemblyContext`, runs `hierarchical_search` over the ideas store (`idea_assembly.rs:184`), and merges the returned ideas into the system prompt after the static idea_ids. Only `promoted` skills match, because rejected ones have been renamed and retagged.

**6. Preflight shows exactly that assembly before the user clicks Run.** `handle_quest_preflight` (`ipc/quests.rs:607`) runs the same assembly path against an `AssemblyContext` seeded with the quest description and returns the full system string plus tool allow/deny. The UI renders it verbatim. If a promoted skill is going to be injected, you see its content before any tokens are spent. If nothing is going to be injected, you see the empty preamble and know no silent recall is in play.

The whole chain is pinned by regression tests. `quest_start_query_template_pulls_promoted_skills` in `idea_assembly.rs:379` asserts the full loop. Its sibling at line 449 pins the earlier LIKE-prefix bug where `session:start` could accidentally match `session:quest_start` — that regression cost a real afternoon when `get_events_for_pattern` was using a naive prefix match, and the test exists so it never reaches prod again.

Six stages. Six files. Every stage has a test. Every stage is legible to the operator.

## What AEQI gives up

Being honest about the trade:

- **Promotion is manual.** If you do not want to think about which skills are good, Hermes is less work. AEQI assumes you would rather spend ten seconds reviewing a candidate than debug an agent that learned the wrong pattern a week ago.
- **FTS5 snippet highlighting is still catching up.** Hermes has invested more in session-level search UX. AEQI's ideas search (`crates/aeqi-ideas/src/`) does semantic + hybrid retrieval but the UI surface for browsing results is younger.
- **No out-of-the-box Honcho-style user model.** You get tags, scoping, and events. If you want a dialectic user model, you build it as ideas + an event that injects the current profile — which is either a feature or a chore depending on your taste.
- **Deployment is heavier.** AEQI is a Rust runtime plus a React UI. A $5 VPS works, but the operational surface is larger than a single Python CLI.

## What the user gets in return

- **Zero opaque behaviour.** Every tool call, every retrieved idea, every injected skill passes through a named event that you can read, edit, or delete from the Events page.
- **Every prompt is auditable.** The preflight endpoint is not a debug feature — it is the same code path the runtime uses. If the UI shows a prompt, that prompt is what the model will see.
- **Compounding skills without silent drift.** Skills accumulate the way a well-maintained team's playbook does: someone reviewed each entry once and can grep for the justification later.

## When this matters

If you are using a coding agent as a faster autocomplete on a personal project, opaque magic is fine — the blast radius is your own sanity, and Hermes is a great fit.

The moment the agent touches production, or multiple agents share a worktree, or the domain is regulated, the contract inverts. You need to be able to answer *why did the agent just do that?* without reading a dependency graph of learned behaviours. AEQI's bet is that this moment is close enough, and common enough, that building the loop anti-magic from day one is cheaper than retrofitting accountability onto a clever heuristic.

Two reasonable takes on the same problem. Pick the one whose prior matches your blast radius.
