# Unused-primitive triage — 2026-04-28

## Summary

**2 to adopt · 2 to extend · 4 to remove.**

The app has zero JSX usage of these eight primitives across `apps/ui/src/` (excluding their own files and stories). A thorough search confirms no bespoke equivalents that should migrate. Adoption barriers exist: Stack/Inline are well-designed but unused; Icon is comprehensive but Lucide imports aren't wired; DataState's empty-state logic duplicates EmptyState; Panel, DetailField, HeroStats, and ProgressBar are speculative with no demand signal.

---

## Per-primitive

### Stack — ADOPT
Stack is production-ready and solves the canonical "column layout" pattern the codebase handles ad-hoc with inline `display: flex; flex-direction: column; gap`. Stories show clear forms/layouts use cases. Adoption surface: `AgentPage.tsx`, `QuestPreflightPanel.tsx`, `AgentChannelsTab.tsx`, `IntegrationsPanel.tsx` all render stacked form fields and panels where Stack's gap/align API is cleaner than inline styles. Recommend adopting in next form refactor.

### Inline — ADOPT
Inline mirrors Stack for horizontal rows with identical API (gap, align, justify). The stories show real card-headers (toolbar buttons, status badges in a row) where justify=between is valuable. Extensive inline `display: flex; gap` patterns exist (637 grep matches across the app). Adoption surface: ContentTopBar, agent card headers, toolbar badge rows. Extract inline-row CSS classes into Inline components to centralize horizontal layout logic.

### Icon — EXTEND
Icon wraps Lucide with size/decorative props and aria-label semantics—solid design. However, the app avoids Icon imports and instead uses raw `<svg>` or inlines Lucide directly (43 matches). Missing: Icon isn't exposed in barrel exports (`components/ui/index.ts`?) or the Storybook welcome doc. Without discovery/visibility, adoption won't happen. Extend: add Icon to the public API surface; update Welcome.mdx to surface it as the canonical icon solution so future features reach for `Icon` instead of rolling inline SVG.

### Panel — REMOVE
Panel is a card-with-optional-header wrapper. The stories (WithStats, WithItemList, WithActions) show dashboard/detail scenarios. However, the app doesn't build detail cards or dashboard panels—it routes users to pages. No demand signal; looks speculative for a future "dashboard widget library." Bespoke surfaces (IntegrationsPanel, QuestPreflightPanel) handle their own card chrome. Remove this primitive and the pain of future maintenance.

### DetailField — REMOVE
DetailField is a label-over-value field for compact detail cards (agent-details, quest-details in the stories). The app has no detail-panel surfaces that adopt this pattern. AgentPage, QuestCanvas, and settings render detail in page form rather than dense cards. Speculative; no clear adoption path. Remove.

### DataState — REMOVE
DataState wraps Spinner + EmptyState as a three-way (loading | empty | content) dispatcher. The component exists; however, the codebase already uses EmptyState standalone and conditional rendering (if loading) inline. IntegrationsPanel and QuestPreflightPanel handle loading/empty states locally rather than reaching for a primitive. DataState duplicates existing Spinner + EmptyState without adding clarity. Remove; keep Spinner and EmptyState, which have real usage.

### HeroStats — REMOVE
HeroStats renders horizontal stat rows with dividers and optional color coding for dashboard-overview scenarios. No current usage; no bespoke equivalents. The app lacks a dashboard—sessions/quests/events pages use tables and detail cards, not stat grids. Speculative design for future landing-page marketing or admin dashboard. Remove until there's demand.

### ProgressBar — REMOVE
ProgressBar is a horizontal fill-bar for quest/agent workload progress. Stories show agent-workload scenarios (7/10 tasks, 8/10 capacity). The app renders nothing like this. BudgetMeter has its own track/fill pattern but doesn't adopt ProgressBar. Speculative—future quest-timeline or capacity-planning features might use it, but no current demand. Remove.

---

## Recommendations

**Immediate:**
- **ADOPT Stack + Inline:** Wire them into form layouts and toolbars next refactor. This consolidates scattered flex CSS into reusable primitives.
- **EXTEND Icon:** Add to public API, update Storybook welcome. Remove the barrier to discovery.

**Clean up:**
- **REMOVE Panel, DetailField, DataState, HeroStats, ProgressBar:** All speculative with zero demand. Dead primitives cost doc overhead, mental-model burden, and future maintenance. Delete the files and their stories.

**Pattern extraction:**
- After removal, run a second pass on Icon adoption: search for inline `<svg>`, Lucide direct imports, and 13px custom icons. Migrate to Icon component to establish a single source of truth for icon sizing and accessibility.
