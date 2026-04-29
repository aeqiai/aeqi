# Platform-level friction

Paper cuts in the Claude Code platform itself. Project conventions can route around these, but only the Anthropic / Claude Code team can fix them at the source. This file is the shared institutional memory — when a new pattern emerges in a session, append here.

`/evolve` skill checks this file before adding session-friction notes elsewhere — anything in here is "known, unfixable from inside the session."

## Active items

### 1. TaskCreate reminder hyperactivity

**Symptom:** the `<system-reminder>The task tools haven't been used recently…</system-reminder>` reminder fires repeatedly, sometimes within a few turns of a `TaskUpdate` call. Cost: noise in context, ~1 paragraph of irrelevant reminder text per fire × ~30 fires per long session.

**Worth-noting nuance:** the reminder is calibrated for solo Opus work. When orchestrating parallel sub-agents (3-5 Haikus running in background), the agents themselves track their work via task-notification events — TaskCreate adds nothing.

**Workaround:** ignore. The reminder explicitly says "ignore if not applicable" and we follow that.

**Real fix:** trigger heuristic should check if Agent has been called within the last N turns and suppress in that window. Or move the entire reminder behind a setting.

### 2. TaskCreate / TaskUpdate are deferred behind ToolSearch

**Symptom:** every session that uses tasks (which is most multi-step sessions, per the very reminder above) costs one round-trip to ToolSearch to fetch the schema before TaskCreate is callable. That's ~500 tokens of overhead + a turn delay per session.

**Workaround:** none — the deferred-tools list is platform-controlled.

**Real fix:** move TaskCreate / TaskUpdate / TaskList to the always-loaded set. Defer instead the genuinely rare tools (CronDelete, NotebookEdit, OAuth complete_authentication) that get pulled in <1% of sessions.

### 3. "File modified by linter" reminder format misleads

**Symptom:** when prettier reformats a file after our edit, the system reminder shows the file's *first 50 lines verbatim* with `... [N lines truncated] ...`. Read fast, this looks like the file has been replaced with a 50-line stub. Burns a round-trip to re-grep / re-read and confirm intact content.

**Workaround:** know the format and trust the file is intact unless something explicitly says otherwise.

**Real fix:** show only the actually-changed hunks (a real diff), not "first N lines + truncation marker." Even just a patch-format would be clearer.

### 4. Bash cwd persistence has edge cases

**Symptom:** docs say cwd persists between Bash calls. In practice, sometimes it doesn't — observed especially after creating a worktree, cd'ing into it, then making subsequent Bash calls that ran from the original cwd. Cost: ~10 minutes of recovery on the first occurrence (a commit landed on main instead of the worktree branch).

**Workaround (now doctrine):** for git operations in worktrees, ALWAYS use `git -C /path/to/worktree <cmd>`. Never rely on `cd`. Documented in `apps/ui/CLAUDE.md`.

**Real fix:** either make persistence reliable (and document the failure modes), or document the edge cases so we don't trust it where it doesn't hold.

### 5. Skills list is long and disambiguation is hard

**Symptom:** ~30 skills surface in every system message. Most are design-flavored (`bolder`, `quieter`, `delight`, `polish`, `colorize`, `typeset`, `distill`, `clarify`, `harden`, `optimize`, `adapt`, `overdrive`, `audit`, `critique`, `animate`, `layout`). Their descriptions are similar enough that picking the right one from description-only is hard. As a result: I rarely invoke them despite doing extensive design work, and I'd guess I miss patterns that one of them is exactly built for.

**Workaround:** invoke `/impeccable` (the comprehensive design skill) which subsumes most of the others.

**Real fix:** consolidate the 30 design skills into ~5 well-differentiated ones, OR show them only when the touched files match a frontend pattern (already supported via "trigger when" / "skip" semantics in some skill descriptions, but not used consistently).

### 6. CLAUDE.md re-renders in every system reminder during worktree work

**Symptom:** every Bash tool call inside a worktree triggers a fresh system reminder that includes the FULL `apps/ui/CLAUDE.md` content (~5KB) and sometimes the root `CLAUDE.md` too (~3KB). Across a session of 200+ Bash calls in worktrees, that's ~1.6MB of CLAUDE.md re-renders eating context budget.

**Workaround:** none from inside the session.

**Real fix:** the system reminder could just say "CLAUDE.md present at <path> (read with Read tool if needed)" instead of inlining the whole file every time.

### 7. Cross-repo shared frontend code has no guardrails

**Symptom (project-flavored, but worth noting at platform level):** the same files exist in `~/aeqi/apps/ui/src/lib/analytics/` and `~/aeqi-landing/src/lib/analytics/`. Same shape, no symlink, no shared package. They will drift. Same pattern observed for `Button.tsx`, `Accordion.tsx` — landing-side and apps/ui-side both have separate definitions of the "same" primitive.

**Workaround:** convention in `~/aeqi/CLAUDE.md` pointing to a (deferred) `@aeqi/web-shared` workspace package as the canonical home.

**Real fix (project-side):** extract `@aeqi/web-shared` and migrate. Real fix (platform-side): a feature for "files that should stay in sync across projects" would catch these earlier — but that's far future.

## Resolved (kept for institutional memory)

(none yet — this file was started 2026-04-29 by the /evolve skill.)
