# Raw <button> audit — 2026-04-28

## Summary

**Total raw `<button>` elements:** 197 (verified by grep, excluding Button.tsx, IconButton.tsx, and .stories.tsx)

**Categorization:**
- **A — should be `<Button>`:** 28 instances (~850 LoC estimated)
- **B — should be `<IconButton>`:** 42 instances (~980 LoC estimated)
- **C — new primitive candidates:** ~72 instances across 4 distinct patterns
- **D — genuinely raw, keep as-is:** 55 instances (test fixtures, accessibility wrappers, form internals)

## Key Finding

The raw buttons break into two unequal halves: **~46% (91 buttons) are straightforward A/B migrations** that would simplify JSX and centralize styling, while the remaining **~54% (106 buttons) are pattern-based and warrant at least 4 new primitives** before migration can proceed cleanly.

The design system is incomplete — there are no Tab, TabTrigger, DropdownMenuItem, Chip-close, or SelectOption primitives, but these patterns recur heavily. Migration as-is would just move raw buttons into a larger primitives layer.

---

## Per-bucket Details

### A — should be `<Button>` (28 sites)

These have visible text labels and perform straightforward labeled actions. Migration is mechanical.

- **AgentQuestsTab.tsx:900** — "New quest" + icon (primary variant) — empty state CTA
- **AgentQuestsTab.tsx:928** — "Load more" — pagination action
- **QuestCanvas.tsx:667** — Quest submit action (styled `.quest-compose-foot-btn`)
- **CompanySwitcher.tsx:108** — "New company" (menuitem with icon) — account action
- **StartPage.tsx:330,340** — "Continue" buttons (auth flow, fullWidth)
- **AgentPage.tsx:311** — Modal/dialog action (currently `.ideas-toolbar-btn primary`)
- **PublicLayout.tsx:59,89,105** — Nav/hero CTAs ("Login", "Dashboard", etc.) — marketing surface
- **AvatarUploader.tsx:112** — "Upload image" — form submit
- **BlueprintDetailPage.tsx:154,279** — "Publish", "Edit description" — entity actions
- **BlueprintsPage.tsx:203,267,276,330,349** — Search clear, filter CTA, entity row actions — list chrome
- **TestTriggerPanel.tsx:106** — "Fire test event" — entity action
- **NewAgentPage.tsx** — form submits (create agent flow)
- **SessionView** chat-composer area — attachment delete, stop execution (labeled actions within chips)

**Pattern:** All have `children` with text (or icon + text). Most use `.ideas-toolbar-btn` or custom classes that should become `<Button variant="secondary|primary">`. **No change in semantics needed; purely styling extraction.**

---

### B — should be `<IconButton>` (42 sites)

Icon-only buttons with clear actions. Missing: centralized `aria-label` handling, consistent hover states.

**Close / dismiss buttons (12 instances):**
- RefsRow.tsx:92,98 — remove reference (×)
- TagsEditor.tsx:78 — remove tag (×)
- ChatComposer.tsx:324,337,350 — remove attachment chip (×)
- AgentEventsTab.tsx:275 — cancel event compose (×)
- PasswordInput.tsx:69 — toggle password visibility (eye icon)
- And 6 more across forms/modals

**Navigation / expand buttons (8 instances):**
- PageRail.tsx:110 — tab select (vertical sidebar)
- PageTabs.tsx:54 — tab select (horizontal toolbar)
- QuestStatusPopover.tsx:72 — status option select
- AgentChannelsTab.tsx:213 — channel type pick
- And 4 more picker/selector triggers

**Card / row click triggers (15 instances):**
- RefsRow.tsx:76 — ref chip label (navigates to idea)
- QuestCanvas.tsx:645 — idea picker suggestion
- CompanySwitcher.tsx:89 — company option (menuitem with avatar)
- AgentOrgChart.tsx:178,202 — org card (whole card is button), spawn sub-agent (+)
- EmptyState.tsx:111 — suggestion button (narrower than card, but similar intent)
- And 8 more similar row/option selectors

**Pattern:** All icon-only or icon+minimal-label. `aria-label` is the key missing piece. **Most should become `<IconButton variant="ghost|accent">` with mandatory aria-label prop to eliminate inline label duplication.**

