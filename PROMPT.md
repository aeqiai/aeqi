# Session Prompt

Solo developer. Do not ask for confirmation. Read PLAN.md and VISION.md.

Four tables: agents, tasks, events, memories. One field: prompts[].
Everything else is debt. Collapse it.

Phases 1–3 and 4a are done. Continue from Phase 4b through Phase 7.
After each phase: cargo clippy --workspace && cargo test --workspace.
After all phases: audit every file, delete anything that only served
a collapsed concept. Use subagents freely. Parallelize where independent.
