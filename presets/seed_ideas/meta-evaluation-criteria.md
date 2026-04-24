---
name: meta:evaluation-criteria
tags: [meta, evergreen, pack-infrastructure]
description: Checklist for evaluating external content before importing into aeqi's seed pack. Applied to every source — Karpathy skills, Zep architecture, prompt libraries, etc.
---

# Import Evaluation Criteria

Apply in order. Stop at the first failure.

## 1. Category test

Does the content map cleanly to `meta:content-taxonomy`? If no → skip or
adapt first.

## 2. Duplication test

Query `ideas(action='search', query='<candidate topic>', tags=['skill','meta'])`.
If the existing pack already covers this, either:

- Merge the new source's wording into existing (via
  `ideas(action='update')`), citing source in `authored_by`.
- Skip (our version is already good).
- Supersede ours (new source is strictly better; via
  `supersedes:[[...]]`).

## 3. Contradiction test

Does it contradict existing principle/identity? If yes, surface the
tension deliberately — don't silently import. An import that overrides
identity without an explicit operator decision is how agents drift.

## 4. Example test

Does the content come with worked examples? If no, author some before
landing it — principles without examples rarely transfer. A vague
imported principle is worse than no principle: it misfires confidently.

## 5. Provenance test

Tag every imported idea with `source:pack:<pack-name>` so it's traceable
and removable. Also record `authored_by = "import:<source>"`. This is
what makes a bulk revert possible when a pack turns out to be bad.

## 6. Minimum viable import

Start with ONE idea per source. Observe how it behaves for a week before
importing more from the same source. Resist bulk imports — they compound
mistakes and make the pack harder to rollback.

## 7. Principle of last recourse: 6-month test

Write down why this idea earns its slot. If that rationale wouldn't
survive 6 months of you forgetting the enthusiasm — don't import. The
pack is not a bookmarks folder.

## Common sources + notes

- **Karpathy skills repo** — four principles + examples. Mostly fits
  `principle` category. Adapt voice to aeqi terseness; don't import
  verbatim.
- **Claude Code plugin marketplace** — mostly `skill` category. Be
  careful of Claude-Code-specific bits (tool names, terminology) — aeqi
  has different primitives (no `Task`, no `Bash`-as-tool, etc.).
- **Generative Agents (Park et al.)** — `persona` and `ritual` category.
  Reflection/retrieval algorithms. Their exact prompts are worth
  studying.
- **Zep / Mem0 / MemGPT architecture docs** — mostly infrastructure
  (informs code, not seeded ideas). What they do for memory LAYERING
  might inform our `meta:content-taxonomy`.
- **Zettelkasten / Luhmann** — linking discipline + atomic notes. Could
  inform a `principle` entry about writing ideas.
- **Domain prompt libraries** (awesome-prompts, PromptHub) — mostly
  `skill` or `persona`. High volume, low per-item quality — cherry-pick
  hard.

## Anti-patterns seen in the wild

- "Import everything and prune later." Pruning never happens. The
  namespace bloat compounds search and retrieval costs forever.
- "Translate all of source X at once." Translation without usage is
  cargo-culting. Import one, watch it fire for real traffic, then decide
  if more is warranted.
- "Keep both versions side-by-side." Two ideas with overlapping names
  and near-identical content split retrieval and confuse the reflector.
  Pick one, record the other as superseded, move on.
