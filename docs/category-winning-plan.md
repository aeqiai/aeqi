# Category-Winning Plan

This document answers one question:

Can AEQI become one of the best unopinionated agent runtimes?

The answer is yes, but only if AEQI becomes more disciplined as infrastructure.

It already has the ingredients:

- a memorable ontology
- a serious runtime codebase
- a control-plane instinct instead of a chat-wrapper instinct
- an ambition to fit companies, not only demos

What it does not yet have is the consistency and hardening required to turn that into category leadership.

## Position

AEQI should be positioned as:

- an unopinionated agent runtime
- a durable control plane for agents, work, memory, and execution
- a system that can run locally, in hosted environments, and in enterprise boundaries

AEQI should not be positioned as:

- just a coding shell
- just a prompt manager
- just a multi-agent demo harness
- just a SaaS layer over vendor transcripts

The differentiation is not "more agents." The differentiation is that AEQI is trying to define the substrate.

## Why AEQI Can Win

Three things are unusually strong:

1. The core model is compact.
   Agent, Event, Quest, and Idea are few enough to hold in your head.

2. The runtime already reaches into the hard parts.
   Sessions, orchestration, persistence, budgets, sandboxing, activity logs, hosting, and platform routing already exist.

3. The product thesis is grounded in organizational usefulness.
   Intelligence is only real if it survives time, interruption, ownership, and operational constraints.

That is a better starting point than most "agent platforms."

## The Main Risk

AEQI will fail if the ontology stays elegant in docs but inconsistent in code.

The biggest danger is semantic drift:

- fields that exist but do not affect execution
- concepts that mean one thing in docs and another in code
- platform shortcuts that quietly violate the runtime model
- "unopinionated" language masking underspecified behavior

AEQI does not need more primitives.
It needs fewer contradictions.

## What "Unopinionated" Must Mean

For AEQI, unopinionated should mean:

- the runtime owns persistence, routing, lifecycle, execution, audit, and recovery
- the runtime does not hardcode one workflow philosophy as the only valid one
- prompts, policies, identity, and automation can all be expressed through AEQI primitives
- vendor model choice is replaceable
- deployment model is replaceable

It does not mean:

- vague semantics
- weak defaults
- missing policy
- lack of safety boundaries

An unopinionated runtime still needs strict contracts.

## Non-Negotiable Standards

AEQI should hold these as release gates.

### 1. Semantic Integrity

Every persisted runtime field must materially affect behavior.

Examples:

- if an event references ideas, those ideas must influence the resulting execution
- if a quest references ideas, the scheduler must consume them
- if docs say an event invokes an idea, the execution path must preserve that fact

### 2. Single Source of Truth

State must live in AEQI, not in side effects that AEQI merely hopes are true.

Examples:

- runtime placement must reflect the actual reachable runtime
- session and quest state must survive restarts
- provisioning state must not claim "ready" before the target runtime is truly usable

### 3. Trust-Boundary Discipline

The hosted platform must be operated like infrastructure, not app glue.

Examples:

- internal relays are not public routes
- secrets are never exposed by convenience
- auth and ownership checks are uniform
- provisioning and migration paths are reversible and observable

### 4. Runtime-First Execution

AEQI should be strongest on its own execution path.

External tools and provider integrations are useful, but the center of gravity must be:

- AEQI sessions
- AEQI quest lifecycle
- AEQI prompt assembly
- AEQI checkpoints
- AEQI verification and artifacts

### 5. Measured Reality

The system must prove that it improved real outcomes.

That means:

- evals for coding and repository work
- cost, latency, failure, and retry visibility
- outcome metrics, not only task counts

## The 6-12 Month Program

### Track 1: Runtime Semantic Closure

Goal: make the AEQI ontology true end-to-end.

Required outcomes:

- event-triggered work preserves idea references into execution
- quest-level idea references affect prompt assembly
- session start, event fire, and quest execution all use one coherent activation model
- "Event" semantics are documented and enforced consistently

If this track is weak, the whole philosophy becomes decorative.

### Track 2: Platform Hardening

Goal: make the hosted system trustworthy enough to support real customers.

Required outcomes:

- no anonymous internal relays
- provisioning paths that create usable runtimes, not just metadata
- clean reconciliation between platform state and runtime state
- reliable tenant lifecycle: create, migrate, stop, expire, destroy

If this track is weak, AEQI cannot credibly claim enterprise or operational seriousness.

### Track 3: Native Loop Excellence

Goal: make AEQI's own execution loop good enough to be the default choice.

Required outcomes:

- stronger inspect-edit-verify-recover loop
- better resumability and checkpoint use
- clearer artifacts and execution summaries
- fewer silent failures and fewer ambiguous outcomes

This is the path from "interesting runtime" to "best-in-class runtime."

### Track 4: Work OS Cohesion

Goal: make ideas, agents, quests, sessions, and metrics feel like one system.

Required outcomes:

- UI reflects the real ontology
- operators can move from idea to execution to review without leaving AEQI
- agent tree, quest graph, and idea graph feel connected instead of adjacent

This is where AEQI becomes a product, not only infrastructure.

### Track 5: Outcome and Evaluation Layer

Goal: prove AEQI works.

Required outcomes:

- a public or internal eval harness for repository quests
- benchmark suites for completion rate, regression rate, retries, time-to-success, and cost
- domain outcome loops for at least one non-coding vertical

Without this, "best" remains narrative, not evidence.

## What To Avoid

The following will dilute the category play:

- adding new top-level concepts when the existing four are not yet closed
- building UI features that depend on semantics the runtime does not actually enforce
- optimizing for more providers before the core contract is stable
- mistaking hosted convenience for runtime maturity
- letting transitional compatibility paths become permanent architecture

## Current Priority Order

The next sequence should be:

1. Fix runtime semantic gaps where persisted ideas do not affect execution.
2. Fix platform trust-boundary and provisioning defects.
3. Add evals around real repo tasks and provisioning flows.
4. Tighten the UI around the actual ontology rather than adding more surface area.
5. Expand enterprise and deployment claims only after the first four are true.

## How To Know AEQI Is Winning

AEQI is on track to win the category when:

- another engineer can read the code and see the AEQI model without translation
- an operator can explain why work happened by inspecting AEQI state
- a customer can run AEQI in a strict environment without architecture changes
- the hosted platform behaves like reliable infrastructure
- AEQI-native execution wins real tasks often enough that external systems become optional, not foundational

## Operating Rule

When deciding what to build next, ask:

"Does this make AEQI more semantically coherent, more operationally trustworthy, or more capable of producing real outcomes?"

If not, it is probably not on the critical path to category leadership.
