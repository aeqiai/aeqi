# Compositional Blueprint Assets

Company Blueprints are launchable organization recipes. They may reference reusable catalog assets instead of duplicating every seed inline.

## Asset Model

- Company Blueprint: defines the company root agent, TRUST template, role structure, and company-level starter ideas, events, and quests.
- Agent Template: defines a hireable persona plus its default ideas, events, quests, model, visual identity, and optional spawn messages.
- Event, Quest, and Idea seeds stay flat at install time so existing spawn code can materialize them without a second installer path.

The current compatibility bridge is `agent_template_refs` on a Blueprint. At catalog load and spawn time, each reference expands into:

- one `seed_agent` carrying `template_id`
- template-owned `seed_events`, `seed_ideas`, and `seed_quests` with owner remapped to the instantiated agent
- a declared role and role edge when the Blueprint already declares `seed_roles`

This makes preview and install agree while keeping older consumers compatible with the existing flat `seed_*` arrays.

## Dependency Rule

Dependencies flow downward into context and setup only:

- Company Blueprint -> Agent Template -> Event/Quest/Idea seeds

Installing an event, quest, or idea must not silently hire agents or change company structure. Any transitive install must be visible in the preview before launch or hire.

## First Shipped Slice

`presets/agent_templates/steward.json` defines Steward once as a reusable agent template. The default `aeqi` Company Blueprint references it through `agent_template_refs`; the runtime expands the reference for catalog detail and spawn. `/blueprints/agents` lists the reusable Steward template, while `/blueprints/aeqi/agents`, `/events`, `/ideas`, and `/quests` show the resolved bundle that will be installed.
