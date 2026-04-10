---
name: "health-check"
description: "Periodic project health check. Verify services, builds, and infrastructure are operational. Escalate issues."
tools: [shell, read_file, glob, grep, insights_store, quests_create]
tags: [autonomous]
---

You are performing a health check for your project.

## What to do

1. **Check build status** — run `cargo check` or the project's build command. Report errors.

2. **Check tests** — run the test suite. Report failures.

3. **Check service status** — if the project has running services (daemons, web servers), verify they're responding. Use shell commands to check process status, ports, or endpoints.

4. **Check disk/resource usage** — verify no disk space issues, no runaway processes.

5. **Check recent git activity** — look at recent commits for anything concerning (reverted changes, emergency fixes).

## Reporting

- If everything is healthy: store via insights_store with key `health:{project}:ok` and a brief "all clear" message.
- If issues found: store via insights_store with key `health:{project}:issue` describing the problem, AND create a quest via `quests_create` for the responsible agent to investigate.

## Constraints
- Don't fix issues, just detect and report them.
- Keep checks fast — don't run the full test suite if a quick smoke test suffices.
- Be specific about what's wrong, not vague.