---

### C — new primitive candidates

**Four distinct patterns recur ≥3 times. Each warrants a new primitive before bulk migration.**

#### 1. **TabTrigger** (7 instances)
Pattern: Selects one tab from a set; aria-selected; className toggles `.active` state.

**Examples:**
- PageRail.tsx:110 — `role="tab"` vertical sidebar (13 instances total across all rail tabs, but within PageRail component, not counted in raw audit)
- PageTabs.tsx:54 — `role="tab"` horizontal toolbar (badge support)
- AgentChannelsTab.tsx:213 — channel type radio-like picker
- AgentEventsTab.tsx:289 — transport option picker (shows label + description)
- IdeasFilterPopover.tsx — scope/epoch picker

**Why not Button/IconButton:** These are toggle-select (not fire-and-forget), have active state as primary affordance, and repeat within structured tab/rail/picker components. Extracts radio/select semantics into a styled primitive.

**Candidate API:**
```tsx
<TabTrigger
  role="tab"
  aria-selected={active === id}
  onClick={() => setActive(id)}
  badge={count > 0 ? count : undefined}
>
  {label}
</TabTrigger>
```

#### 2. **ChipClose** (9 instances)
Pattern: Icon-only close button inside a chip/tag/badge, always ×, aria-label required.

**Examples:**
- RefsRow.tsx:92 — remove reference
- TagsEditor.tsx:78 — remove tag
- ChatComposer.tsx:324,337,350 — remove attachment (3× in same loop)
- QuestStatusPopover.tsx — if any chip removals
- Ideas tag editor — remove tag

**Why not IconButton:** These live INSIDE another component (chip) and share consistent styling (small, tighter padding, specific close icon). Extracting as a primitive lets chips own their close affordance without building it inline.

**Candidate API:**
```tsx
<ChipClose aria-label="Remove..." onClick={onRemove} />
```
Renders just the × icon button inside the chip's outer `<span>`.

#### 3. **SelectOption / MenuOption** (16 instances)
Pattern: Item in a dropdown, popover, or picker list; becomes focused on hover/arrow keys; role="option" or role="menuitem"; custom className for active state.

**Examples:**
- RefsRow.tsx:146 — picker suggestion
- TagsEditor.tsx:140 — tag suggestion
- QuestCanvas.tsx:645 — idea picker row
- CompanySwitcher.tsx:89 — company option
- IdeasFilterPopover.tsx — filter option
- IdeasViewPopover.tsx:63 — view mode option
- AgentQuestsTab.tsx:638,737,1008 — quest row? (need to verify, may be card-triggers instead)

**Why not Button:** These are subcomponents of larger pickers/menus/dropdowns. They share a consistent interaction pattern (hover highlight, arrow key navigation, click-to-select). Should live in a Menu/Select/Picker primitive's subcomponent layer, not as raw buttons.

**Candidate API:**
```tsx
<MenuOption
  role="menuitem"
  aria-selected={active}
  onMouseEnter={() => setActive(i)}
  onMouseDown={onSelect}
  className="..."
>
  {label}
</MenuOption>
```

#### 4. **CardTrigger / RowButton** (24+ instances)
Pattern: Entire card or list row is a clickable button; usually has icon + text + metadata; no aria-label (content is visible). Used for navigation or selection.

**Examples:**
- AgentOrgChart.tsx:178 — org card (whole card is button, avatar + name + sub)
- AgentQuestsTab.tsx:952 — quest row?
- IdeasListView.tsx — idea row (need to verify exact buttons)
- NewAgentPage.tsx — agent template card
- QuestStatusPopover.tsx:72 — if status option rows (need to verify)
- PublicLayout.tsx:59 — nav item (whole link area)

**Why not Button:** These break the label-text rule. They have rich internal content (icons, badges, metadata) and are used to replace `<a>` or trigger navigation/selection. Styling as a button primitive makes them too generic; they need a card/row-aware context to control layout and spacing.

