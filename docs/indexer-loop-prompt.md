# /loop metaprompt — indexer build heartbeat

This is the prompt that fires every 5 minutes during the autonomous indexer build session. The user is asleep; I am operating per their explicit authorization to ship without asking.

---

## Your task this tick

1. **READ STATE FIRST.** Read `/home/claudedev/aeqi-indexer-build/docs/indexer-build-log.md` end-to-end before doing anything. The "Current state" block tells you where we are. The "Per-tick log" tells you what's been tried. The "Decisions made" block tells you what's locked.

2. **READ THE SPEC if uncertain.** `/home/claudedev/aeqi-indexer-build/docs/aeqi-indexer-spec.md` is the architectural contract. Don't deviate without writing the deviation in "Decisions made".

3. **IDENTIFY THE HIGHEST-LEVERAGE NEXT ACTION** from the "Plan" section. Honest assessment: what gets us closest to the north-star (working end-to-end TRUST creation flow indexed into SQLite + queryable via GraphQL) per unit time?

4. **EXECUTE IT.** Write code. Run commands. Spawn subagents. All work happens in the worktree at `/home/claudedev/aeqi-indexer-build`.

5. **UPDATE THE BUILD LOG.** Append a new entry to "Per-tick log" with: tick #, what you did, what you discovered, what's next. Update "Current state" if state advanced.

6. **COMMIT IF CODE CHANGED.** `git -C /home/claudedev/aeqi-indexer-build add -A && git commit -m "indexer(phase-N): <what>"`. Use `git -C` because cwd may not persist.

## Constraints (locked, do not override)

- **Never ask the user.** They're asleep. Figure it out, document trade-offs in the log.
- **Stay in the worktree** at `/home/claudedev/aeqi-indexer-build`. Never edit main directly.
- **Time-box: 30 min max per blocker.** If you've been on the same problem 30+ min, document the blocker, switch to the next leverage point.
- **Always end the tick by updating the build log + committing.** Do not leave uncommitted work between ticks — next-tick-you doesn't know what you're holding.
- **Use subagents liberally** for parallel work:
  - **Haiku** for fast read-only exploration (read this file, find this pattern, list these symbols)
  - **Sonnet** for implementation (write this Rust module, port this handler)
  - **Opus** for hard architectural decisions (review this design choice, propose a strategy)
  - Spawn agents in parallel via single message with multiple `Agent` tool calls
- **Run `cargo check`** after every meaningful Rust edit to catch type errors early.
- **No clippy lint suppressions** without justified comment. CLAUDE.md is strict.
- **Use `spawn_blocking` for SQLite calls in async context** per CLAUDE.md.
- **Edition 2024.** Some syntax differs from older Rust.

## What to do FIRST in this tick

1. Read `indexer-build-log.md` and check the "Current state" → "NEXT ACTION" field.
2. Do that next action.
3. If "NEXT ACTION" says "verify cargo check passes" — check the output file path also in "Current state" or run `cargo check -p aeqi-indexer` again. If green, mark phase done in "Plan" + advance.

## North star (do not lose sight of)

The user wants real on-chain Company creation: Blueprint → DAO deployed on local Anvil → user as director → governance transition → events indexed → mirrored into apps/ui Treasury / Ownership / Roles tabs.

**Highest-leverage chain (the path):**
```
[Phase 0] Anvil + aeqi-core deployed locally
    ↓
[Phase 1] WSS log subscription + reorg-safe block tracking
    ↓
[Phase 2] Schema layer (Account, TrustContract, Module, Role, etc.)
    ↓
[Phase 3] Static handlers — Factory.TRUST_Created landing in `trusts` SQLite row
    ↓
[Phase 3] async-graphql exposes `trust(id: ID!)` query
    ↓
[Phase 4] Dynamic module dispatch — Role module activated → events indexed
    ↓
[Phase 5+] Module handlers, eth_call backfills, stats
    ↓
[Integration] apps/ui Treasury / Ownership / Roles tabs query the indexer
```

Each tick: ask "which link in this chain am I making real?" and work on that.

## How to handle long-running operations

- `cargo build` / `cargo test` may take minutes. Use `run_in_background: true` and Bash. Capture output file path in build log. Next tick: check the output file.
- If a tick fires while a background task is running, do something orthogonal (read code, write docs, plan). Do not block on the same task.

## How to handle subagent calls

- Subagents return output to the parent. The output is NOT visible to next-tick-me. So if you spawn a subagent for important info: **distill the result into the build log** before ending the tick.
- Subagents take 30-60+ seconds. Spawn them in parallel when possible.

## The "stuck" exit ramp

If after 3 consecutive ticks you're making no progress and the same blocker is unresolved:
1. Spawn an Opus agent to think deeply about the blocker
2. Document its conclusion in "Decisions made"
3. Pivot to a different leverage point if Opus says the current path is wrong
4. NEVER waste 5+ ticks looping on the same blocker without escalating

## Don't do these things

- Don't claim things are done that aren't
- Don't skip cargo check / cargo test before committing
- Don't re-derive a decision that's already in "Decisions made"
- Don't write code without an immediate next step in mind
- Don't refactor working code to make it "nicer"
- Don't introduce new dependencies without writing them in "Decisions made"
- Don't ship to main from the worktree — that's `/ship`'s job and only when a phase is complete + smoke-passed

## End-of-tick checklist

Before ending this tick, ensure:
- [ ] Build log "Current state" is accurate and reflects this tick's work
- [ ] "Per-tick log" has a new entry
- [ ] Any code changes are committed in the worktree
- [ ] If a phase is done, mark it ✓ in the "Plan" section
- [ ] If something is blocked, it's in "Blockers encountered" with a sentence on why
- [ ] If a major decision was made, it's in "Decisions made"

This is not optional. The build log is the only memory between ticks.

---

GO.
