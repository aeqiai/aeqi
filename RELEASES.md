# Release Notes

## v0.60.0 — 2026-05-09

**Headline:** Personality folded into Ideas; event detail gets the canonical header.

- **Agent rail — Personality tab dropped, Ideas is canonical for HOW** (`apps/ui/src/components/AgentPage.tsx` + sibling rail config): the Personality tab duplicated affordance with Ideas — Ideas has been the canonical surface for HOW (per `architecture_four_w_primitives.md`: agents=WHO, events=WHEN, quests=WHAT, ideas=HOW) since the four-primitive model locked. Carrying a separate Personality tab fragmented the mental model. Drop the tab; rail goes 9 → 8. `5fc84a03`.
- **Event detail surface header standardized** (`apps/ui/src/pages/EventDetailPage.tsx`): event detail now wears the same header shape as idea detail / quest detail / role detail — back affordance, kind badge, name, primary action slot. Closes the last asymmetry in the canonical detail-surface header pattern. `d4ced2a5`.

## v0.59.0 — 2026-05-09

**Headline:** Roles dispatch wired; inbox shows every session you're in, sorted recent.

- **Roles tab dispatch hole closed — render `EntityRolesTab` in `CompanyPage`** (`apps/ui/src/pages/CompanyPage.tsx`): `/c/<id>/roles` was added to `COMPANY_PAGE_TABS` in v0.58.0's primitives wiring (`78df6eff`), but `CompanyPage`'s tab switch had no `case "roles"` branch — the URL routed through `CompanyPage` and silently fell through to the default Overview surface. Same dispatch-hole pattern documented as a recurring trap (`feedback_dispatch_hole_pattern.md`): tabs in the route table must have an explicit case in the page-level switch. Wired `roles` → `<EntityRolesTab entityId={...} />` to match the rail's expectation. `4ab0a0a3`.
- **`/api/inbox` broadened to all sessions in scope, sorted by recency** (`crates/aeqi-orchestrator/src/ipc/inbox.rs` + `crates/aeqi-web/src/inbox.rs`): the inbox endpoint previously returned only DM sessions where the caller was an explicit participant — multi-participant sessions, role-addressed seeds, and sessions the caller had been added to via `add_participant` were invisible. Founder mental model: the Inbox is "every conversation I'm in," not "every conversation I started." Broadened the scope query to include any session with the caller as a participant regardless of `kind`, ordered by `last_message_at DESC` so the most-recently-active conversations float to the top. `2e3bc34c`.

## v0.58.0 — 2026-05-09

**Headline:** User row clicks home; entity URLs canonical; entity-tab dispatch hole closed.

- **Sidebar user row routes to `/me`; account dropdown demoted to `⋯` chevron** (`apps/ui/src/components/shell/AccountDropdown.tsx` + `apps/ui/src/styles/layout.css`): the bottom-sidebar user tile was a Popover trigger only — clicking the avatar/name/email opened the account menu but never navigated. Founder mental model: that row IS the personal entity affordance, parallel with every Company row above it. Restructured into two affordances: primary `<Link to="/me">` wraps the avatar + name/email (full row, active-highlight when on `/me/*`); secondary `⋯` chevron button opens the existing Popover (account · inbox · billing · sign-out — sub-actions unchanged). Local-mode (no auth) keeps the bare identity tile — no `/me` route, no secondary actions. Collapsed-rail behaviour: chevron hides; the avatar tile alone routes to `/me`. `cb100f4f`.
- **Entity-scope `/c/<id>/{agents,events,quests,ideas}` routes wired to list surfaces — dispatch hole closed** (`apps/ui/src/components/AppLayout.tsx` + `apps/ui/src/pages/CompanyPage.tsx`): `/c/<id>/agents` (and siblings) fell through to `AgentPage` mounted on the entity's root agent, but `AgentPage`'s `tab` prop has been a no-op since the v0.57.0 chat-as-default redesign — the URL rendered the root-agent chat header with no body. On personal entities where `rootAgent.id` matches the user's own drilled-agent id, the `[← Agents]` back affordance looked like it took the user nowhere. `EntityAgentsTab` had zero call sites. Added the four primitives to `COMPANY_PAGE_TABS` so `AppLayout` dispatches them through `CompanyPage`, then wired explicit branches: `agents` → `EntityAgentsTab(entityId)`; `events` / `quests` / `ideas` → the agent-scoped tab mounted on the entity's root agent (same pattern `MePage` uses for `/me/{events,quests,ideas}`). Drilled-agent route `/c/<id>/agents/<aid>/` unaffected — has non-null `routeAgentId`, bypasses `CompanyPage` entirely. `78df6eff`.
- **All internal entity URL generation routed through `entityPath` helpers** (`apps/ui/src/lib/entityPath.ts` + `apps/ui/src/lib/sessionUrl.ts` + 26 component/page files): swept all hand-crafted `/c/<id>` template literals out of internal link generation. Every `navigate` / `<Link>` / `href` that targets a Company entity now resolves through `entityPath` / `entityPathFromId` / `sessionDeepUrlFromId`, which return `/trust/<addr>` when the entity has a `trust_address` and `/c/<id>` only as the pre-registerTRUST fallback. Per `architecture_trust_canonical_primitive.md` the canonical URL for a registered TRUST is `/trust/<address>`; hand-crafted `/c/<id>` literals throughout the codebase produced inconsistent link generation that the server-side 308 redirect papered over. New helpers: `entityPathFromId` / `entityBasePathFromId` / `sessionDeepUrlFromId` for callers that hold an entityId string + the daemon entities array. 44 hand-crafted literals replaced across 28 files; server-side 308 from `/c/<id>` → `/trust/<addr>` stays in place for old bookmarks; pre-registerTRUST entities still resolve to `/c/<id>`. `a7514175`.

## v0.57.0 — 2026-05-09

**Headline:** Agent surface inverted — header + chat default, rail in Settings; ideas hairlines −97%; humane errors.

- **Drilled-agent surface inverted — chat-as-default, rail moves to Settings sub-surface** (`apps/ui/src/components/AgentPage.tsx` + `AgentSurfaceHeader.tsx` + `AgentSettingsPage.tsx` + `AppLayout.tsx` + `App.tsx`): the canonical agent URL `/c/<eid>/agents/<aid>/[inbox/<sid>]` now renders the inbox/chat surface with no rail — only a header strip (back · agent name · `+ New session` · Settings). Mirrors the idea-detail shape: header at top, full-width content below. The rail (Overview · Personality · Quests · Events · Ideas · Channels · Treasury · Tools · Integrations) moves to a Settings sub-surface at `/c/<eid>/agents/<aid>/settings[/<sub>[/<itemId>]]` — breadcrumbed one level deeper, owned by a new `AgentSettingsPage` that handles rail dispatch. Inbox dropped from the rail (it's the default surface now); Settings dropped from the rail (it IS the rail's container). New `AgentSurfaceHeader` carries default + settings variants. `AppLayout` detects the agent-settings path segment via regex; mounts the rail only on Settings, mounts `SessionsRail` + `ComposerRow` on the bare/`inbox` surface. Old `/c/<eid>/agents/<aid>/<tab>` URLs replace-navigate to the new shape via `RELOCATED_AGENT_TABS` — SPA equivalent of a 308 keeps existing bookmarks alive. The agent surface now matches the founder's lead-with-conversation mental model end-to-end. `e8305fc6`.
- **Ideas hairlines −97% on `/me/ideas` (1540 → 40)** (`apps/ui/src/styles/ideas.css`): sweep per the route audit which flagged `/me/ideas` as the highest-count surface in the app. The `scope-chip` 1px solid border across all four variants (siblings/children/branch/global) was the dominant cluster — 1500 of 1540 borders in the `.ideas-list` subtree at 506 rows. Per `feedback_no_hairlines.md`: cards/chips draw their boundary from filled background (14% muted, 6% global), not outline. Drop the 1px solid on every scope-chip variant. Also drop: 1px dashed border-bottom on `.ideas-list-chip-clear` (active-filter "Clear all" affordance — hover lift via `state-hover` bg carries the boundary instead); 1px dashed border-top on `.empty-state-hero-syntax` above the syntax legend (22px margin-top spacing carries it); 1px dashed outline on `.ideas-list-tag-more` (hover lift via `state-hover` bg). Toolbar chrome (search field, toolbar buttons) intentionally untouched — chrome lensing is the design-system contract. `40cba7e2`.
- **`ImportMenu` trigger demoted to secondary — primary slot belongs to `+ New X`** (`apps/ui/src/components/inbox/ImportMenu.tsx`): per `feedback_button_variant_rules.md` and the route audit, `/me/quests` and `/me/ideas` toolbars were shipping two primaries — Import was rendered alongside `+ New <primitive>`, both at primary affordance. Import is a secondary toolbar action; the primary slot belongs to the canonical creation verb on every primitive surface. Demote the ImportMenu trigger to `variant="secondary"`. One affordance commits, the rest lens. `bec5a307`.
- **Humane error rendering for upstream rate-limits** (`apps/ui/src/components/session/MessageItem.tsx`): chat error bubbles previously rendered raw OpenRouter / DeepInfra JSON verbatim (e.g. `OpenRouter API error (429 Too Many Requests): {"error":...}`). Most chat "errors" are upstream rate-limits, not faults — the raw payload is noise. New `parseErrorContent` lifts the relevant signal into a one-line headline + optional muted detail + optional hint, recognising HTTP 429/4xx/5xx envelopes and generic JSON `error.message` shapes. Falls through to raw content for unknown shapes — never loses information. Quiet visual treatment: card-subtle background, no aggressive red. The chat surface stops shouting when upstream is throttled. `129bda9f`.

## v0.56.0 — 2026-05-09

**Headline:** Chat surface polish — full-width detail, kind-shaped avatars, inset rails, sidebar reordered, awaiting noise gone.