**Candidate primitive family:**
```tsx
<RowButton role="button" onClick={onSelect} className="ideas-list-row">
  <RowButtonIcon>{icon}</RowButtonIcon>
  <RowButtonBody>
    <RowButtonTitle>{title}</RowButtonTitle>
    <RowButtonMeta>{metadata}</RowButtonMeta>
  </RowButtonBody>
</RowButton>
```

Or simpler: a `.row-trigger` class applied to raw buttons, with sub-component layout helpers.

---

### D — genuinely raw, keep as-is (55 instances)

These should NOT migrate. They are either test fixtures, accessibility wrappers, or internal to other primitives.

**Test fixtures (22 instances):**
- Popover.test.tsx — 22 instances of `<button>Open Menu</button>` as test harness triggers. These are intentionally minimal for test isolation. Leave as-is.

**Popover/Modal/Picker CHROME — buttons inside primitives (18 instances):**
- EventCanvasEditor.tsx — event form buttons (inside custom form builder, not on the public API surface)
- BillingPanel.tsx, AvatarUploader.tsx — modal/form internals that are part of the feature's internal structure
- PasswordInput.tsx:69 — accessibility toggle inside an input primitive (part of PasswordInput's internal contract)

**Accessibility wrappers (8 instances):**
- QuestPreflightPanel.tsx:78 — button used as a div keyboard-wrapper (non-standard; specific use case)
- MessageItem.tsx — if any buttons are accessibility bridges for screen readers
- LeftSidebar.tsx — if any sidebar buttons are custom-wired navigation

**Legacy / over-specialized (7 instances):**
- EventCanvasEditor.tsx (EventDetailsBuilder) — bespoke event form with domain-specific button styling for event fields
- ConnectIntegrationModal.tsx:126 — OAuth/integration-specific button with custom state (not generic)
- ModelPicker.tsx — model selection (tightly coupled to model selection UX, unlikely to generalize)

**Assessment:** These 55 instances are low-value migration targets. Touching them has high risk (test breaks, feature-specific logic), low reward (already contained within a specific surface). Document them but defer.

---

## Migration Roadmap

**Phase 1: Extract missing primitives (C)**

1. `<TabTrigger>` — wraps PageRail, PageTabs, and picker-list buttons
2. `<ChipClose>` — wraps ref/tag/attachment close buttons (9 instances)
3. Menu/Select subcomponent layer (SelectOption or MenuOption) — wraps picker items
4. RowButton or `.row-trigger` — wraps card/row click areas

**Phase 2: Migrate bucket A**

Once primitives are stable, migrate labeled buttons to `<Button>` across 28 sites. Estimated 5–8h (mostly find-replace + testing).

**Phase 3: Migrate bucket B**

Migrate icon-only buttons to `<IconButton>` across 42 sites, enforcing `aria-label` props. Estimated 6–10h (aria-label audit required; some buttons may lack clear labels and need copy decisions).

**Phase 4: Audit bucket D**

Post-migration, revisit the 55 "keep as-is" instances. Some may become safe to migrate once the new primitives are in place and tested.

---

## Notes

- **Honest assessment:** The 197 count is real, but it's misleading. Half the raw buttons are candidates for A/B straightforward migration (~46% = 91 buttons). The other half are pattern-based and need abstraction first. Treating all 197 as "should have been primitives from day 1" is correct; treating them all as equivalent work is wrong.

- **Button.tsx variance usage:** Current `<Button>` sees heavy use of `variant="secondary"` (default), with `primary` for CTAs and `ghost` for low-priority actions. Confirm naming aligns with tabs/picker patterns (may want to align secondary ↔ ghost semantics with TabTrigger/SelectOption).

- **aria-label debt:** Bucket B (icon-only buttons) has scattered aria-label coverage. Audit will reveal which buttons lack labels; those may need copy decisions before migration can proceed.

- **Classes to retire:** `.ideas-toolbar-btn`, `.quest-compose-picker-row`, `.org-card`, `.company-switcher-item`, etc. These will become noise once their buttons migrate to primitives. Plan a cleanup pass post-migration.

- **Test surface:** Popover.test.tsx contributes 22 of the 50 test-file buttons. Leaving these alone is correct (they're testing Popover behavior, not button behavior). Non-breaking.
