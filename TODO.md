# AEQI -- Remaining Work

Current state: four primitives implemented. Agents, ideas, quests, events in the DB.
Scheduler runs one loop. Activity table tracks costs and decisions.

---

## 1. API + CLI cleanup

### Web routes (aeqi-web)
- Delete: /departments, /skills, /pipelines
- Keep: /agents, /quests, /events, /ideas, /sessions, /companies

### CLI (aeqi-cli)
- Replace --company/--project with --agent
- Delete: skill, pipeline, team subcommands
- Verify: quest, event, idea naming is consistent throughout

---

## 2. Middleware cleanup

Three middleware layers should become ideas instead of code:
- **Guardrails** (allow/deny tool lists) --> already in idea tool restrictions
- **GraphGuardrails** --> idea tool metadata from code graph analysis
- **Clarification** --> idea instruction: "if the quest is unclear, respond with status=blocked"

Keep as code: ContextCompression, ContextBudget, CostTracking, LoopDetection, IdeaRefresh, SafetyNet.

---

## 3. Wire graph to events

Code graph should re-index on git events automatically:
- Create a default event on repo-bound agents: pattern=git_commit, idea=reindex
- aeqi-graph crate stays as infrastructure, called by tools

---

## 4. Root agent bootstrap

Create a bootstrap idea that teaches the root agent to interpret org descriptions and call spawn/configure/delegate tools.

User says: "I need a backend team with 3 engineers and a reviewer"
Root agent: spawns parent agent "backend", spawns 4 children, sets ideas/models/workdirs, creates events for code review patterns.

---

## 5. Sibling ideas + agent conversations

### 5a. Shared scope ideas
When an agent searches ideas, also include ideas from siblings (same parent_id) that have scope='shared'. Same ancestor walk, extended one step sideways.

### 5b. Agent-to-agent sessions
Back-and-forth between agents via shared session. The delegate tool handles delivery. Sessions handle history.

---

## Order

1, 2, 3 are independent. 4 depends on the idea system being stable. 5 is independent.
Each step is independently shippable. Tests must pass after each.
