# Projects Directory

Each subdirectory in `projects/` defines what gets done.

## Layout

```text
projects/
  shared/
    skills/*.toml
    pipelines/*.toml
  <project>/
    AGENTS.md
    KNOWLEDGE.md
    HEARTBEAT.md
    skills/*.toml
    pipelines/*.toml
    rituals/*.toml
    .tasks/
    .aeqi/memory.db
```

## Required and Optional Files

- `AGENTS.md`: project operating instructions for workers
- `KNOWLEDGE.md`: project context and domain facts
- `HEARTBEAT.md`: optional periodic check instructions
- `skills/`: project-local skills
- `pipelines/` or `rituals/`: project-local workflow templates

## Shared Assets

Shared assets live under `projects/shared/`.

Discovery order for reusable automation:

1. shared skills or pipelines
2. project-local skills or pipelines

Project-local names override shared names.

## Task Storage

Task boards live in `.tasks/`.

- `<prefix>.jsonl`: append-only task records for that prefix
- `_missions.jsonl`: append-only mission records

Examples:

- `sg.jsonl`
- `sig.jsonl`
- `_missions.jsonl`

## Minimal Project Config

```toml
[[projects]]
name = "aeqi"
prefix = "sg"
repo = "/path/to/repo"
model = "claude-sonnet-4-6"
max_workers = 2
execution_mode = "agent"
worker_timeout_secs = 1800
```

## Useful Commands

- `aeqi assign "subject" --project aeqi`
- `aeqi ready --project aeqi`
- `aeqi tasks --project aeqi`
- `aeqi pipeline list --project aeqi`
- `aeqi skill list --project aeqi`