- **`.session-detail` grows to fill its flex-row parent on the agent surface** (`apps/ui/src/components/sessions/SessionDetail.tsx` + `apps/ui/src/styles/chat.css`): after the v0.55.0 migration of `AgentSessionView` to `<SessionDetail hideComposer />`, the detail pane rendered at its intrinsic content width inside the agent-rail flex row instead of stretching across the available space — visually identical to the user-inbox behaviour but on the agent surface the rail+detail flex container left obvious empty real estate to the right of the bubble column. Add `flex: 1; min-width: 0` to the primitive's outer container so it consumes its allotted column on every adopter. Full-width on agent surface; user inbox unaffected. `0d66a779`.
- **Avatars shape by participant kind — agents square, humans circle** (`apps/ui/src/components/BlockAvatar.tsx` + `apps/ui/src/components/sessions/ParticipantStrip.tsx` + `apps/ui/src/components/session/MessageItem.tsx`): the v0.55.0 ship rounded the generic `BlockAvatar` identicon to a circle (`border-radius: 50%`) for visual parity with custom avatar images, but that flattened the agent-vs-human distinction the chat surface had been carrying implicitly. Introduce a `kind` prop on `BlockAvatar` (`"agent" | "user"`); agents render as a rounded square (`--radius-sm`), humans as a circle (`50%`). Resolution path mirrors the existing `MessageItem` / `ParticipantStrip` cross-references — agent participants → square, current user + other people → circle. Holds across identicon and custom-image variants. `279a5beb`.
- **Session-rail rows inset so active-state highlight reads as a tile** (`apps/ui/src/components/sessions/SessionRail.tsx` + `apps/ui/src/styles/layout.css`): the rail row's `.active` background previously bled to the rail edge, making the highlight read as a flat band rather than a discrete tile — the affordance the design system uses on every other rail (Personal, Company, Agent tabs). Add horizontal inset (`padding-inline: var(--space-2)`) on the row container so the active background paints as a contained tile with breathing room on both sides. Pure CSS change; no behavior shift. `cfdb1367`.
- **Sidebar primitive order — Workspace before Organization** (`apps/ui/src/components/shell/LeftSidebar.tsx`): the global sidebar carried the Organization section above Workspace, but the founder mental model puts the workspace (the user's own Personal entity + their owned Companies) above the organization-scope (cross-Company governance + admin). Swap the section order. Pure ordering change; same primitives, same routes. `f877739c`.
- **`AwaitingBanner` dropped from the top of agent inbox** (`apps/ui/src/components/AgentSessionView.tsx`): the v0.55.0 ship dropped the "Awaiting your decision" pre-thread tag strip on user inbox via `<SessionDetail>`'s `preThreadSlot` retire, but the agent surface still rendered an `<AwaitingBanner>` above the session detail when an agent step was waiting for input. Same noise; same redundancy with the rail-row decision badge. Drop the banner; the rail row + composer state already carry the affordance. `8711b7bc`.

## v0.55.0 — 2026-05-09

**Headline:** Agent inbox + user inbox finally share the same top bar — Wave 4 closes.

- **`AgentSessionView` migrated to `<SessionDetail hideComposer />` — full session-unification ships** (`apps/ui/src/components/AgentSessionView.tsx` + `apps/ui/src/components/sessions/SessionDetail.tsx`): closes the last divergence between agent-rail inbox and user inbox detail. v0.53.0 extracted `<SessionDetail>` and migrated `MeInboxPage`, but `AgentSessionView` kept its own header/strip render path because the WS-streaming composer + thinking segments + queued drafts + fork/edit/resend stack didn't compose cleanly under the primitive's contract. Resolution: `<SessionDetail>` gains a `hideComposer` flag; agent surface mounts the primitive for ParticipantStrip + header + MessageItem stream, then renders its own bespoke composer below. Per-message handlers (`onFork`, `onEdit`, `onResend`, `onJumpToEvent`) move from the dead render-prop slot to first-class callback props on `<SessionDetail>` so the agent surface composes them without a second component. Agent inbox top bar is now byte-identical to user inbox top bar; the visual primitive is single-source on every adopter. Wave 4 closed. `bbad98c9`, `d5983b4b`.
- **`<ParticipantStrip>` cross-references daemon agents + auth user for avatar consistency** (`apps/ui/src/components/sessions/ParticipantStrip.tsx`): the strip previously rendered participant avatars from the session participant payload alone; agents missing `avatar_url` fell back to a generic `BlockAvatar` identicon while the same agent on `MessageItem` (which cross-references `useDaemonStore`) rendered the canonical custom avatar. Visual divergence between header strip and message bubble for the same agent. Strip now resolves agent participants through `useDaemonStore` and the current user through `useAuth`, matching the resolution path `MessageItem` already uses. `7c2c4a96`.
- **`BlockAvatar` identicon rendered as a circle, not a rounded square** (`apps/ui/src/components/BlockAvatar.tsx`): the generic identicon used `border-radius: 25%` which produced a rounded-square shape that clashed visually with custom avatar images (which are circular by container CSS). Switch to `border-radius: 50%`. Round-everywhere on the chat surface. `780a801b`.
- **Company-scope `/channels` route redirects to Overview** (`apps/ui/src/router.tsx`): v0.54.0 reverted the brief Company-tier Channels surface but left the bare `/c/<eid>/channels` route unhandled — direct navigation 404'd. Add a redirect to `/c/<eid>/` so any external link or stale bookmark lands on the canonical Company Overview. `21729e62`.
- **Inbox detail drops the "Awaiting your decision" tag strip** (`apps/ui/src/components/sessions/SessionDetail.tsx`): the `kind=decision_request` chip strip above the thread was visual noise — the row in the rail already carries the decision badge, and `<SessionDetail>` headers carry enough context. One pre-thread slot retired; surface area shrinks. `8f5d0f53`.

## v0.54.0 — 2026-05-09

**Headline:** Company Overview becomes a cockpit; chat polish lands; Channels back to agent-only.

- **Company Overview redesigned as pulse + numbers, not a P&L** (`apps/ui/src/pages/CompanyPage.tsx` + `apps/ui/src/styles/overview.css`): the first surface a Company shows must answer "what's happening now," not "what's the revenue" — Treasury already owns the financial home. Three blocks: (1) hero strip preserved (name + tagline + public toggle); (2) pulse band — three side-by-side cards for active quests (top 5 in-progress, agent avatar + title), awaiting decisions (entity-scoped inbox `kind=decision_request`), and last-24h activity (recent agent events, time-relative); (3) slim numbers row — four stat tiles for Treasury (asset count → `/treasury`), Activity (transfer in/out, green/red), TRUST signers (`signersCount` via `fetchTrust` → `/trust/<addr>`), and Active agents (running/active out of total → `/agents`). All cards and tiles click through. Empty states render gracefully and surface the next action inline (`No active quests · start one →`). Pulse band stacks at ≤900px; numbers grid drops 4→2→1-up at ≤900px / ≤480px. CSS uses design-system tokens only — no hairlines, no bespoke colors. Reuses existing data hooks (`useDaemonStore`, `useInboxStore`, `useTreasury`, `fetchTrust`, `useBalance`). `4a4a1857`.
- **Chat polish — inline author/avatar, beefed-up header, clickable avatars** (`apps/ui/src/components/session/MessageItem.tsx` + `sessions/SessionDetail.tsx` + `sessions/ParticipantStrip.tsx` + `BlockAvatar.tsx` + `apps/ui/src/styles/chat.css`): three founder-directed changes in one ship. (1) Avatar moves into the author header row — `MessageItem` no longer renders a standalone `.asv-msg-avatar` block beside the bubble; avatar + name now share `.asv-msg-author` as a flex row, user messages flip via `flex-direction: row-reverse` so name+avatar mirror the right-aligned bubble. Drops the dead `.asv-msg-avatar` / `.asv-msg-user .asv-msg-avatar` CSS. (2) Session-detail header carries more information — participant strip is no longer a separate row above; it folds into `.session-detail-header-extras` on the right. Left side gets a beefier layout: title (`font-size-base`, weight 600) on its own line, then a meta line below carrying subtitle + separator + activity label (`Active 12m ago` / `Streaming…`). At ≤1024px header stacks vertically. Activity timestamp pulls from the last message; streaming state replaces it mid-turn. (3) Avatars are clickable — `BlockAvatar` accepts an optional `href` prop, wraps the SVG in a React Router `<Link>` with hover opacity + focus-visible outline. `MessageItem` resolves target per author kind: agent → `/c/<entityId>/agents/<aid>`, role → `/c/<entityId>/roles/<rid>`, current user → `/account`, other users unlinked (no public surface today). `ParticipantStrip` applies the same resolution. `onClick={e.stopPropagation()}` so embedded avatars don't trigger parent row-click handlers. `deb9cb5f`.
- **`/channels` Company surface reverted; agents list flattened** (`apps/ui/src/api/conversation-channels.ts` + `apps/ui/src/components/AppLayout.tsx` + `EntityAgentsTab.tsx` + `channels/ChannelComposer.tsx` + `channels/NewChannelModal.tsx` + `shell/LeftSidebar.tsx` + `pages/ChannelDetailPage.tsx` + `pages/ChannelsListPage.tsx` + `pages/CompanyPage.tsx` + `queries/keys.ts`): two founder reverts in one ship, -1420 LOC. Channels are an agent-rail primitive only — the brief two-day Company-tier Channels surface added at `e2ce3cb0` (v0.52.0) is gone: rail entry, page route, `ChannelsListPage`, `ChannelDetailPage`, `ChannelComposer`, `NewChannelModal`, conversation-channels API client, `conversationChannelKeys`. Company rail is back to Overview · Roles · Ownership · Treasury · Governance (`project_company_rail_v1.md` restored verbatim). `AgentChannelsTab` (transport channels per agent) stays. Agents list view is flat — the depth-indent at 24px/level shipped 2026-05-06 (task #164) is reverted; hierarchy lives in the chart view, not the list. `buildAgentTreeData` / `AgentTreeEntry` / `INDENT_PX` dropped; `AgentsList` maps the toolbar-sorted array directly. `dc08e9f3`.
- **T/O/G polish — drop 46 hairlines, fix Treasury symbols, hoist proposals** (`apps/ui/src/pages/GovernancePage.tsx` + `apps/ui/src/hooks/useTreasury.ts` + `apps/ui/src/lib/tokenRegistry.ts` + `apps/ui/src/styles/components.css` + `apps/ui/src/test/useTreasury.test.ts`): three fixes in one ship across Treasury, Ownership, Governance. (1) `GovernancePage` role chips were rendered as `<Button variant="secondary">` — 46 chips × one resting 1px border each = the largest hairline cluster on app.aeqi.ai post-V14 sweep. Swap to `<Badge variant="muted">` wrapped in a button-reset (`.role-chip-button`) that preserves navigation while erasing the borders; chips are role labels used as nav targets, not actions, so the affordance is presentational with a click handler. Drops Governance `borderHairlines` 46 → 0. (2) Treasury symbols leaked the 4-char hex prefix of unknown token addresses (e.g. `C26A`) via the `symbolFromAddress` shim in `useTreasury`. Replace with a `lib/tokenRegistry` resolver keyed by `chainId+address` with USDC/WETH entries for Base / Base Sepolia / Mainnet, falling back to a truncated `0xc26a…` for registry misses. Removes the most visible "looks like a bug" leak on Treasury without touching indexer schema. (3) Hoist `ON-CHAIN PROPOSALS` above the grant catalog on Governance so the page leads with decisions rather than the permissions reference — pure ordering change, no new components. `03e344a1`.

## v0.53.0 — 2026-05-09

**Headline:** SessionDetail extracted — three inbox surfaces collapse into one primitive.

- **`<SessionDetail>` extracted as the canonical session-detail primitive; `<InboxDetail>` + `<InboxComposer>` deleted** (`apps/ui/src/components/sessions/SessionDetail.tsx` + `apps/ui/src/pages/MeInboxPage.tsx` + `apps/ui/src/styles/inbox.css`): the inbox surfaces and the agent surface were two divergent render paths for what `architecture_session_primitive.md` says is one universal primitive. Pure-render, transport-agnostic primitive composes ParticipantStrip + header + MessageItem stream + Composer chrome; surfaces compose surface-specific extras (Archive button via `composerExtraActions`, Back/Open via `headerExtras`, decision-request tag via `preThreadSlot`). MeInboxPage migrated; `InboxDetail.tsx` (184 LOC) and `InboxComposer.tsx` (228 LOC) deleted along with the `.inbox-thread-msg-*` class family — MessageItem already renders the canonical `.asv-msg-*` shape, so the dual paths weren't paying their cost. Per-row message fetch + dismiss-endpoint probe lifted from the dropped components into the page. Net diff: -181 LOC; -412 LOC dead code dropped. Agent surface migration deferred — transports diverge there (WS streaming + thinking segments + queued drafts + fork/edit/resend + attach pickers + file drag/drop on AgentSessionView vs store-poll + simple POST on InboxDetail), and the visual primitive is what was actually drifting. `16586e95`.
- **Inbox composer position unified with agent session; `replyable` gate dropped** (`apps/ui/src/components/AppLayout.tsx` + `apps/ui/src/components/inbox/InboxComposer.tsx` + `apps/ui/src/components/inbox/InboxDetail.tsx` + `apps/ui/src/styles/inbox.css`): three concrete fixes for the visual-parity gap between the inbox detail and the agent session surface that v0.51.0/v0.52.0 left open. (1) AppLayout's chat ComposerRow no longer double-mounts on top of the inbox detail — the gating condition matched both `/c/<eid>/inbox` and the drilled-agent inbox, so MeInboxPage's own composer stacked under the global ComposerRow; now gated to `drilledAgent` only. (2) InboxComposer renders absolute-positioned at the bottom of `.inbox-pane-detail` exactly the way `.composer-row` floats over `.content-main-col` on the agent surface, with the same scroll-fade. (3) The `replyable` flag — which silently hid the composer on threads where it was missing or false — is dropped; every session is replyable by definition of the universal primitive, no per-row gate. Foundation for the SessionDetail extraction that landed in `16586e95`. `a434e3b4`.

## v0.52.0 — 2026-05-09

**Headline:** Inbox vocabulary locks across surfaces — agent URL, default tab, toolbar parity.

- **Agent inbox URL renamed `/sessions/` → `/inbox/`, default tab Overview, toolbar parity** (`apps/ui/src/components/AgentPage.tsx` + `AppLayout.tsx` + `ContentTopBar.tsx` + `SessionRedirect.tsx` + `session/useSessionManager.ts` + `sessions/SessionsFilterPopover.tsx` + `sessions/SessionsSortPopover.tsx` + `sessions/SessionsToolbar.tsx` + `shell/ComposerRow.tsx` + `shell/SessionsRail.tsx` + `lib/sessionUrl.ts`): closes the last vocabulary leak on the agent surface — the URL path itself read `/sessions/` while every visible tab and copy reference said "Inbox" since v0.51.0. Three changes: (1) URL path renamed across `sessionUrl` builder, `SessionRedirect` legacy fallback, route definitions, and the rail row hrefs — `/agents/<id>/sessions/<sid>` now resolves via 308 to `/agents/<id>/inbox/<sid>`; (2) default agent tab flipped from "Inbox" to "Overview" so a fresh agent surface lands on the canonical home tab, not on the session list (matches Personal rail behavior at `/me/`); (3) sort + filter popovers now mount on both the agent rail and the personal inbox via `<SessionsToolbar>`, closing the last toolbar-parity gap from `75192a9a`. URL paths are now the canonical noun on every surface. `3fbe1383`.
- **Inbox toolbar unified — `<SessionsToolbar>` extracted, rail-internal search dropped** (`apps/ui/src/components/inbox/InboxToolbar.tsx` + `sessions/SessionRail.tsx` + `sessions/SessionsToolbar.tsx` + `sessions/SessionsToolbar.stories.tsx` + `sessions/SessionRail.stories.tsx` + `shell/SessionsRail.tsx` + `styles/layout.css`): the v0.51.0 ship landed two divergent toolbars — `InboxToolbar` (sort + filter popovers, on `/me/inbox`) and a rail-internal `<input>` search affordance baked into `<SessionRail>` (on the agent surface). Different shape, different keyboard model, different visual chrome. Extracted the canonical `<SessionsToolbar>` primitive — search + sort + filter in the canonical chrome zone (lens before commit) — and mounted it on both adopters. Rail-internal search affordance removed from `<SessionRail>` (the `enableSearch` knob, `j/k` filtered traversal, `.layout-search-*` family). One toolbar, two adopters; visual + behavioral parity guaranteed by construction. -298 LOC, +323 LOC (net +25 for the new component + Storybook coverage). `75192a9a`.
- **Channels in Company rail (Slack-style company channels)** (`apps/ui/src/components/shell/LeftSidebar.tsx`): Channels surfaces under the Company rail as a first-class tab, mirroring how Slack scopes channels to the workspace rather than the global sidebar. Re-introduces a feature that was dropped in `765d516a` for being scope-mismatched (LeftSidebar global nav) — the right home is the Company rail, where the channel set is bounded to the Entity. `e2ce3cb0`.
- **Studio + Channels dropped from LeftSidebar global nav** (`apps/ui/src/components/shell/LeftSidebar.tsx`): the global LeftSidebar carried Studio + Channels entries from earlier exploration; both are wrong-scope at the global level — Studio is a single-page surface entered from the architect button, Channels belongs under the Company rail (re-added in `e2ce3cb0`). Dropped both from the global nav along with the now-unused `StudioIcon`, `ChannelsIcon`, and `isStudio` flag. -25 LOC. `765d516a`.

## v0.51.0 — 2026-05-09

**Headline:** Inbox is the chat — five surfaces, one composer, multi-participant native.

- **Multi-participant chat shape on every adopter** (`apps/ui/src/components/sessions/ParticipantStrip.tsx` + `AddParticipantModal.tsx` + `apps/ui/src/components/session/MessageItem.tsx` + `inbox/InboxDetail.tsx` + `apps/ui/src/styles/chat.css`): closes the universal-conversation gap. `architecture_session_primitive.md` locks session as multi-participant native, but the chat surface still rendered like a 1:1 DM — no participant strip on inbox, the AddParticipant modal was a stub, and user turns had no avatar/name on the bubble. Three changes: (1) `ParticipantStrip` extracted as a reusable primitive and mounted on both `/me/inbox` detail and the agent session surface (no more divergence between adopters); (2) `AddParticipantModal` revamped from stub to a real picker — search across agents, roles, and people; click-to-add posts to `/sessions/<id>/participants` and refreshes the strip; (3) user messages now render avatar + name on the right (`user.avatar_url` when available, `BlockAvatar` otherwise), mirroring the agent on the left. The chat surface now reflects the primitive on every adopter. `6645fb47`.
- **Sessions → Inbox in agent surface copy** (`apps/ui/src/components/AgentPage.tsx` + `session/EmptyState.tsx` + `sessions/SessionRail.tsx` + `shell/SessionsRail.tsx`): the agent surface tab now reads "Inbox" instead of "Sessions", matching the universal-conversation framing per `architecture_session_primitive.md` — session is the underlying primitive; inbox is the user-facing concept. Copy-only rename: URL paths, route ids, store keys, and component names (`SessionRail` / `SessionsRail`) intentionally unchanged. Search input on both adopters reads "Search inbox", and the agent rail's empty-state title matches the inbox's "inbox is clear" wording for visual parity. `3f931d6c`.
- **Speaker name above every message bubble** (`apps/ui/src/components/session/MessageItem.tsx` + `apps/ui/src/styles/chat.css` + `inbox.css`): adds a small muted `.asv-msg-author` header above each session message (top-left for incoming agents/roles, top-right for the user) and mirrors the same alignment convention on the inbox thread role label. The avatar alone disambiguates in 1:1, but once a third voice joins, you need a name on every turn to track who said what. Standard chat affordance (Slack/Linear/Discord all do it) and useful for accessibility in the 2-party case. Pairs with the multi-participant ship — names are required, not optional, on the locked primitive. `db6fb6f1`.
- **Canonical search input on `<SessionRail>`** (`apps/ui/src/components/sessions/SessionRail.tsx` + `SessionRail.stories.tsx` + `apps/ui/src/styles/layout.css`): pulls the search affordance into the universal rail primitive so both adopters (`MeInboxPage` + `shell/SessionsRail`) get it for free — zero call-site change, no divergence. Filter is component-internal, case-insensitive against `row.primary` and `row.secondary`, with a "no matches" empty state and ESC-to-clear. `j` / `k` traversal walks the filtered subset so typing narrows keyboard selection. Visual chrome mirrors the Ideas toolbar search-input shape (`.ideas-list-search*` family) — same magnifier glyph, sizing, focus ring, clear button. Adopters opt out via `enableSearch={false}`; default is on. `8aed4035`.
- **Inbox composer + sessions rail visual parity v2** (`apps/ui/src/pages/InboxPage.tsx` + supporting styles): `variant="shell"` on the inbox rail and single-line row treatment bring the inbox surface flush with the agent-session shape end-to-end. Continuation of v0.50.0's parity work — the last visual gaps between inbox and agent chat are closed. `857d5260`.

## v0.50.0 — 2026-05-09

**Headline:** Session is universal — composer, rail, inbox now identical to chat.

- **Inbox visual parity with agent session** (`apps/ui/src/pages/InboxPage.tsx` + supporting styles): inbox surface now mirrors the agent-session shape end-to-end — `attachmentTypes`, slash palette, kbd ribbon, single-line rail row, 1024px collapse breakpoint. Closes the last gap in session-as-universal-conversation: every session-shaped surface (agent chat, inbox, idea/quest comments) now lights up the same affordances. `e9c661fd`.
- **`<SessionRail>` extracted as the canonical session-rail primitive** (`apps/ui/src/components/session/SessionRail.tsx`): -378 LOC across the surfaces that previously hand-rolled their own rail layout. One component owns rail title, row shape, collapse behavior, search/sort/filter affordances. Surfaces consume by passing items + handlers; visual drift across rails is no longer possible. `4b8bc72a`.
- **Five surface composers collapsed into a canonical `<Composer>` primitive** (`apps/ui/src/components/session/Composer.tsx`): inbox, agent chat, idea comments, quest comments, and studio chat all rendered their own composer with subtly different keyboard shortcut sets, attachment-button placement, and submit-state handling. One primitive now owns the contract; consumers pass `attachmentTypes`, `onSubmit`, optional slash-palette + kbd ribbon. Visual + behavioral parity guaranteed by construction. `d7a78967`.
- **Ideas search/sort/filter restored on table + kanban views** (`apps/ui/src/components/ideas/IdeasTableView.tsx` + `IdeasKanbanView.tsx`): P1 hotfix. The Phase-2 view-mode switch (v0.45.0) only wired the search/sort/filter toolbar through to the list view; switching to table or kanban silently dropped the filter state, so any non-default view rendered the unfiltered idea set. Toolbar state now flows through all three views uniformly. `6c2029a0`.

## v0.49.0 — 2026-05-08

**Headline:** Architect close-the-loop — second contract trap closed, /studio walks two shapes end-to-end.

- **Architect — schema-gate template allow-list narrowed to known-good on-chain wiring** (`crates/aeqi-architect/src/llm.rs`): walk-3 found `architect.deploy` reverting on `registerTRUST` because the LLM emitted `template: "foundation"` for a non-profit brief — the schema-gate (shipped v0.48.0 `f2526074`) accepted `foundation` as canonical, but only `entity` / `venture` / `fund` have proven on-chain wiring through the provisioner today. Snap any non-canonical template (including the previously-accepted `foundation` and any new LLM drift like `nonprofit` / `startup` / `lp`) to `entity`, the safest universal default. Closes the walk-3 registerTRUST revert root cause; verified end-to-end via walk-8 across two distinct brief shapes (Foundation + Venture flavors), TRUSTs minted on both, indexer trustsCount 22→24. `97085207`.
- **UX walk v24 batch — public /economy + /me/portfolio drop + Tables Phase 2 CSS** (`apps/ui/src/pages/economy/EconomyPage.tsx` + `apps/ui/src/router.tsx` + `apps/ui/src/styles/layout.css`): three v24-walk fixes, one ship. (1) `/economy` now renders for authed users — was bouncing to `/me/inbox` because the route guard's auth-gate ran before the public-route allow-list (the Economy is a public app surface per `project_public_app_surfaces.md`). (2) `/me/portfolio` route dropped — Personal rail v1 (`project_personal_rail_v1.md`) has no portfolio tab; the route was a v0.32.0 leftover that 404'd in production and confused the rail surface count. (3) `IdeasTableView` container fix — the table view's flex container was cramped to 250px in a 900px viewport because Phase 2's CSS shipped a `min-width` without a matching `flex: 1`; columns now distribute correctly across the full content area. `3d27b535`.

## v0.48.0 — 2026-05-08

**Headline:** /studio deploy reaches the chain — and survives natural language.

- **Runtime `architect.deploy` seam retired; platform owns the deploy** (`crates/aeqi-orchestrator/src/ipc/architect.rs` + `daemon.rs` + `crates/aeqi-web/src/routes/architect.rs` + `agent_registry.rs` + `ipc/blueprints.rs`): the runtime-side `architect.deploy` IPC verb (and its `POST /api/architect/deploy` HTTP route) wrote entities + agents + roles into the runtime DB but never reached the platform's `runtime_placements` table or the on-chain TRUST provisioner — so every architect deploy was half-shipped: runtime had a working Company, platform thought the entity didn't exist, `/api/entities` filtered it out, `/c/<id>/*` bounced to `/me/inbox`, and `registerTRUST` never fired (dogfood walk 2026-05-08, captures-run3 + spawn `95d9b861`). Three runtime-side changes: retire the `architect.deploy` IPC verb + dispatch in `daemon.rs`; drop the runtime's `/api/architect/deploy` HTTP route (`draft` and `refine` remain); extend `handle_spawn_blueprint` to accept either a static catalog slug (existing) or an `inline_blueprint` JSON object (new) so the platform can ferry the architect's draft through the same verb every other Company spawn already uses. Also fixes the slug-collision footgun on /studio second-deploy: the `entities` INSERT used the root agent's `canonical_name` as the slug, so two blueprints with distinct brand slugs collided on the default `founder` persona name and tripped UNIQUE. `spawn_with_entity_id` gains an `entity_slug_override: Option<&str>` arg; `spawn_blueprint` passes `Some(&blueprint.slug)` for fresh-root spawns so the canonical brand lands on the entity row decoupled from the persona's canonical_name. Pairs with platform `931aa34` — the platform's new `POST /api/architect/deploy` is now the only path. `4b74b6a0`.
- **Architect — schema-gate LLM output before runtime spawn** (`crates/aeqi-architect/src/llm.rs`): walk-2 (post-`4b74b6a0`) found platform `architect.deploy` returned 200 + entity_id but the runtime spawn failed with `unknown variant 'contractor'` — no agents/roles ingested, `/c/<id>/` hung at splash. The LLM emits English-sensible role_type values (`contractor`, `freelancer`, `board`, `ceo`) that aren't in the canonical `RoleType` enum (`director` / `operational` / `advisor`); fixing the prompt would help but typos should never crash spawn. Schema-gate the parsed Blueprint after `normalize` and before handoff: walk `seed_roles[].role_type` and the top-level template, snap each to its nearest canonical variant, and `warn!` the snap so `journalctl` shows LLM drift. Defense in depth. Snapping rules: `contractor/freelancer/consultant/employee/staff/operator/worker/ic` → `operational`; `board/advisors/advisory/mentor/investor/observer` → `advisor`; `founder/cofounder/ceo/cto/cfo/coo/chair/president/executive/owner` → `director`; unknown role_type → `operational`; null / non-string → dropped (serde `Option` default); template: `nonprofit` → `foundation`, `startup/vc` → `venture`, `lp/syndicate` → `fund`, unknown → `entity`. Eight new unit tests cover the contractor regression, every synonym bucket, the unknown-default path, null / non-string handling, and canonical pass-through. `f2526074`.

## v0.47.0 — 2026-05-08

**Headline:** Two surfaces, finished — Kanban drags, Architect speaks on every runtime.

- **Ideas Tables — Phase 2.5 Kanban drag-drop, HTML5 native** (`apps/ui/src/components/ideas/IdeasKanbanView.tsx` + `apps/ui/src/styles/layout.css`): closes the Tables Phase 2.X loop. Phase 2.0 (v0.45.0) shipped click-to-cycle status; this ship adds drag-drop between status lanes via the native `DataTransfer` API — no `react-beautiful-dnd` / `dnd-kit` dep added (bundle cost isn't justified for a single-axis cross-lane drop). Click-to-cycle path stays intact. Lane drag-over highlight uses a background tier step, not a `border-left-color` shift, per the no-hairlines rule. Within-lane reordering deferred (would need a `manual_order` column). `c2b08b26`.
- **Architect — LLM on every runtime, host and sandbox** (`crates/aeqi-architect/src/llm.rs` + `crates/aeqi-orchestrator/src/ipc/architect.rs`): VPS walk-7 found Phase-2 `architect.draft` falling back to stub on the host runtime AND the sandbox runtime — two failure modes. Sandbox runtimes set `AEQI_DATA_DIR=/data` with no `HOME`, so the v0.44.0 substrate-fallback (`~/.aeqi/aeqi.db` decrypt) returned early; sandbox `aeqi.db` is empty anyway because sandbox proxies through `api_key="proxy"` + `base_url=127.0.0.1:8443/api/llm/v1`, which `build_default_llm()` ignored as env-only. Fix: `ensure_llm_env_resolved()` resolves `data_dir` from `AEQI_DATA_DIR` first, then `HOME/.aeqi`; after substrate read fails, parses `aeqi.toml` and pulls `[providers.openrouter]` api_key + base_url into the in-process env; `build_default_llm()` honors `OPENROUTER_BASE_URL` so the sandbox proxy URL routes through the platform's `/api/llm/v1` endpoint where real upstream auth lives. Host (substrate path) and sandbox (toml-fallback path) both reach the LLM. `1f4ef592`.
- **UX walk-22 P1 bundle — query-preserve, link rows, kanban lanes** (`apps/ui/src/pages/CompanyPage.tsx` + `apps/ui/src/components/ideas/IdeasListView.tsx` + `apps/ui/src/styles/layout.css`): three fixes from UX walk v22, one ship. (1) Trust-route 308 now appends `location.search` so `/c/<id>/ideas?view=kanban` deep links survive the redirect to `/trust/<addr>` instead of silently falling back to list. (2) `IdeasListView` rows are `<Link to=...>` not `<button onClick>` — middle-click and right-click → "Open in new tab" now work, screen readers announce them as links, and walk-script probes can extract URLs. Keyboard nav (`ArrowDown`/`ArrowUp`/`Escape`) intact. (3) `IdeasKanbanView` had no CSS for `.ideas-kanban*`, so lanes flowed vertically as default block elements — added horizontal flex layout (280-320px columns, `overflow-x: scroll`); cards use design tokens for spacing, color, shadow per the canonical palette. `e37341dd`.
- **CLAUDE.md (apps/ui) — "brief specs vs locked rules: translate, don't transcribe"** (`apps/ui/CLAUDE.md`): captured from the Tables Phase 2.5 cycle. The brief specified a `border-left-color` shift for the lane drag-over highlight; the right move is silent translation to the canonical equivalent (background tier step), not a deviation-and-explain paragraph in the reply. Adds a translation table for recurring brief-vs-rule pairs so future agents apply the canonical move without re-deriving the constraint. `38116e96`.

## v0.46.0 — 2026-05-08

**Headline:** Ideas grow children, refine works past turn one.

- **Ideas Phase 2.1 — children list + property chips on the detail page** (`apps/ui/src/components/ideas/IdeaPropertyChips.tsx` + `IdeaChildrenList.tsx` + `IdeaCanvas.tsx` + `apps/ui/src/styles/layout.css`): the substrate from v0.45 (`parent_idea_id`, schemaless `properties`) gets first-class affordances on the canvas. `IdeaPropertyChips` renders properties as inline chips on the canvas header — click to edit (text input or status dropdown for the canonical `todo` / `in_progress` / `done` enum), `+ Add property` opens a small modal, X removes a key. Writes deep-merge via `PUT /ideas/:id/properties`; explicit null removes. `IdeaChildrenList` shows children (rows where `parent_idea_id = this idea`) under the BlockEditor body as small cards with name + status chip; click navigates to the child detail; `+ Add child` creates a new Idea with `parent_idea_id` pre-filled. Section hides itself when no children exist (the dashed Add-child pill stays as a single affordance). Wired into `IdeaCanvas` only in edit mode; compose mode unaffected. React-query invalidation on every property/child write — Kanban view picks up status changes automatically. `7a3aadbd`.
- **Architect refine — 90s timeout + raw-body diagnostics on parse failure** (`crates/aeqi-architect/src/llm.rs` + `crates/aeqi-web/src/routes/architect.rs`): Wave 35 multi-turn refine was timing out mid-body-stream against the slowest OpenRouter shards — the reqwest client and the outer `tokio::time::timeout` both held at 30s, and `resp.json()` failed opaquely with `error decoding response body` when the body landed late. Three changes in the shared LLM call layer: bump reqwest client timeout to 90s (REFINE_TIMEOUT) so the HTTP client outlives the slowest body stream while the per-call deadline stays enforced by the outer timeout; switch `resp.json()` to text-then-parse so future parse failures emit the raw body preview in the error message instead of a generic decode string; bump refine's outer deadline to 90s and the IPC proxy timeout to 100s so refine has end-to-end headroom. Draft path keeps its 30s deadline — only refine's behaviour changes. The hypothesis in the brief (missing `response_format` on refine) was wrong; both the chat shape and `response_format` were already correct. Real cause was the request-level timeout. UX walk v21 FAIL → v22 PASS. `4b88ab64`.

## v0.45.0 — 2026-05-08

**Headline:** Ideas become a database.

- **Ideas-as-database — Phase 2 substrate** (`crates/aeqi-orchestrator/src/ideas/` + `apps/ui/src/components/ideas/`): Ideas gain `parent_idea_id` (self-FK, nullable, ON DELETE SET NULL) and a schemaless `properties` JSONB column. Migration v15 (idempotent additive ALTER + partial index `idx_ideas_parent_idea_id`); legacy DBs catch up on next start. `IdeaStore` trait gains `set_parent` / `set_properties` / `merge_properties` (deep-merge) / `list_children` — defaulted no-op for non-SQLite backends, overridden by `SqliteIdeas`. `store_idea` / `update_idea` IPC verbs accept the new fields end-to-end; new verbs `list_idea_children` (`GET /api/ideas/:id/children`) and `set_idea_properties` (`PUT /api/ideas/:id/properties`, deep-merge). `idea_to_json` round-trips both new fields; agent_registry visibility queries hydrate them. Migration tests updated (REQUIRED_IDEAS_COLUMNS, REQUIRED_INDEXES, schema_version assertion); 6 migration tests + 570 orchestrator lib tests green. `140c1357`.
- **Three views of every Idea — List / Table / Kanban** (`apps/ui/src/components/ideas/IdeasViewPopover.tsx` + `IdeasTableView.tsx` + `IdeasKanbanView.tsx`): the IdeasViewPopover gains `table` and `kanban` modes alongside the existing `list`; selection is URL-persisted (`?view=table` | `?view=kanban`), default stays `list`. Table view promotes the top-6 most-frequent property keys to columns from the visible set; row click opens detail. Kanban groups by `properties.status` with default lanes `todo` / `in_progress` / `done`; Phase 2.0 cut uses click-to-cycle status (drag-drop deferred to Phase 2.5 per the brief). Notion-shaped Ideas, with the substrate to back it. `140c1357`.
- **`apiRequest` double-`/api/` prefix trap on Architect's three verbs** (`apps/ui/src/pages/StudioPage.tsx`): `apiRequest` from `@/api/client` already prepends `API_BASE_URL` (`/api`); `apiRequest("/api/architect/draft")` emitted `/api/api/architect/draft` and 404'd. All three architect verbs (`draft`, `refine`, `deploy`) carried the doubled prefix; same root cause as `01aae710`'s UX P0 hotfix on `GoogleConnectCard`. Live curl now returns a real LLM-generated blueprint via DeepSeek/openrouter, not the stub fallback. Pattern codified in CLAUDE.md (`c7418f27`) since it hit twice in two days. `9f607ce2`.

## v0.44.0 — 2026-05-08

**Headline:** Brief → Blueprint, then refine.

- **Architect Wave 34 Phase 2 — real LLM-powered brief→blueprint generation** (`crates/aeqi-architect/src/llm.rs` + `crates/aeqi-orchestrator/src/ipc/architect.rs`): replaces the Phase-1 hard-coded foundation stub with a real LLM call via `aeqi-inference`. New `LlmCaller` trait with two production impls — `InferenceRouter` (DeepInfra path when `DEEPINFRA_API_KEY` is set) and `OpenRouterLlm` (when `OPENROUTER_API_KEY` is set, the actual shipped key on platform host). The model picks the on-chain template (foundation/entity/venture/fund), populates name/tagline/ideas/seed_roles/seed_agents from the brief, and emits canonical Blueprint JSON the existing provisioner consumes unchanged. Tolerant parser handles code fences, prose surrounds, wrapper envelope vs bare blueprint, and back-fills missing arrays from stub defaults. IPC handler tries LLM first; on `LlmFailure` falls back to stub so the user always sees a draft. Provenance reads `llm · phase-2` on success, `stub · phase-1` on fallback. 12 new unit tests. `b4ff9eaf`.
- **Architect Wave 35 — multi-turn refinement on /studio** (`apps/ui/src/pages/StudioPage.tsx` + `crates/aeqi-architect/src/lib.rs`): replaces the Phase-1 stub `refine` with a real multi-turn LLM call. UI ferries the full conversation history (every prior brief+draft pair) on each refinement; orchestrator stays stateless. Architect crate's `refine_via_llm` + `build_refine_messages` thread prior turns through the same system prompt so the model edits its own canonical output shape rather than re-deriving the schema. StudioPage rebuilds as a chat column once the first draft lands: founder-message + blueprint card per turn, refinement composer at the bottom, `Deploy this` only on the latest card. No draft persistence yet — refresh resets (Phase 4). `86bd87f8`.
- **Architect IPC timeout bumped to 60s for LLM-fronting verbs** (`crates/aeqi-web/src/ipc.rs` + `routes/architect.rs` + `routes/helpers.rs`): the default 10s `IpcClient` timeout was too aggressive for `architect.draft` and `architect.refine` (5-30s upstream LLM latency); the proxy errored every draft with `IPC request timed out after 10s` before the model could respond. Adds `request_with_timeout` / `cmd_with_timeout` / `ipc_proxy_with_timeout`; architect verbs request a 60s ceiling, all other verbs continue to use the default. `ea567148`.
- **`OPENROUTER_API_KEY` resolved from credentials substrate when env-var absent** (`crates/aeqi-orchestrator/src/ipc/architect.rs`): per-tenant runtime host services don't load `/etc/aeqi/secrets.env` (only `aeqi-platform.service` does), so the env var `build_default_llm()` looks for was never set on the runtime side — the IPC handler always fell through to the stub in production. Mirrors what `aeqi-core`'s config-parser does for OpenRouter: when both LLM env vars are empty, decrypt the global legacy blob from `~/.aeqi/aeqi.db`'s credentials table via the existing `CredentialCipher` and populate the env var in-process. Idempotent. Wired on both `draft` (`d7a2ba11`) and `refine` (`713b1fde`) paths.

## v0.43.0 — 2026-05-08

**Headline:** Quests get a due date, Ideas get tables, Companies go public.

- **Linear-Quests Phase 2 — `due_at` + `D` shortcut + DueDatePopover + Due column + overdue chip** (`apps/ui/src/pages/quest/QuestDetailPage.tsx` + `QuestsPage.tsx` + `crates/aeqi-orchestrator/src/quests/`): quests now carry an optional `due_at` timestamp. `D` keyboard shortcut on the Quest detail page opens the DueDatePopover (Today / Tomorrow / Next week / pick a date). The Quests list view gains a `Due` column; rows past due render an `overdue` chip in the danger tint. Phase 1 of Linear-Quests shipped the detail page in v0.41.0; Phase 2 closes the loop on time-bounded execution. `422491d6`.
- **BlockNote tables in Ideas** (`apps/ui/src/components/editor/BlockEditor.tsx`): the BlockNote default schema includes the table block — enabling it is one config flag plus design-token border styling for grid lines. Slash-menu hint added so the affordance is discoverable. Ideas now compose like a Notion doc with structured data inline. `087953d0`, `2058ec50`.
- **Public Company profile at `/<slug>`** (`apps/ui/src/pages/PublicCompanyPage.tsx` + `crates/aeqi-web/src/handlers/public.rs`): read-only EntityHeroStrip + public roles + public ideas rendered at the bare `/<slug>` route — no auth required. The `public` toggle on the EntityHeroStrip (shipped v0.42.0) flips the Company between private and link-shareable. Pairs with platform `90e26c6` (`GET /api/public/entities/<slug>` public-read endpoint). First step of the public-app-surfaces plan. `b974b220`.
- **EntityHeroStrip renders on `/c/<id>/` again** (`apps/ui/src/pages/company/CompanyOverviewPage.tsx`): the `isDrilledAgent` intercept added during the agent rail unification was over-broad — it suppressed the hero strip on the canonical `/c/<id>/` Company Overview route too. Dropped the intercept; the strip is back where it belongs. Notes captured in CLAUDE.md on isDrilledAgent semantic drift + grep-before-fix-string-asserts so the next pass doesn't repeat the call. `315aab64`, `2211857f`.

## v0.42.0 — 2026-05-08

**Headline:** Agents touch the world — Architect spawns Companies from a brief, W33B wires real cross-Company role grants on-chain, Drive read+write completes the OAuth loop.

- **Architect — Wave 34 Phase 1** (`crates/aeqi-architect` + `apps/ui/src/pages/StudioPage.tsx`): new crate scaffold + brief→blueprint IPC + `/studio` page with LLM stub. The natural-language org-design front door starts here — type a brief, get a stack blueprint, spawn the Company. First wedge of the architect-agent vision (`architecture_architect_agent_vision.md`); Phases 2-6 follow in Waves 31-35. `eae10243`.
- **Google Drive pack — `drive.list_files` + `drive.read_file` + `drive.create_doc`** (`crates/aeqi-pack-google-workspace`): three new agent tools — list files (filtered + paginated), read file content, create new Google Doc. Closes the OAuth loop shipped v0.40.0: Connect Google → agent now reads and writes Drive in addition to Gmail/Calendar. Companion platform commit (`010ca2b`) adds Drive scopes to the agent OAuth Path B authorize URL. `2063fbd6`.
- **Company Settings tab killed; EntityHeroStrip on Overview** (`apps/ui/src/pages/company/EntityHeroStrip.tsx` + tab refactor): the Company rail loses its Settings tab; identity edits (name, tagline, public toggle, plan link) are now click-to-edit affordances on the Overview hero strip. Settings was a dead seventh tab — name/plan changes belong on the page that shows them. Companion platform commit (`32e8edf`) adds `tagline` + `public` columns + `PUT /api/entities/{id}` handler. `a57f97d3`.
- **react-vendor chunk split — 1.44MB → 232KB raw / 74KB gz (-83%)** (`apps/ui/vite.config.ts`): the manual `react-vendor` chunk regex was over-broad — anything mentioning React anywhere in its dependency graph (editor stack, wallet stack, BlockNote, viem) was being absorbed into one mega-bundle. Anchored the match to `/node_modules/react/` proper so editor + wallet stacks ship in their own lazy chunks. First-paint payload drops accordingly. `35a1bc6f`.
- **Bare-/ post-login lands on /me/inbox; inbox probe cached per deploy-hash** (`apps/ui/src/pages/Index.tsx` + bootstrapper): authed visitors hitting bare `/` now redirect to `/me/inbox`, with the inbox probe outcome cached in localStorage keyed on the deploy-hash so we don't re-fire it on every navigation. The "first 90 seconds after sign-in" path stays clean across SPA navigations. `d76bf43a`.
- **Dead-code drop — `invoke_pattern` + legacy event columns** (`crates/aeqi-orchestrator/src/events/`): retired the pre-tool-calls invocation surface (`invoke_pattern`) and the legacy event columns it depended on. Tool-calls unification (`architecture_tool_calls_unification.md`) shipped 2026-04-19 made these dead; this release drops them from the schema. `755bc84e`.

## v0.41.0 — 2026-05-08

**Headline:** Co-creation surface lands — BlockNote ideas, Slack-shaped channels, Linear-shaped quests, agent personality tab, inference spend visibility, and a UX P0 sweep.

- **BlockNote editor primitive** (`apps/ui/src/components/editor/BlockEditor.tsx`): reusable Notion-style block editor — slash menu, drag handles, inline markdown — wired into the Ideas surface as the canonical write affordance. First Notion-Ideas Phase 1 ship; the editor itself is a primitive, not Idea-specific, and gets reused by the Personality tab. `e68a682d`.
- **Slack-shaped channels surface** (`apps/ui/src/pages/Channels*` + session primitive wiring): list, detail, composer, send/receive — all over the existing Session primitive, no new transport. `@`-mentions in in-app channels now trigger agent spawn (closes the loop: type at the agent in a channel → it picks up the turn). `c86529f9`, `26c79d7c`.
- **Linear-shaped Quest detail page** with S/P/A keyboard shortcuts (Status / Priority / Assignee). Quest now wraps an Idea body so the Quest description is a first-class block document, not a flat text field. Phase 1 of Linear-Quests. `dac5d449`.
- **Personality tab on agent rail** (`apps/ui/src/pages/agent/PersonalityTab.tsx`): block editor binds to a `personality:<agent_id>` Idea; `system_prompt` field sunset on the agent shape. The agent's character is now editable and queryable like any other Idea — same affordances, same inbox, same tags. Memory `feedback_no_prompt_vocabulary.md` made canonical at the data layer, not just in copy. `85cbf0a9`.
- **Per-agent inference accounting** wired at the `agent-completed` emission point in `crates/aeqi-orchestrator`: every LLM call records prompt/completion tokens + USD cost against the agent. Surfaced as a "Lifetime Spend" stat + recent-calls table on the Agent Treasury tab and a "Spend" column on the agents list. The dollar cost of an agent is now visible at the row level, not buried in upstream provider logs. `d4ebfcbe`, `bcc4281e`.
- **UX P0 hotfix bundle** (`01aae710`, `59df8009`): drop double `/api` prefix that was 404'ing the JWT-mint path; fix Personal Entity rendering (was crashing on null `roles[]`); console-clean sweep across the app shell; post-login lands on `/me/inbox` instead of root; inbox dismiss-probe 400 fixed; `/c/<personal>/` resilient to 502s during host respawn. The "first 90 seconds after sign-in" path is clean again.
- **Inbox round-trip + proactive multi-agent greeting** (`05656f8a`): user-reply round-trip now fires correctly through the agent-bound DM session pattern (`create_session` + `add_session_participant`, not `find_or_create_dm_session` which leaves `agent_id` NULL); a freshly-blueprinted Company auto-seeds a greeting from each bound agent on first inbox load. New companies feel populated immediately instead of empty.
- **Routing fix on event + idea row clicks** (`88b77492`): list-row click handlers now navigate to the detail page instead of no-op'ing on stopPropagation collisions with the row's hover-+ button.

## v0.40.0 — 2026-05-07

**Headline:** AEIQ Executive Assistant goes live — Telegram bot answering, mention-gate live, Google OAuth Path B end-to-end, session-streaming P0 fix.

- **Session-streaming P0+P1 fix** (`crates/aeqi-orchestrator/src/ipc/session_stream.rs` + `apps/ui/src/components/session/useSessionManager.ts`): the daemon's `session_subscribe` was short-circuiting subscribes-before-executor with a synthetic `Complete{no_active_run:true}` — UI's "subscribe-then-send" pattern guaranteed the race. WS tore down before any real events fired; refresh worked because messages persist to DB. Removed the `is_active` early-return; subscribers now wait on `rx.recv()` regardless of executor state. Plus polling no longer repaints messages mid-turn (gates on `streamingSessions[id]`), eliminating duplicate thinking-bar trails. `7aae78c7`.
- **Per-agent Google OAuth Path B** — three commits across three repos shipping the canonical agent-scoped Google integration:
  - `aeqi 5c2900ee` — `credentials_ingest` IPC verb + `POST /api/integrations/credentials/ingest` HTTP endpoint. The persist side: takes plaintext OAuth tokens from the platform, writes them encrypted into the per-tenant credentials substrate scoped `(scope_kind=Agent, scope_id=<agent_id>, provider="google", name="oauth_token")`. The same key the existing `aeqi-pack-google-workspace` reads.
  - `aeqi-platform 0b5676e` — `GET /api/agents/{id}/integrations/google/start` (mints HMAC-signed state token, builds Google authorize URL with offline access + force consent), wired callback exchange (decodes state, POSTs to `https://oauth2.googleapis.com/token`, calls `credentials_ingest` over IPC), and `/api/agents/{id}/integrations/google/status` for UI to render Connect/Connected toggle. Caught and fixed a bug in the original 501 stub: callback was registered behind auth (would have 401'd Google's redirect); now public-routed.
  - `aeqi/apps/ui f64c7b77` — `Connect Google` button on agent settings. Calls `/start`, redirects via `window.location.href`, refetches status on `?connected=google` return.
  - **Activation:** paste `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AEQI_OAUTH_STATE_SECRET=$(openssl rand -hex 32)` into `/etc/aeqi/secrets.env`; restart `aeqi-platform.service`. Routes flip from 503 setup-required to live. Pattern memorialized in `architecture_agent_scoped_oauth_path_b.md`.

## v0.39.0 — 2026-05-07

**Headline:** Telegram mention-gate + meeting-orchestration tools (`calendar.find_busy` / `calendar.propose_slots`) + æqi → æiq brand rebrand + role-tile shape semantics.

- **Telegram mention-gate** (`crates/aeqi-gates/src/telegram.rs`): in groups, only `@<bot>` mentions trigger an agent execution turn — DMs always act, non-mention group messages are silently skipped at the channel layer (no eye-react, no typing indicator, no orchestrator dispatch). Resolves the bot's identity at start via `getMe`; degrades open if that call fails. Founder use case: `@aeiq_ea_bot organize a meeting` in a CEO+COO+CTO group should fire only when tagged, never on background traffic. `3116ab38`.
- **`calendar.find_busy` + `calendar.propose_slots` tools** (`crates/aeqi-pack-google-workspace/`): the two missing pieces of a meeting-orchestration flow on top of the existing Gmail/Calendar pack. `find_busy` queries Google's `/freeBusy` endpoint for any list of calendar IDs and returns busy intervals + per-email errors. `propose_slots` is a pure-Rust intersection helper — given the busy map, a duration, working hours/days, and a target timezone, it returns up to N candidate slots that fit. Together they unblock `@ea organize a meeting with the three of us`. `14f92fda`.
- **Role tile shape by occupant kind** (`apps/ui/src/components/roles/RoleNode.tsx`): humans render with a circular avatar (Google profile photo, conventional crop), agents render as a square block (matches BlockAvatar fallback and the AgentAvatar primitive's `borderRadius: 4` elsewhere). Per founder: "humans are round, agents are the other shape." Stops the chart and list views from looking like every node is the same kind of entity. `26d10ae9`.
- **æqi → æiq wordmark + tab title rebrand** (`apps/ui/src/components/Wordmark.tsx`, document.title across page components): the in-product wordmark in the top-left of `AppLayout` and every browser tab title flipped from `æqi` to `æiq` to match the company brand. Storybook docs and CSS comments left alone for a follow-up sweep — those aren't user-facing. `26d10ae9`.
- **Role-tile BlockAvatar fallback** (`apps/ui/src/components/roles/RoleNode.tsx`): when an agent occupant has no profile image (and previously fell back to text initials), the role tile now renders the deterministic identicon used on the Agents page — visually consistent across the two routes. `bb884448`.
- **AgentAvatar onError fallback** (`apps/ui/src/components/AgentAvatar.tsx`): `<img onError>` flips to BlockAvatar instead of showing a broken image icon. Caught broken `/avatars/tech-lead.svg` URL on the EA agent during AEIQ dogfood. `096ed5d4`.
- **Blueprint brand-naming fix** (`presets/blueprints/aeiq-company.json`): the seed ideas baked into the AEIQ blueprint had the company/product naming inverted (canonical idea read "aeiq = the product, AEIQ Inc. = the company" — backwards). This was making the EA agent talk about itself as "aeqi". Bulk-swept `AEIQ` → `aeiq`, fixed the dual-aeqi line in mission. The live AEIQ tenant DB ideas were also corrected orchestrator-direct. `f0816872`.

## v0.38.0 — 2026-05-07

**Headline:** Quiet Director apex + chart drag/text-selection fix + AA-stack smoke test CLI.

- **Quiet Director apex (chart):** dropped the tinted board zone, the band-divider, and the "Director" eyebrow caps per founder direction ("casual hierarchy feeling, not overwhelming top-down"). The Director seat now renders as a calm peer at the apex — same node size, same edges, no zone tint. Honest about hierarchy (Director is at the top of governance), quiet about presentation. `b8d1a518`.
- **Chart drag fix:** `e.preventDefault()` in the canvas pointerdown handler + `user-select: none` on the viewport CSS. Stops the canvas pan gesture from accidentally triggering text selection (which then broke subsequent pan attempts). Founder report: "drag and drop on the canvas bugs sometimes it randomly selects some text and then I can't drag and drop anymore." `b8d1a518`.
- **AA smoke CLI:** `cargo run -p aeqi-paymaster --bin aa-smoke --release` exercises the full ERC-4337 path end-to-end (deploys SimpleAccount + Paymaster, submits no-op UserOp, polls for receipt). Exit 0 = stack healthy. `SMOKE_JSON=1` for structured output. Diagnostic / monitoring foundation. `f75674d5`.

**Architecture notes:** Memory `architecture_board_vs_org_chart.md` is canonical — board (Director tier) is governance, NOT in the operational reporting chain. The chart now reflects this without imposing a heavy visual hierarchy.

**Known limitations / next:** AEIQ Company now has 4 advisor agents (Legal, AI, Blockchain, SaaS) bound as `role_type='advisor'`. They render as a parallel bottom row in the chart per the existing layout. CEO seat now occupied by Luca (human) — "human-CEO with agent reports" pattern locked. Telegram bot for cofounder group still pending founder BOT_TOKEN.

## v0.37.0 — 2026-05-07

**Headline:** Real avatars + cleaner chart edges + board-org tinted band + cross-tab indented tree.

- **Avatars:** Roles + Agents views now render real avatars where they exist. Director seat (Luca) shows the Google profile photo; CEO Assistant shows its `/avatars/tech-lead.svg`. Other agents fall back to colored circles with initials (CTO Asst blue, COO Asst green) or neutral graphite for unset. Platform proxy enriches `/api/roles` with `occupant_avatar_url`; UI consumes via `AgentAvatar`.
- **Chart edges:** stroke 1px → 1.5px; color stepped from `--border` (rgba(0,0,0,0.06)) to `--color-text-secondary` (rgba(10,10,11,0.65)). Edges now read at default zoom on dense subtrees.
- **Board / Org separation:** chart canvas tints the Director seat zone with a subtle band + divider. The list view populates a "Reports to {parent.title}" column for non-root roles via cross-type role_edges resolution.
- **Indented tree (both lists):** Roles + Agents list views switched from section-header grouping to a single linear pre-order traversal with `padding-left: depth * 24px`. Same hierarchy as the chart, vertical-list ergonomics. CTO at depth 1, Backend Engineer at depth 2, Backend Intern at depth 3.

**Architecture notes:** Chart layout = Reingold-Tilford tidy-tree (`layoutChart`); both list views = pre-order DAG traversal + indent. `layoutDepts` removed entirely (memory `architecture_role_primitive.md` is canonical; no painted dept envelopes anywhere).

**UX score:** 5.0/5 maintained on full walk. All 9 chart/list/avatar ships verified.

**Known limitations / next:** `?view=list` query param dropped during 308 redirect from `/c/<id>` to `/trust/<address>` (cosmetic). VPS dogfood respawn pending founder approval. W33B stack-blueprint cross-Company on-chain edge wiring still in flight.

## v0.36.0 — 2026-05-07

**Headline:** Reingold-Tilford tidy-tree org chart + /me primitives polish + UX micro-pass.

- **Org chart layout:** Sugiyama-lite layered DAG → Reingold-Tilford tidy-tree. Each subtree gets a horizontal slot proportional to its width. Verified: Backend Engineer (with Intern child) renders at 488px subtree width vs Frontend Engineer (leaf) at 220px; Intern centered 0px offset under BE. V_GAP raised to 120, H_GAP to 48 — generous vertical breathing between layers.
- **/me primitives audit batch:** Loading-state gates on AgentIdeasTab/EventsTab/QuestsTab (no more empty-state flash during cold load); Events sidebar gets the missing hover-+ rowAction; "system-prompt moment" copy removed (memory `feedback_no_prompt_vocabulary.md`); `--text-title` undefined token renamed; Quests empty-state CTA uses canonical Button component.
- **UI polish micro-pass:** hover affordances added where they were missing; v3 `--space-{xs,sm,md,lg,xl}` token aliases were silently zeroing spacing on Governance + Treasury — bridged in `primitives.css`; empty states warmer; no-op hovers eliminated; remaining hairline traces cleaned.

**Architecture notes:** UX 5.0/5 maintained on full walk. The tidy-tree layout handles arbitrary depth (verified 3-level CEO → CTO → BE → Intern).

**Known limitations / next:** Bundle size manualChunks for cache-friendly chunking still deferred (P2). VPS dogfood respawn pending founder approval. W33B stack-blueprint cross-Company on-chain edge wiring still in flight.

## v0.35.0 — 2026-05-06

**Headline:** Org chart pure nested tree + agent-spawn data integrity (no duplicate roles, no phantom entities).

- **Org chart:** removed painted department-cluster envelopes per founder direction. Roles + Agents charts now render as a single layered DAG via `layoutChart` (Sugiyama-lite, arbitrary depth). Backend Intern under Backend Engineer under CTO renders as a clean 3-level tree, no misleading "CTO group" boxes. List-view department grouping unchanged (founder explicitly approved that).
- **Spawn integrity:** `POST /api/agents/spawn` no longer creates a phantom Company entity when `entity_id` is already known. `spawn_with_entity_id` pre-checks entity existence; HTTP handler accepts `entity_id` in the request body. The signup flow that mints a personal Company per new user is unchanged (entity_id absent → still mint).
- **Role uniqueness:** `POST /api/roles` now upserts when a role for the same `(entity_id, occupant_id)` already exists. Spawning an agent then assigning a role no longer leaves a duplicate orphan role row in the table.
- **A11y:** SignupPage gets the skip-to-main-content link (LoginPage shipped earlier in v0.34.0).
- **Docs:** `aeqi-sandbox-*` deploy gap documented — sandboxes need explicit `systemctl restart` after Rust deploys (the script only restarts host-placement services).

**Architecture notes:** All spawn/role bugs trace back to the org-chart redesign exposing pre-existing data shapes. The fixes harden the runtime contract: 1 entity → many agents → 1 role per agent → DAG via role_edges.

**Known limitations / next:** AEIQ test data still has Backend Intern at depth 3 (test artefact, harmless). W33B stack-blueprint cross-Company on-chain edge wiring still in flight. Wave 34/35 (Architect meta-agent + /studio chat UI) deferred.

## v0.34.0 — 2026-05-06

**Headline:** Org chart departmental clustering + agents list grouped by team + 144kB gzip perf win.

- **Roles chart:** department clusters render each C-suite + reports as a discrete unit. CEO apex carries visual weight. Drag/zoom/pan stable (race condition in `setTransform` updater closure resolved — captures `dragRef.current` snapshot to a local before queueing state update).
- **Agents:** list view groups agents by parent role (Engineering / Marketing / Operations / C-suite); chart view mirrors roles-chart cluster envelopes. Synthetic "Companies-as-agents" rows from `/api/entities` removed (legacy holdover from the SUPERSEDED 2026-04-29 agent-Company unification).
- **Perf:** lazy-load `WagmiProvider` + `RainbowKitProvider` + 11 AgentPage tabs. Main chunk 1342kB → 838kB raw (−37%), gzip 402kB → 258kB (−144kB / −36%). `QueryClientProvider` stays at root (react-query is used app-wide, not just in wagmi).
- **Auth pages:** `LoginPage` (both render branches) gets the skip-to-main link as the first focusable element.
- **Org chart:** `data-testid="org-chart"` on the SVG root for stable test selectors.
- **AEIQ dogfood:** runtime data cleaned (entity name was mis-labeled "CEO Assistant"; CFO/CMO/CLO/CISO each got provisioned as separate phantom Companies). Now: 1 entity (AEIQ), 12 agents under it. 5 team agents added (Backend/Frontend Engineer under CTO, Content Writer/Growth Analyst under CMO, Operations Coordinator under COO).

**Architecture notes:** `architecture_role_primitive.md` is canonical; `architecture_agent_company_unification.md` is SUPERSEDED — Company is not an agent.

**UX score:** post-fixes walk averages 5.0/5 across 5 routes (corrected for known walk-script regex false negatives).

**Known limitations / next:** SignupPage skip-link still missing (P2). W33B stack-blueprint cross-Company on-chain edge wiring still in flight. v0.34.0 ships UI only; aeqi-platform + aeqi-landing have no new commits since v0.33.0.

## v0.33.0 — 2026-05-06

**Headline:** Org chart zoom + 1,035 v3→v4 token migrations + treasury native ETH + a11y P0/P1 batch.

- **Roles:** org chart now supports zoom, pan, and auto-fits container width on mount + resize (founder ask)
- **Roles + Ownership:** human occupants render display name ("Luca Eich") instead of raw wallet address — platform proxies inject `occupant_name` into `/api/roles` responses (`6a4f6a3` in aeqi-platform)
- **Treasury:** shows native ETH balance via wagmi `useBalance` + new `/chain/rpc` browser proxy; chain label honors `VITE_CHAIN_NAME` instead of hardcoded "Base Sepolia" (`42f613b` in aeqi-platform)
- **Inbox:** "Open inbox" agent-overview link now navigates to `/me/inbox` (was `/`); pane borders replaced with tint shifts; loading state gates empty-state copy
- **Design system:** 1,035 v3 token aliases swept to v4 canonical names across 45 files in `apps/ui` (`--text-{primary/secondary/muted}` → `--color-text-*`, `--text-{xs/sm/...}` → `--font-size-*`, broken patterns now documented)
- **A11y:** skip-to-main-content link, sidebar nav `:focus-visible` ring, `aria-label` on icon-only toolbar buttons, invalid roles removed from buttons, `prefers-reduced-motion` guards on pulse animations
- **Drive:** 3 hairline borders removed from DrivePage; replaced with tint/spacing per locked no-hairlines rule
- **UX-batch-A:** Company rail tab order corrected to spec (Roles → Ownership → Treasury → Governance); Stripe vendor name removed from Treasury + Governance copy; `/me/portfolio` → `/me/treasury` redirect
- **AA polish:** paymaster `/stats` endpoint exposing per-Company sponsorship visibility; bundler systemd hardening (Restart, MemoryMax, log rotation)
- **Roles:** invitation-not-sent badge + "Send invite" affordance on detail page

**Architecture notes:** Board vs org-chart correction landed earlier in v0.32.0 ship cycle (memory `architecture_board_vs_org_chart.md`). AEIQ dogfood Company stable on production with corrected role types.

**UX score:** baseline 3.25/5 → post-fixes 4.5/5 (delta walk verified, 6 routes).

**Known limitations / next:** Wallet Phase 3 (multi-signer rotation UI) deferred to Wave 29+. W33B stack-blueprint cross-Company on-chain edge wiring still in flight.

## v0.32.0 — 2026-05-06

**Headline:** aeiq dogfood company live + role invitation polish + Treasury/Governance empty-state cleanup.

- Blueprint for AEIQ's own dogfood company (`aeiq-company`) shipped and deployed; entity_id `59bc9fd3-956a-4104-aaf8-83253fde840c` provisioned on production
- Roles tab: invite-not-sent status badge + "Send invite" affordance for roles where `email_sent=false` (Wave 32 role invitation UX, see `architecture_role_primitive.md`)
- Treasury and Governance tabs: polished empty states for fresh TRUSTs that have no on-chain activity yet — replaces raw empty lists with context-appropriate messaging
- Telegram bot setup guide added to integrations docs
- Evolve: test-copy coupling pattern documented (empty-state polish cost captured)

**Architecture notes:** `architecture_role_primitive.md` — Role invitation `skip_email` / `email_sent` column is in aeqi-platform; this commit wires the UI indicator to that field.

**Known limitations / next:** Board vs org-chart correction (CFO/CMO/CLO/CISO as operational, not director) not yet reflected in default blueprint seed roles. Mass test-company cleanup complete (obs: `aeiq-rebuild-2026-05-06.md`).

## v0.31.0 — 2026-05-05

**Headline:** Stack wizard UI shipped. Multi-Company orchestration now has a frontend.

- StackBlueprint TypeScript discriminator type
- StackWizard component: rename → review → spawn → progress → success
- BlueprintsPage 4th section for stack templates
- BlueprintDetailPage handles stack vs single

## v0.30.0 — 2026-05-05

**Headline:** Blueprint taxonomy reformed (3 categories) + workspace billing pivot + stack blueprint foundation.

- aeqi-platform: Blueprint Category enum (Company/Foundation/Fund) with separate template field; stack blueprint schema with topo-sort + provision_stack; workspace billing gate (10-Company cap)
- aeqi: category-grouped BlueprintsPage with inclusion lists; pricing.ts pivots to $49/mo per workspace
- aeqi-landing: FAQ updated to workspace billing
- 2 example stacks shipped: founder-plus-spinout, vc-fund-with-3-portfolios
- On-chain edge wiring stubbed (status="skipped"), real wiring in Wave 33

## v0.29.0 — 2026-05-05

**Headline:** Polish wave — design token normalization + Quickstart Deploy TRUST guide.

- aeqi: 11 hardcoded fontSize/padding values normalized to tokens (Wave 29 P2 fixes)
- aeqi-docs: Quickstart "Deploy your first TRUST" guide
- ROUTE-AUDIT-V5 confirmed clean — no regressions on color/border/button-variant; design system 85%/95%/95% compliance

## v0.28.0 — 2026-05-05

**Headline:** Real hairlines fix — borders replaced with spacing and tint, not box-shadow swap.

- Hairlines pass-3 (4d8808fd) was cosmetic swap caught by UX-V13
- Real fix shipped (d3fc9745): drop decorative 1px borders, use --space-\* spacing and tint shifts (--color-card vs --color-bg-base) per memory feedback_no_hairlines.md
- Form input borders preserved (semantic, focus indicator)
- UX-V13 walk script extended detector (border + box-shadow inset)

## v0.27.0 — 2026-05-05

**Headline:** Trust routing complete (server + client + direct paths). Stale copy stripped.

- aeqi: client-side trust redirect (useEffect on /c/<id> when trust_address arrives)
- aeqi: removed "10% off" stale waitlist copy from signup page
- aeqi: UX-V12 walk script + observations (score 9.6 held)
- aeqi-landing: removed "free to start" stale phrase from SEO meta
- trustsCount=14 (real wizard flow)

## v0.26.0 — 2026-05-05

**Headline:** TRUST is the canonical primitive. /trust/<address> routing live. Config drift from pre-refactor port corrected.

- aeqi-platform: 301 redirect from /c/:entityId/_ to /trust/:trustAddress/_ when on-chain
- aeqi-platform: venture module stub correctness (abi_encode_params + slot keys + uint16 unifutures)
- aeqi-platform: registerTRUST gas limit 20M→28M for venture template
- aeqi (UI): /trust/:trustAddress route group, useCurrentCompany hook, wizard polls trust_address
- aeqi-core: 4 P1 drift bugs corrected — entity/fund token names "aeqi Entity"/"aeqi Fund", venture executionDelay 3600, fund governance director-only restored
- RefreshTemplates.s.sol re-registers venture+fund on live anvil
- trustsCount=13 from real wizard flow (5 → 13)

## v0.25.0 — 2026-05-05

**Headline:** Bridge fully proven end-to-end through wizard. trustsCount 5 → 8+.

- aeqi-platform: abi_encode_params() for role trust config (was abi_encode wrapping in extra outer tuple, breaking Role module decode)
- aeqi-platform: stub configs for Uniswap + UniFutures modules on plain anvil (no fork required)
- deploy.sh: UI skip optimization on pure-Rust deploys (FORCE_UI=1 to override)
- Bridge verify confirmed: human-in-loop wizard flow creates on-chain TRUSTs successfully

## v0.24.0 — 2026-05-05

**Headline:** P0 wizard fix — Uniswap module impl registered on factory; on-chain Company spawn now works end-to-end via UI wizard.

- aeqi: wizard post-create redirect now uses /c/<id>/overview + refetches entities
- UX rating v10: 9.5/10 (up from 9.3)
- Bridge wizard verify: UI/API layer confirmed end-to-end via Playwright smoke test
- Walk-detector improvements: P0 triage traps documented, wallet probe 400-state handling, cp-to-main footgun prevention

## v0.23.0 — 2026-05-05

**Headline:** UX 9.3 (from 9.1) — Director list-view name, treasury URL detection, landing nav lowercase.

- Director list/cards view: UUID → display name (was only fixed in detail view in v0.22)
- /me/treasury copy: URL-based personal detection (entity.type wasn't reliable)
- aeqi-landing: hardcoded React nav title "AEQI Entity & AA" → "aeqi Entity & AA"
- Walk-detector improvements: body-text scan pattern documented

## v0.22.0 — 2026-05-05

**Headline:** UX score 9.0 — Director name resolution, hairline cleanup, personal treasury vocab.

- Director role occupant: UUID → display name resolved
- Hairlines second pass on 5 surfaces (economy, blueprints-store, components)
- Personal /me/treasury copy: "account" replaces "Company"
- aeqi-docs nav: lowercase entity name
- Playwright UX rating v7 — 9.0/10 (up from 8.8)

## v0.21.0 — 2026-05-05

**Headline:** AA stack proven end-to-end + wallet Phase 2 UI ready + design hygiene Wave 20.

- End-to-end AA proof: deploy → fund Paymaster → submit UserOp via rundler bundler → 184k gas measured
- Wallet Phase 2 UI: Settings now has "Upgrade to passkey" affordance (WebAuthn frontend)
- Indexer vote tallies: forVotes/againstVotes on Proposal type
- Hairlines sweep: 261 → 124 (-52%)
- Governance copy fixes + Director "Unoccupied" fallback
- aeqi/AEQI casing cleanup across templates + docs
- aeqi-docs: wallet-migration guide

## v0.20.0 — 2026-05-05

**Headline:** Wave 16-19 follow-through — Stripe redirect on company create, plan name binding, indexer governance reads, AA migration tool, design token sweeps.

- Stripe checkout redirect on 402 (company create)
- CompanyPlanCard displayName binding
- Pill button cascade + inline 999px strip
- Governance schema align (proposalsForTrust + votingPower live)
- aeqi-paymaster migrate-to-passkey CLI
- WS-1 marginTop + WS-2 fontSize token sweep
- Schema.org pricing $49 single plan
- Inference API public docs page

## v0.19.0 — 2026-05-05

**Headline:** Full on-chain Company mirror (Treasury · Ownership · Governance) + AA stack online (rundler bundler + ERC-7677 paymaster).

**Ships across all three repos:**

- **aeqi**: Treasury, Ownership, Governance tabs read indexed on-chain state; aeqi-inference Phase 1 (DeepInfra provider behind subscription auth); aeqi-paymaster ERC-7677 pm_sponsorUserOperation service; rundler bundler service deployed + smoke tested; 9 Wave-16 design fixes (pill radius, padding tokens, button variants, jade badges, AEQI lowercase, avatar color, plan name UUID, sidebar leak, spacing/typo)
- **aeqi-platform**: WS-5 inference mount (/v1/\* behind subscription lane); docs for cross-repo path dep targeting + vps.rs forwarder evolve
- **aeqi-docs**: AA design memos; API REST reference; inference API page; transaction-governance guide; index polish surfacing AA + canonical-templates

No migration required. On-chain indexing surfaces read-only mirrors of treasury/ownership/governance state via existing Platform APIs.

## v0.18.0 — 2026-05-04

**Headline:** Mainnet-deployable TRUST contract (size audit) + token system audit.

- **aeqi-core**: TRUST.sol contract size optimized to 24435 bytes (under EIP-170 24576 limit) by dropping BitFlagGuard inheritance — mainnet deployment now feasible.
- **aeqi**: Design-system token literal hex fallbacks stripped (11 instances, audit P1) — routing verified, no functional change.
- **aeqi-docs**: IPFS content-addressing reference page — CID encoding/decoding patterns for on-chain and off-chain usage.
- **aeqi-platform**: vps.rs X-Forwarded-For carve-out documented + direct-edit-main recovery pattern.

No migration required. All changes are cleanups and documentation.

### Changed

- Token system audited and literal hex values removed from build artifacts.
- TRUST contract bytecode optimized for EIP-170 compliance.

### Documentation

- IPFS content-addressing patterns documented in aeqi-docs.
