# Onboarding Excellence Loop

AEQI onboarding should improve by running itself. Every pass through install,
setup, first quest, MCP, and contributor setup should leave one clearer
sentence, one sharper check, or one filed product gap.

## Self-Prompt

Use this prompt for operator or contributor review runs:

```text
Run the AEQI onboarding loop for this environment. Identify the path I am on
(hosted COMPANY, local demo, self-hosted runtime, or source contributor), verify
the runtime home and source checkout are not confused, complete the smallest
useful success path, and leave one concise improvement with evidence.

Report:
- lane and environment
- commands or UI path used
- runtime home, source checkout, and active config path
- what success looked like
- one blocker, friction point, or doc/code improvement
- exact rollback or cleanup step, if any
```

## Lane Model

| Lane | Owner question | Success signal | Evidence |
| --- | --- | --- | --- |
| Operator | Can I run or connect to a runtime? | `doctor --strict` passes, dashboard or hosted session opens, first quest persists | dashboard URL, runtime home, config path, quest id/result |
| Contributor | Can I build and change AEQI safely? | source checkout builds or the targeted check passes without contaminating runtime state | checkout path, command output, changed files |
| Runtime | Is the daemon healthy after setup? | daemon, web bind, provider, SQLite state, and secrets path are all where expected | `aeqi start` readiness plus DB/config paths |
| MCP | Can an external client use AEQI as system of record? | MCP tools can read agents, ideas, quests, and events from the intended COMPANY/runtime | client config, runtime URL, successful tool call |
| Docs | Can the next person avoid this confusion? | the shortest accurate doc path now names the state, command, and verification | doc diff and link target |

Each onboarding issue belongs to one lane first. If it spans lanes, file or
link follow-up work instead of blending responsibilities in one doc or PR.

## Success Criteria

An onboarding pass is complete when a new operator or contributor can answer:

- Which mode am I using: hosted COMPANY, local demo, self-hosted runtime, or
  source checkout?
- Where is runtime home: usually `~/.aeqi`, unless `--workspace` was chosen?
- Where is source: the git checkout that can be rebuilt or edited?
- What command proves state is healthy: `aeqi doctor --strict`, `aeqi start`,
  `aeqi monitor --watch`, or a targeted build/test?
- What durable artifact was created: first quest, MCP call, doc patch, or filed
  quest?

Stop adding setup layers until the current lane has one clean success signal.

## Cadence

Run the loop as a scheduled operator habit:

```cron
# Daily: catch broken first-run paths quickly.
15 9 * * * aeqi assign "Run the AEQI onboarding loop for the local demo lane. Verify runtime home, doctor output, dashboard access, and first quest persistence. File one improvement only if evidence supports it." --root assistant

# Weekly: compare contributor and MCP paths against the current repo.
30 10 * * 1 aeqi assign "Run the AEQI onboarding loop for contributor and MCP lanes. Verify source checkout state, runtime-home separation, one MCP tool call, and docs drift. Report changed files or file follow-up quests." --root assistant

# Monthly: prune or promote lessons.
0 11 1 * * aeqi assign "Review completed onboarding-loop findings. Promote durable lessons into docs, close obsolete setup advice, and leave rollback notes for any changed operator path." --root assistant
```

For hosted Companies, schedule the same prompts through the managed runtime's
events. For self-hosted runtimes, use `events install-defaults`, systemd timers,
or another supervisor that keeps `aeqi start` available.

## Contribution Rule

Prefer one high-signal improvement per pass. Good changes make the next person
less likely to confuse runtime home with source checkout, skip verification, or
declare success before a durable quest/session exists.
