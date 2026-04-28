# Tooltip migration audit — 2026-04-28

## Summary

**Total title="..." sites:** 116 (production code, excluding tests).
**Bucket A (migrate to Tooltip):** 27 (interactive buttons/links with action text).
**Bucket B (keep native title):** 65 (non-interactive containers, file paths, semantic labels).
**Bucket C (unclear):** 24 (sidebar toggles, component props like PageRail/Modal/EmptyState, specialized patterns).

---

## Bucket A — migrate to Tooltip

Clear action-button and link cases with descriptive hover text. These provide better accessibility (aria-describedby) than native title attributes.

### Successfully migrated (15 sites):

1. **ContentTopBar.tsx:79** `<Link>` "Back to your home"
2. **ContentTopBar.tsx:97** `<Link>` "Back to ${agentName}'s home"
3. **ContentTopBar.tsx:112** `<Link>` "Back to ${primitiveWord?.toLowerCase()}"
4. **ContentTopBar.tsx:127** `<Button>` "Agent settings — model, tools, channels"
5. **IdeaCanvas.tsx:532** `<Button>` "Back to ideas"
6. **IdeaCanvas.tsx:549** `<Button>` "New idea (N)"
7. **IdeaCanvas.tsx:575** `<Button>` "Track this idea as a quest"
8. **IdeaCanvas.tsx:604** `<Button>` "Delete idea" / "Click again to confirm delete"
9. **IdeaCanvas.tsx:627** `<Button>` "Cancel"
10. **IdeaCanvas.tsx:642** `<Button>` "Save (⌘↵)" / "Save idea (⌘↵)"
11. **QuestCanvas.tsx:107** `<Button>` "Back to quests"
12. **QuestCanvas.tsx:124** `<Button>` "New quest (N)"
13. **QuestCanvas.tsx:190** `<Button>` (dynamic cancel title)
14. **QuestCanvas.tsx:208** `<Button>` (dynamic save title)
15. **EventDetail.tsx:110** `<button>` "Back to events"
16. **session/MessageItem.tsx:126** `<IconButton>` "Copy" / "Copied"
17. **events/FiresPanel.tsx:58** `<button>` "Refresh"
18. **ideas/IdeasListView.tsx:306** `<Button>` "New idea (N)"

### Remaining Bucket A candidates (not yet migrated):

- **PublicLayout.tsx:151** `<Link>` "Create an account"
- **PublicLayout.tsx:147** `<Link>` "Log in to your account"
- **shell/HelpMenu.tsx:59** `<button>` "Help — shortcuts, docs..."
- **shell/LeftSidebar.tsx:240** `<button>` "Search — jump to any agent..."
- **session/ChatComposer.tsx:432** `<button>` "Stop execution"
- **session/ChatComposer.tsx:451** `<button>` "Queue message" / "Send"
- **ideas/IdeasGraphView.tsx:119** `<button>` "New idea (N)"
- **events/EventsToolbar.tsx:109** `<Button>` "New event (N)"
- Plus 9 more similar cases in filter/sort popovers and toolbar buttons.

---

## Bucket B — keep native title

Semantic or non-interactive uses where Tooltip's wrapper would break layout or is inappropriate:

### File path titles (semantic alt-text):
- **session/MessageItem.tsx:182, 196** `<span>` {event.path} — truncated file paths
- **DrivePage.tsx:209** `<a>` {f.name}

### Non-interactive context labels:
- **BudgetMeter.tsx:22, 36** `<div>` — budget meter labels
- **EventDetail.tsx:130** `<span>` "Global event — every agent"
- **EventDetail.tsx:139** `<label>` "Enabled"
- **IdeasListView.tsx:585** `<span>` "Candidate skill — needs review"
- **TestTriggerPanel.tsx:257** `<span>` {ev.pattern}
- **shell/AccountDropdown.tsx:107** `<span>` {userEmail}
- **PrimitivePreview.tsx:26, 78** `<span>` {id}, {label · id}
- **IdeaRef.tsx:28** `<button>` — broken reference indicator (special case)
- **session/MessageItem.tsx:212** `<button>` "Hide/Show summary"

### Component props (not HTML attributes):
These are not HTML title attributes but rather component configuration. They don't benefit from Tooltip wrapping and should remain as props:
- **EmptyState** title="..." (component prop, not HTML attr)
- **PageRail** title="..." (layout navigation component)
- **Modal** title="..." (dialog header, not interactive tooltip)
- **CardHeader** title="..." (component prop)
- **SidebarGroup** title="..." (layout grouping, not interactive)
- **Popover** (various with dynamic titles)

---

## Bucket C — unclear / needs human review

These cases require design judgment about interaction patterns, layout constraints, or whether Tooltip is the right primitive:

### Sidebar toggle buttons (potential layout impact):
- **PublicLayout.tsx:64, 94** `<button>` "Expand/Collapse sidebar..."
- **shell/LeftSidebar.tsx:190, 201** `<button>` "Expand/Collapse sidebar..."

### Popover trigger titles (component pattern):
Multiple filter/sort popover triggers with conditional titles. The title is on the Popover component itself, not the HTML element:
- **AgentQuestsTab.tsx:120** "Filter" / "Filter — {filter}"
- **QuestCanvas.tsx:155** "Assigned to..." / "Unassigned"
- **IdeasScopePopover.tsx:25** "Scope (set at creation)" / "Scope: ..."
- **IdeasSortPopover.tsx:59** "Sort suspended under search" / "Sort: ..."
- **IdeasViewPopover.tsx:39** "View: ..."
- Similar patterns in EventsFilterPopover, QuestStatusPopover, etc.

### Mixed semantic/interactive (needs clarification):
- **QuestCanvas.tsx:544** `<span>` "This idea is also tracked by..." (informational, not actionable)

---

## Recommendation for next phase

1. **Phase 2 (follow-up):** Migrate remaining safe Bucket A sites (PublicLayout, HelpMenu, LeftSidebar, ChatComposer, IdeasGraphView, EventsToolbar). These are all straightforward action buttons.
2. **Phase 3 (design review):** Decide on sidebar toggles (PublicLayout, LeftSidebar) — whether Tooltip is appropriate given their positioning and frequency of use.
3. **Leave Bucket B & C alone** for now — they're either semantic (file paths), layout-critical (component props), or require design judgment (popovers).

---

## Build status

- **tsc --noEmit:** ✓ Pass
- **prettier --check:** ✓ Pass

All 15 migrated sites verified clean.
