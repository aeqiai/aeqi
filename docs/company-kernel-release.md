# Company Kernel Release Brief

Status: draft  
Date: 2026-05-13  
Quest: 67-098

## Thesis

The next aeqi release should prove one idea:

> aeqi creates programmable companies where humans set direction, agents
> execute, memory compounds, and work becomes operating truth.

This should be a company-kernel release, not a generic agent-feature release.
The goal is to make aeqi feel like a coherent runtime for creating, staffing,
operating, remembering, and inspecting a company from one control plane.

## Release Name

Working name: `Company Kernel`

Public positioning:

> Build companies where humans set direction and agents execute.

Longer public wording:

> aeqi turns a mission into a working company runtime: agents, roles, quests,
> memory, tools, decisions, and evidence in one place.

## Non-Goals

Do not make this release depend on:

- legal entity formation
- tokenized equity
- fundraising or capital markets
- DAO-first positioning
- jurisdiction mechanics
- a marketplace of preset agents
- "autonomous company" public language
- hosted SaaS promises that the platform cannot verify end to end

Those can become proof layers later. This release should make the operating
company real before the capital stack enters the story.

## Demo Contract

The release is judged by one demo:

1. Create a company context.
2. Give it a mission.
3. Create or assign agents with clear roles.
4. Create quests from the mission.
5. Execute real work.
6. Store durable ideas from the work.
7. Emit events and quest outcomes.
8. Show the operating history in one company surface.
9. Explain what changed, what was verified, and what remains risky.

If the demo cannot show the full loop without switching into raw database
inspection or private operator knowledge, the release is not ready.

## Ship Criteria

The release can ship when these statements are true:

- A new operator can understand the company, mission, agents, quests, ideas,
  and recent events from one surface.
- A meaningful quest leaves evidence: decision, changed artifact, verification,
  result, and residual risk.
- Ideas are visibly useful during execution, not just stored after the fact.
- The MCP self-use loop is real: release work is tracked through quests, ideas,
  and code graph context.
- Runtime and platform boundaries are explicit. The source-available runtime
  can stand alone; hosted platform claims stay within what is implemented.
- Release notes can be assembled from actual operating history instead of
  hand-written memory.

## First-Pass Gap Audit

### Already Strong

- Core primitives exist: agents, ideas, quests, and events.
- The runtime has a native agent loop, provider abstraction, and persistence.
- The UI exists and is embedded in the runtime binary.
- MCP exposes ideas, quests, agents, events, and code graph surfaces.
- The code graph is warm enough to support impact-aware development.
- The repo already documents runtime versus hosted platform separation.

### Needs Product Coherence

- The company or entity surface is not yet the default organizing view.
- Mission state, operating memory, active work, and event history are spread
  across primitives instead of resolved into one operator-facing model.
- Quest evidence needs a crisp contract that is visible to users and useful to
  future agents.
- Ideas need stronger placement in the execution loop: retrieved, applied,
  updated, and cited as operating context.
- Events need to read less like internal plumbing and more like operating
  history.

### Needs Runtime Discipline

- The inspect, plan, execute, verify, and record loop should be explicit in
  native execution contracts.
- Verification should be captured as evidence, not only printed into a session.
- Recoverability and resumability should be part of the visible work state.
- Release work should exercise the same MCP and quest machinery that public
  users are expected to trust.

### Needs UI Focus

- The first screen should answer: what is this company trying to do, who is
  working, what is blocked, what changed recently, and what matters next?
- Agents, quests, ideas, and events should remain separate primitives, but the
  company view should compose them into one operating picture.
- The UI should avoid landing-page explanation. It should behave like a control
  plane for repeated operation.

### Needs Platform Honesty

- Hosted runtime placement and recovery are real platform concerns, but this
  release should not depend on full SaaS maturity.
- Platform claims should be limited to runtime lifecycle, health, proxying, and
  hosted MCP where those paths are verified.
- Any Solana or TRUST protocol work should support the long arc without
  becoming the cold public wedge.

## Work Tracks

### Track 1: Runtime Evidence

Owner surface: runtime, quest, execution, verification.

Target outcome:

- every substantial quest can report what happened and why it is credible
- verification evidence is queryable and visible
- failures produce inspectable state instead of vague transcript residue

First deliverables:

- define the quest evidence contract in docs and code comments
- audit current quest outcome fields against the demo contract
- add or tighten tests around quest completion evidence

### Track 2: Company Surface

Owner surface: UI and API composition.

Target outcome:

- the company view becomes the operator's home
- mission, agents, quests, ideas, events, and blockers are visible together
- the user can move from intent to work without leaving the runtime model

First deliverables:

- map existing entity/company data to UI routes and API responses
- create a minimal company overview wireframe
- implement the smallest useful company home before adding secondary panels

### Track 3: Memory In The Loop

Owner surface: ideas, context injection, MCP.

Target outcome:

- ideas are applied before work, updated after work, and cited in outcomes
- durable decisions survive future sessions
- MCP use is a normal runtime workflow, not a maintainer-only ritual

First deliverables:

- document when ideas must be searched, applied, and stored
- expose which ideas influenced a quest or execution
- add a release self-use checklist that uses ideas before each workstream

### Track 4: Operating History

Owner surface: events and activity.

Target outcome:

- events become the company's append-only operating history
- release notes and status reports can be generated from history
- users can distinguish live work, pending work, completed work, and blocked work

First deliverables:

- classify event types that matter to operators
- design an activity stream around decisions and outcomes, not internal noise
- connect quest completion and idea creation to the visible history

### Track 5: Platform Bridge

Owner surface: hosted control plane and runtime lifecycle.

Target outcome:

- the hosted story demonstrates that a company runtime can be placed, reached,
  recovered, and inspected
- platform claims do not outrun implemented lifecycle invariants

First deliverables:

- verify hosted runtime health and MCP paths from clean deploy artifacts
- keep platform release notes separate from runtime release notes
- document what remains local-runtime only

## First Sprint

The first sprint should not start with broad UI polish. It should lock the
release spine.

1. Finalize this release brief.
2. Define the quest evidence contract.
3. Audit the current company/entity data model against the demo contract.
4. Produce a minimal company home wireframe from existing primitives.
5. Pick one real internal workstream and run it fully through the proposed
   release loop.

## Rollback

This is a planning document. Rollback is a normal revert of this file and the
docs index link. No runtime behavior changes are introduced here.
