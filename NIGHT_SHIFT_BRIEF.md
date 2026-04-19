# Night Shift Brief — 2026-04-18

Target runtime: ~7 hours (overnight). Owner is asleep. Work autonomously.
This file survives compaction. If you wake up and don't know what you're doing, **re-read this**.

## Mission

Ship a working MVP of AEQI that the user can wake up to and just use. The four critical
pages are the focus: **Ideas, Events, Quests, Settings** (per agent). Runtime + pages.

## Execution model

- Orchestrator (me): Opus 4.7. Stays alive, plans, reviews, merges.
- Subagents: `sonnet` model (= Claude Sonnet 4.6, 1M context per user belief).
  User said "opus 4.6" but there's no such model — 4.6 = Sonnet. Use `sonnet` for
  downstream work, reserve `opus` for hard reasoning tasks.
- Use git worktrees (Agent `isolation: worktree`) so parallel agents don't stomp.
- Use CronCreate for a 5-minute Telegram update cadence.
- Use ScheduleWakeup to self-pace continuation between cron firings if needed.

## Telegram cadence (every 5 min)

Send a Telegram update to the Luca channel:
- What I did in the last 5 min
- What I'm working on now
- How many subagents are active
- Any blockers

Discovery order for Telegram channel config:
1. `git grep -i telegram` in aeqi repo
2. Check `/home/claudedev/aeqi/crates/*/src` for telegram integrations
3. Check AEQI MCP `agents(action='get')` or ideas search
4. If a bot+chat_id are stored in env or config, use those.

## In-progress refactor (resume first)

We're mid-commit-2 of a 6-commit refactor (context-injection via events). Status:

- [x] Commit 1: purge MD primers, strip `shared_primer` / `project_primer` plumbing
- [~] Commit 2: event schema + query_template + query_top_k (backend done, need
      idea_assembly.rs integration + UI types + UI form)
- [ ] Commit 3: purge silent context injection in agent.rs (memory prefetch, mid-loop
      recall, maybe_extract_session_ideas)
- [ ] Commit 4: ChatStreamEvent variants FileChanged, FileDeleted, ToolSummarized;
      extend Compacted with restored_files; UI chips
- [ ] Commit 5: agent config context_cap_tokens, tool_output_cap_bytes, watch_files;
      wire session:step_start per LLM iteration
- [ ] Commit 6: secret redaction regex in idea_store.store() for Telegram tokens,
      sk-* keys, Bearer tokens + unit tests

Principle: **events = context-injection policies** (static idea_ids + dynamic
query_template with semantic recall). Agents carry budget policies. Ideas are the
only persistent context. Placeholder semantics = option B (loose, unknown pass
through literally).

## After the refactor

1. `cargo fmt && cargo clippy --workspace -- -D warnings && cargo test --workspace`
2. `cd apps/ui && npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}"`
3. Deploy via `./scripts/deploy.sh` (restarts aeqi-runtime.service and aeqi-platform.service)
4. Commit + push.
5. Update contribution guidelines (spawn a subagent).

## Night-shift tracks (after refactor ships)

Run these in parallel worktrees, each as a Sonnet subagent. Merge sequentially.

### Track A — Quests page
- First page = create-a-new-quest form in left column; list all quests in middle.
- Quest editing should feel as exciting as idea editing (simple, logical).
- Detail panel with description, status, worktree path, assigned agent.
- Reuse `asv-sidebar` / `asv-main` layout pattern.

### Track B — Ideas page polish + FTS5
- FTS5 search sublime: BM25 tuning, tag-facet sidebar, snippet highlighting.
- Code indexing must work automatically (file watcher → idea store).
- Edges (links between ideas) visible.
- The `code` tool should resolve symbols via indexed ideas.

### Track C — Events page polish
- Expose the new `query_template` + `query_top_k` fields.
- Live "last fired / fire count / total cost" badges.
- Test-trigger button (wire to `handle_trigger_event`).

### Track D — Settings page
- Per-agent budget policy form (context_cap_tokens, tool_output_cap_bytes, watch_files).
- Model selector. Tool deny list. Worktree root.

### Track E — Runtime dogfooding
- Spawn an AEQI agent. Run real prompts. Capture transcripts.
- Look for magic/opinionated behavior leaks. File quests for fixes.

### Track F — Seed ideas from trending repos
- Clone trending Claude-Code-related repos under `/home/claudedev/aeqi/tmp/trending/`:
  - Karpathy's claude-code + obsidian setup
  - Hermes agent
  - OpenCode / opencals
  - AgentStack / superpowers / claudecodelearn / claude-code-learn
  - Last week + last month GitHub trending for "claude-code"
- Extract distilled ideas → store as AEQI ideas with `tags: ['seed', 'external', '<repo>']`.

### Track G — Compare against Claude Code source leak
- Location: `/src/` at the server root (official claude-code source leak).
- Compare AEQI runtime against it. Document gaps & wins in an idea.

### Track H — Contribution guidelines
- Spawn a subagent to rewrite `CONTRIBUTING.md` (or create one) based on the
  4-primitive architecture + CLAUDE.md development standards.

### Track I — Beat Karpathy's setup
- UI/UX and intelligence-wise. Visual polish on all four pages.
- Hermes agent: produce a response/competitive doc once we've eclipsed it.

## Hard constraints

- **No magic behavior.** Every runtime action must be either user-configured or emit
  a visible transcript event.
- **No MD primers.** Context flows through ideas only.
- **No silent LLM injection.** If the runtime injects, it emits a transcript event.
- **Zero warnings, zero clippy lints, zero unused variables.**
- **Never force-push main. Never bypass hooks.**

## Self-prompt template for the cron / wakeup cycle

When fired, do:
1. Read this file.
2. Check what's committed vs. planned (git log + status).
3. Check subagent states (TaskList).
4. Pick the highest-value next step.
5. Execute (spawn subagent or work directly).
6. Send Telegram update.
7. Schedule next wakeup / let cron fire.

## Do not forget

- Send TG update every 5 min.
- Use worktrees for parallel agents.
- Deploy + restart both services when shipping backend changes.
- Keep four pages the north star.
