# Blueprint Packages

A Blueprint Package is a static, reviewable bundle of TRUST surfaces.
The MVP only needs one package: the built-in default used by `/launch`. It
should be shaped like the future public store item, but the product should not
ship public uploads, remixing, or an open catalog until install preview,
permissions, and provenance are solid.

For now, the store is repo-backed and curated. A package lands by changing files
under `presets/` and shipping the runtime, because shipped blueprint JSON is
embedded into the binary at build time.

## Asset Model

- Company Blueprint: launchable TRUST recipe. Defines the root agent, TRUST
  template, role structure, starter ideas, events, and quests.
- Agent Template: hireable persona plus default ideas, events, quests, model,
  visual identity, and optional spawn messages.
- Event, Quest, and Idea seeds stay flat at install time so existing spawn code
  can materialize them without a second installer path.

The current compatibility bridge is `agent_template_refs` on a Blueprint. At catalog load and spawn time, each reference expands into:

- one `seed_agent` carrying `template_id`
- template-owned `seed_events`, `seed_ideas`, and `seed_quests` with owner remapped to the instantiated agent
- a declared role and role edge when the Blueprint already declares `seed_roles`

This makes preview and install agree while keeping older consumers compatible with the existing flat `seed_*` arrays.

## MVP Package Rule

The first package is `presets/blueprints/aeqi.json`, displayed as **First
Company**. It is both:

- the default `/launch` blueprint
- the only MVP store item worth polishing before public onboarding

That package must be excellent before the catalog broadens. It should install a
neutral TRUST with the Director as the human authority, the default agent in
the Chief of Staff role, and one Founder Associate for synthesis support. It
should not assume a startup, studio, fund, DAO, or personal operating system.
Its job is to help the user turn their first input into an operating snapshot,
ideas, quests, events, roles, and only then any specialist agents.

The default package's events are mostly lifecycle context, plus one gentle
routine. `session:start`, `session:execution_start`, `session:step_start`,
`session:quest_start`, `session:quest_end`, `session:quest_result`, and
`session:stopped` load the Director brief, working style, company shape, and
aeqi tooling playbook so the agent can actually operate the primitives. The
package also seeds an Operating snapshot, Decision log, and Website brief so the
company has a compact current state, durable decisions, and an honest public
surface plan before anything is published.
`weekly_review` is the only scheduled routine: a light Monday review of open
decisions, stalled quests, shipped work, changed priorities, and whether the
company shape should change. Additional cron or external-trigger routines should
be added only after the Director chooses them.

The default package should seed quests as one setup project, not a flat todo
dump. `Set up your First Company` is the parent quest; child quests collect the
Director's brief, working style, first real quest, public website shell, initial
role map, first teammate decision, and first review cadence.

Do not build public upload/review flows for MVP. The practical expansion path is:

1. Ship the default package.
2. Add more curated repo-backed packages after the default is proven.
3. Accept external package PRs once schema validation, preview, and spawn tests
   are strict enough.
4. Build public upload/fork/remix only after permissions, provenance, and
   install diffs are productized.

## Dependency Rule

Dependencies flow downward into context and setup only:

- Company Blueprint -> Agent Template -> Event/Quest/Idea seeds

Installing an event, quest, or idea must not silently hire agents or change company structure. Any transitive install must be visible in the preview before launch or hire.

## Store Acceptance Conditions

For repo-backed packages, acceptance means:

- data-only manifests: no arbitrary code or hidden network behavior
- clear install mode: launch, add agents, import ideas, import quests, install
  events, or a declared combination
- honest preview: exact names and counts for all agents, roles, ideas, quests,
  and events
- permission clarity: event tool calls must be visible before install, and
  anything involving credentials, payments, posting, or on-chain authority needs
  explicit approval
- no fake capability claims: package copy must only promise what the runtime can
  actually do
- restrained starter scope: small enough for a new user to trust and understand
- schema-valid, UI-renderable, and covered by focused spawn/import tests
- versionable metadata before public contribution: id, version, author,
  description, compatibility, and license
