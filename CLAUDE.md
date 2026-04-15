# AEQI

Unopinionated agent runtime. Four primitives: agents, ideas, quests, events.

## Using AEQI MCP

Use the AEQI MCP tools to access project context:
- `ideas(action='search', query='...')` — search knowledge, context, skills
- `ideas(action='search', tags=['skill'])` — find available skills/workflows
- `ideas(action='store', name='...', content='...', tags=['...'])` — save knowledge
- `quests(action='list')` — see open work items
- `agents(action='get')` — get current agent context + assembled ideas
- `events(action='list')` — see configured events

## Development Standards

### Before every commit
```
cargo fmt
cargo clippy --workspace -- -D warnings
cargo test --workspace
cd apps/ui && npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}"
```
All must pass. The pre-commit hook enforces this.

### Code quality
- Zero warnings, zero clippy lints, zero unused variables
- No backward compatibility aliases, stubs, or dead code
- No comments about removed code
- No `#[allow(dead_code)]` unless justified
- Use `spawn_blocking` for all SQLite operations in async context

### Frontend
- Prettier enforced (double quotes, trailing commas, 100 width)
- Components extracted to own files (no 500-line monoliths)
- Path-based routing: `/agents/:id/:tab/:itemId`
- Reuse `asv-sidebar` / `asv-main` pattern for split layouts
- Design system: `apps/ui/src/styles/primitives.css` for tokens

### Architecture
- Events = pattern + idea_ids. 6 session events.
- Ideas have tags (Vec<String>), no category field
- Quest owns worktree. Session owns nothing.
- Every execution in bwrap (when available)
- Auto-commit at end of turn in quest worktrees
- Tools configurable per agent via tool_deny

### Deploy
```
./scripts/deploy.sh
```
