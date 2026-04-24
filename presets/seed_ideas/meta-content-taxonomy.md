---
name: meta:content-taxonomy
tags: [meta, evergreen, pack-infrastructure]
description: The five canonical categories for seeded ideas in aeqi. Every incoming idea (internal authored or external imported) maps to exactly one.
---

# Content Taxonomy

Every seeded idea in aeqi's pack falls into exactly one of five categories.
When absorbing an external source, first map each piece of their content
onto these categories. If something doesn't fit cleanly, it's a signal we
need a new category — raise it, don't force-fit.

## The five

### 1. Identity — who the agent IS

Long-lived self-description. Tagged `identity`, `evergreen`. Usually one
per agent. Changes are deliberate, not drive-by. Surfaced via
`session:start`.

Example: `vanilla-assistant`.

### 2. Persona — who the agent TEMPORARILY BECOMES

Sub-agent templates invoked by events for bounded tasks. Tagged `meta`,
`template`. Always ephemeral. Surfaced via
`session.spawn(instructions_idea=...)`.

Examples: `meta:reflector-template`, `meta:daily-reflector-template`,
`meta:weekly-consolidator-template`, `meta:consolidator-template`.

### 3. Skill — how the agent DOES X

Actionable how-tos for using aeqi primitives or external tools. Tagged
`skill`, `meta`. Called up by search or referenced from identity.

Examples: `create-quest`, `create-event`, `manage-tools`.

### 4. Ritual — what the agent DOES ON A SCHEDULE or EVENT

Event-attached tool-call chains that fire on patterns. Implemented via
event rows + (optionally) persona templates. Not an idea per se — an
event record that may reference ideas.

Examples: `reflect-after-quest`, `daily-digest`, `weekly-consolidate`.

### 5. Principle — how the agent DECIDES

Value statements that shape judgment in ambiguous cases. Tagged `meta`,
`principle`, `evergreen`. Injected alongside identity.

Examples: [future] `meta:behavior-principles`, [future]
`meta:reflection-principles`.

## Decision flow when importing

For each chunk of external content:

1. Does it describe who-the-agent-is? → **identity** (usually merge into
   existing identity, don't add a new one).
2. Does it describe a sub-agent persona? → **persona**.
3. Does it describe how to use a tool or primitive? → **skill**.
4. Does it describe something that should fire automatically? → **ritual**
   (event).
5. Does it express a value/rule for judgment? → **principle**.
6. Does it fit none cleanly? → stop, flag to operator, maybe new category.

## Boundary cases that trip this

- A "skill" that's really a value in disguise ("always write tests first")
  → **principle**, not skill. Skills are mechanical; principles are
  judgment.
- A "persona" that's really a fixed identity ("you are a Rust reviewer")
  → **identity** on a specialist agent, not a persona template.
- A "ritual" that's really a one-off ("run this check before launch")
  → neither — it's a quest. Rituals repeat.

When in doubt, the five-category test is a ranking, not a partition: if a
piece of content feels half-skill half-principle, it's a principle with an
example — author the principle, link the example, don't clone into both.
