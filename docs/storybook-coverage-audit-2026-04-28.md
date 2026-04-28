# Storybook + design-system coverage audit

**Snapshot:** 2026-04-28, after the design-system token sweep (commits `4010505` on landing, `d996dcfc` + `a05e1d89` on aeqi).

The user asked: _can we improve our Storybook? are there components we didn't use? components used but not in the Storybook? how does the design system hold together across the stack?_

Tight answer: **the system is well-shaped at the primitive level, with documented gaps at the page level.** Below: the numbers.

---

## Coverage of primitives in `src/components/ui/`

**28 primitive components total.** Story + `.module.css` coverage:

- **26 / 28 primitives have a `.stories.tsx` file** — every component-class primitive is documented.
- **The 2 without stories** (`TokenTable`, `TokenValue`) are doc-helpers used INSIDE Storybook MDX to render live token values from `:root`. They don't need their own stories — they're machinery for the docs.
- **All 26 component-class primitives have a `.module.css`.**

**Coverage at the primitive level: 100%.**

The structure is also clean — every primitive ships as `Component.tsx + Component.module.css + Component.stories.tsx`, plus the barrel export in `index.ts`. New contributors can grep for any of these three and find the others.

---

## Page-side adoption (the real test)

Counting JSX usage of each primitive across `src/` (excluding the primitive's own files and stories):

| Primitive         | Usages | Status                                                           |
| ----------------- | ------ | ---------------------------------------------------------------- |
| `Button`          | 110    | Carrying load — the most-adopted primitive                       |
| `Popover`         | 39     | Heavy use                                                        |
| `Tabs`            | 34     | Heavy use                                                        |
| `Spinner`         | 33     | Heavy use                                                        |
| `Menu`            | 25     | Heavy use                                                        |
| `Input`           | 24     | Heavy use                                                        |
| `EmptyState`      | 20     | Heavy use                                                        |
| `Modal`           | 18     | Heavy use                                                        |
| `IconButton`      | 15     | Heavy use                                                        |
| `Badge`           | 8      | Moderate                                                         |
| `Card`            | 7      | Moderate                                                         |
| `TagList`         | 4      | Moderate                                                         |
| `Select`          | 2      | Low — but a Combobox is doing some of the work                   |
| `ThinkingDot`     | 2      | Low                                                              |
| `TokenValue`      | 2      | Low (Storybook helper)                                           |
| `Combobox`        | 1      | Low                                                              |
| `ErrorBoundary`   | 1      | Low — boundary belongs at app root, 1 use is correct             |
| **`DataState`**   | **0**  | Zero-use                                                         |
| **`DetailField`** | **0**  | Zero-use                                                         |
| **`HeroStats`**   | **0**  | Zero-use                                                         |
| **`Icon`**        | **0**  | Zero-use                                                         |
| **`Inline`**      | **0**  | Zero-use (Stack's sibling — together they form a layout pair)    |
| **`Panel`**       | **0**  | Zero-use                                                         |
| **`ProgressBar`** | **0**  | Zero-use                                                         |
| **`Stack`**       | **0**  | Zero-use                                                         |
| **`Textarea`**    | **0**  | Zero-use — but **5 raw `<textarea>` elements live in pages**     |
| **`Tooltip`**     | **0**  | Zero-use — but **87 raw `title="..."` attributes live in pages** |
| `TokenTable`      | 0      | Doc helper, no app-side use expected                             |

**The 11 zero-use primitives split into three buckets:**

- **Speculatively built, not yet adopted** (most of them). Layout primitives like `Stack` / `Inline` / `Panel`, content primitives like `DataState` / `DetailField` / `HeroStats`. They were extracted ahead of demand. Either pages should adopt them, or they're dead code that should be removed.
- **Drop-in replacements that the codebase rolled bespoke instead** — `Textarea` and `Tooltip`. The primitives exist; the pages re-implement raw HTML. This is the worst kind of drift because it's invisible from Storybook ("we have a Textarea!") but visible in the codebase ("everyone uses raw `<textarea>` anyway").
- **`Icon` zero-use** is striking — 28 components ship icons in some shape. They're inline SVGs across the codebase. Not a concrete primitive duplication unless `Icon` is intended to wrap an icon-name registry; need to read the implementation to decide.

---

## Bespoke duplicates of primitives in pages — the actual drift

Counting raw HTML elements where a primitive exists:

| Element       | Raw count | Primitive that exists              | Drift severity                                                                                                  |
| ------------- | --------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `<textarea>`  | **5**     | `Textarea` (zero use)              | **High** — clear duplication                                                                                    |
| `<select>`    | **1**     | `Select` (2 uses)                  | **Medium** — almost universal adoption, one outlier                                                             |
| `<button>`    | **197**   | `Button` (110) + `IconButton` (15) | **Mixed** — some are legit (form submit, accordion triggers, accessibility wrappers); others should be `Button` |
| `title="..."` | **87**    | `Tooltip` (zero use)               | **High** — universal use of native title instead of the canonical Tooltip                                       |

**The `<button>` count is the noisiest signal.** 197 raw `<button>` elements is genuinely a lot, but a large fraction are legitimately raw — accordion expand/collapse triggers, modal-close ✕ buttons, dropdown triggers that are fundamentally `<button>` elements with custom styling, etc. The Button primitive is for _labeled actions_; not every interactive element is one.

A finer audit would split the 197 into:

- "Should be `<Button>`" (form actions, primary CTAs) — likely 30-50
- "Should be `<IconButton>`" (icon-only actions) — likely 30-50
- "Should be a new primitive (`<TriggerButton>`?) for accordion/dropdown triggers" — possibly worth extracting
- "Genuinely raw, do not migrate" (accessibility wrappers, very specific custom styling) — the rest

---

## Storybook foundation docs

Verified: **two foundation MDX docs were carrying v3-residue language** ("white card on paper") instead of the v5.1 four-tier ladder. Fixed in this commit:

- `FoundationsColor.mdx` — Surfaces section was naming `--color-card` as "Paper" and describing "one shell, one white working paper, one ink sheet for inversion." Updated to describe the full v5.1 ladder (paper → card → elevated → inset family → ink sheet) with the correct token mapping.
- `FoundationsElevation.mdx` — Was framing elevation as "a single canonical treatment for lifted white cards" (drop-shadow approach). Updated to put **value contrast across the v5.1 ladder** as the primary mechanism, with `--card-elevation` as the secondary tool for surfaces that need a hairline + whisper-shadow.

Earlier today the same v3-residue was caught and fixed in the parent `apps/ui/.impeccable.md` (commit `a05e1d89`). The pattern is clear: when the v5.1 ladder shipped, several documentation surfaces inherited the old framing and weren't co-updated.

Other Foundations docs spot-checked clean (no v3 lang, no JetBrains Mono): `FoundationsTypography.mdx`, `FoundationsRadii.mdx`, `FoundationsSpacing.mdx`, `FoundationsMotion.mdx`, `FoundationsBreakpoints.mdx`, `FoundationsIconography.mdx`, `FoundationsPrinciples.mdx`, `FoundationsWordmark.mdx`.

Patterns docs (`PatternsToolbar.mdx`, `PatternsLayout.mdx`, `PatternsAgentCard.mdx`, `PatternsQuestRow.mdx`, `PatternsEmptyDashboard.mdx`) — not yet audited; likely worth a sweep but lower priority.

---

## How the design system holds together across the stack

| Layer                                                                   | Status                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canonical tokens** (`packages/tokens/src/tokens.css`)                 | Single source. v5.1.                                                                                                                                                                                                                                                                                                               |
| **Token sync to landing** (`scripts/sync-tokens.mjs` in `aeqi-landing`) | Auto-runs on every dev/build. Drift architecturally impossible.                                                                                                                                                                                                                                                                    |
| **Primitives** (`apps/ui/src/components/ui/`)                           | 28 components, 100% have stories + CSS modules, well-organized.                                                                                                                                                                                                                                                                    |
| **Storybook foundation docs**                                           | 9/11 verified current as of today; 2 fixed in this commit (Color + Elevation).                                                                                                                                                                                                                                                     |
| **Hygiene checks**                                                      | Both `aeqi-landing` and `aeqi/apps/ui` ship `scripts/hygiene-check.mjs` that fails the pre-commit hook on new Tailwind drift (`text-black/N+`, `border-black/[0.06+]`, `bg-black/[0.04+]`).                                                                                                                                        |
| **Page-side primitive adoption**                                        | **Mixed.** Heavy primitives (Button, Popover, Tabs, Spinner, Menu, Input, EmptyState, Modal, IconButton) are adopted across pages. **Layout primitives (Stack/Inline/Panel) and several content primitives (DataState/DetailField/HeroStats) are zero-use. Textarea + Tooltip are zero-use despite raw-HTML duplicates in pages.** |

**The honest summary:**

- **Token foundation: solid.** Canonical, auto-synced, hygiene-guarded. This is the part that matters most because tokens are the substrate everything else builds on.
- **Primitive library: well-built but partially unused.** Eleven primitives sit idle while pages either re-implement them (Textarea, Tooltip) or never reach for them (Stack, Inline, Panel, DataState, DetailField, HeroStats, ProgressBar, Icon).
- **Pattern docs: probably need a sweep.** Foundations are mostly current after today's fix; Patterns (recipes for composed surfaces) haven't been audited.

---

## Recommended next workstreams

In order of leverage:

### 1. Migrate the 5 raw `<textarea>` to the `Textarea` primitive — half-day workstream

Files: `IdeaCanvas.tsx` (×2), `EventCanvasEditor.tsx`, `ChatComposer.tsx`, `NewAgentPage.tsx`.

The bespoke ones have page-specific styling (e.g. `IdeaCanvas`'s body textarea is the page; `ChatComposer`'s is the input). The primitive currently wraps the textarea in a `<div>` with optional label/hint/error. Migration approaches:

- **Drop-in for the simple cases** (NewAgentPage, EventCanvasEditor) — the primitive's wrapper is fine; pass `className` through to the inner `<textarea>` for the bespoke styling.
- **Add a `bare` or `unwrapped` variant** to the primitive for the IdeaCanvas/ChatComposer cases where the wrapper conflicts with the page layout.
- **Per-file visual diff before/after** — must verify the bespoke styling carries through.

### 2. Adopt the `Tooltip` primitive — half-day workstream

87 native `title="..."` attributes in pages. Native title:

- Doesn't trigger on touch
- Has 700ms delay before appearing
- No styling control
- Bad accessibility for screen readers (announces redundantly)

The `Tooltip` primitive solves all of these. Mass-migration is mechanical: wrap the trigger in `<Tooltip content="...">` and remove `title="..."`.

The right scope is probably 30-50 of the 87 (the ones where the title is genuinely a tooltip; the rest may be alt-text on icons that are fine as native title).

### 3. Decide the fate of the 8 zero-use primitives — research

For each: is it (a) waiting to be adopted, (b) dead code that should be removed, or (c) the wrong abstraction and a new primitive should replace it?

Layout primitives (Stack, Inline, Panel) are typically high-value once teams start using them — but in this codebase, raw `flex` and `grid` have done the work fine. The cost-of-adoption may be higher than the value.

Content primitives (DataState, DetailField, HeroStats) are surface-shape primitives. Either pages should adopt them in their respective surfaces, or they were extracted speculatively and don't fit.

`Icon` is the most interesting. Its zero-use suggests every page rolls its own SVG. Either the primitive needs an icon-name registry that makes it trivially better than raw SVG, or it should be removed.

### 4. The 197 raw `<button>` audit — full-day workstream

Per-instance review. Many will be legitimate; many will be drift toward Button or IconButton. Output: a categorized list + migration plan for the drift bucket.

### 5. Audit the Patterns MDX docs for v3 residue — quick check, maybe quick fix

Same shape as today's Foundations fix.

---

## What we DON'T need to do

- Add stories for new primitives — coverage is 100%, the structure is clean.
- Add a CSS module to TokenTable / TokenValue — they're doc helpers, no styling needed.
- Reorganize `src/components/ui/` — the structure is fine.
- Restructure the barrel export — `index.ts` is clean.
- Touch the canonical tokens — they're the right shape (v5.1 ladder).

The Storybook itself is in good shape. The gap is **page-side adoption of the primitives that already exist**.
