# Phase 2 unification readiness — 2026-04-28

## Summary

10 bespoke landing components audited. 6 ready for direct adoption with zero primitive changes. 3 require modest primitive extensions. 1 warrants a new primitive (Accordion).

**Migration effort: M–L.** Token parity is complete; component adoption is blocked on 3 API gaps in the canonical library and one new primitive. All extensions are single-responsibility and follow existing patterns.

---

## Per-component audit

### 1. Hero CTA (`App.tsx:78–90`)

**Canonical match:** Button  
**Current shape:** Rounded-full accent button with right-arrow chevron that animates on hover. Custom shadow + hover lift.

**Shape gap:** Button supports `variant` (primary/secondary/ghost/danger), `size` (sm/md/lg), and `loading` state, but:

- No trailing-icon slot (arrow chevron lives in the label with margin + transform)
- No explicit "marketing" size for large hero CTAs (currently inline-flex with px-9 py-4)
- Shadow and hover-lift animations are bespoke (not exposed as primitive affordances)

**Recommended extension:**

- Add `trailingIcon?: ReactNode` prop to Button
- Add `size: "xl"` variant for marketing surfaces (hero, footer CTAs)
- Accept that shadow + animation stay bespoke; Button's focus should be affordance identity (primary for main CTA), not visual polish

**Migration LoC estimate:** S  
**Blockers:** None. Can migrate once Button accepts `trailingIcon`.

---

### 2. Footer Explore Button (`Footer.tsx:57–68`)

**Canonical match:** Button  
**Current shape:** White button on accent bg (inverted from hero). Same trailing-arrow chevron.

**Shape gap:** Same as Hero CTA — needs `trailingIcon` and size consistency. Button currently has no "inverted" or "light" mode for contrast against dark bg.

**Recommended extension:**

- Button needs `variant: "light"` (white text, white border, white hover) for dark bg contexts
- Same `trailingIcon` prop as above
- Keep shadow/animation bespoke

**Migration LoC estimate:** S  
**Blockers:** Button extension for `trailingIcon` and light-mode variant.

---

### 3. Nav Sign in / Start Pill (`Nav.tsx:78–96`)

**Canonical match:** Button  
**Current shape:** Two compact buttons: "Sign in" (text-only) and "Start a company" (accent rounded-full pill).

**Shape gap:** Both use compact sizing (text-[13px], px-5 h-[36px]). Canonical Button's "sm" may be close, but the exact dimensions and padding strategy differ. No gaps in functionality — purely a sizing/scale question.

**Recommended extension:**

- Verify Button `size: "sm"` matches landing's compact dims (px-5 h-[36px], text-[13px])
- If dims don't match, add a `size: "nav"` variant to Button for compact header contexts
- Button already supports ghost + primary variants needed here

**Migration LoC estimate:** S  
**Blockers:** None if Button's "sm" fits; minor if a "nav" size is needed.

---

### 4. Nav Center Links (`Nav.tsx:64–74`)

**Canonical match:** Custom link + underline effect (no direct primitive)  
**Current shape:** Text links ("Economy", "Blueprints", "Docs") with animated underline on hover (before-pseudo, scaleX transform). Periodical design convention.

**Shape gap:** This is a design pattern (link + hover reveal), not a component need. No canonical primitive for "periodical-style link with animated underline."

**Recommended extension:**

- Create a new `NavLink` component in `apps/ui` that wraps `<a>` or `<Link>` and applies the underline pattern
- Or accept that this is editorial polish specific to marketing and keep it bespoke (justified — it's brand identity, not a UI control)
- No extension to Button/Link needed

**Migration LoC estimate:** S (if creating NavLink) or 0 (if keeping bespoke)  
**Blockers:** Design decision: is this a shipping pattern or marketing-only polish?

---

### 5. GitHubButton (`GitHubButton.tsx`)

**Canonical match:** IconButton (for the icon part) or a specialized component  
**Current shape:** GitHub octocat icon + optional star count pill. Border + hover border-color shift. Fetches live star count client-side.

**Shape gap:**

- Not a simple icon button — it's a compound (icon + count cell with divider)
- The star reveal threshold (STAR_REVEAL_AT=100) is app-specific logic, not a primitive concern
- Live data fetching is bespoke

**Recommended extension:**

- This warrants its own primitive: `GitHubButton` in `apps/ui` (branded, not generic)
- Or consume IconButton for the icon part and compose the count cell + fetching logic on top
- Don't try to bend Button/IconButton into this shape

**Migration LoC estimate:** S (copy GitHubButton as-is to apps/ui) or M (refactor as IconButton + cell)  
**Blockers:** Decision: is GitHubButton a primitive (reusable across products) or a landing-specific component?

---

### 6. FAQAccordion (`FAQ.tsx:148–189`)

**Canonical match:** None (no accordion primitive yet)  
**Current shape:** Stateful button + toggle chevron + collapsible answer. Smooth open/close. Link to "more" deep-dive optional.

**Shape gap:** This is a distinct compound component, not an extension to Button/Menu/Popover. Accordions are a recognized UI pattern with their own affordances (keyboard nav via arrow keys, focus management, ARIA roles).

**Recommended extension:**

- Create new `Accordion` primitive in `apps/ui`
- API: `<Accordion><Accordion.Item question="..." answer="..." more={{label, path}} /></Accordion>`
- Or simpler: `<AccordionItem question="" answer="" open={} onToggle={() => {}} />`
- Pattern already exists in landing; no bikeshedding needed

**Migration LoC estimate:** M  
**Blockers:** New primitive must be built before migration. Estimated effort: 2–3h (component + stories + focus mgmt).

---

### 7. CookieConsent Banner (`CookieConsent.tsx`)

**Canonical match:** Modal (or a specialized Toast/Banner primitive)  
**Current shape:** Fixed bottom-left dialog with motion. Two buttons ("Essential only", "Accept all"). Listens to custom event to re-show.

**Shape gap:**

- Not a modal (fixed position, not centered portal)
- Not a tooltip (persistent, interactive buttons)
- Semantically a "toast" or "banner" — adjacent surface, not full-screen dialog
- Motion and positioning are bespoke

**Recommended extension:**

- Create a new `Toast` or `Banner` primitive for bottom-fixed notifications
- Or accept that cookie consent is a one-off; keep it bespoke (low reuse, high specificity)
- Buttons inside can consume Button primitive once `trailingIcon` is added (currently no icons)

**Migration LoC estimate:** S (keep bespoke) or M (new Toast primitive)  
**Blockers:** Design decision: is a Toast/Banner pattern worth a primitive, or is consent banner unique enough to stay isolated?

---

### 8. Mobile Menu (`Nav.tsx:143–197`)

**Canonical match:** Menu or Popover (partially), plus custom animation  
**Current shape:** Animated popover with list of links. Escape key closes. AnimatePresence wrapper.

**Shape gap:**

- Canonical Menu is item-driven (array of MenuItem objects with icons, destructive flags, etc.)
- Mobile menu is link-driven and simpler (static list of `<a>` elements)
- Menu doesn't export trigger-agnostic open/close; it owns the trigger button
- Popover is more flexible but requires manual trigger wiring

**Recommended extension:**

- Mobile menu is close to a Popover use case; could migrate to Popover with a custom content layout
- Or extend Menu to support "link-mode" in addition to "action-mode" (low priority; mostly a semantics question)
- No essential gaps — this works today with custom code

**Migration LoC estimate:** M (refactor to use Popover) or keep bespoke  
**Blockers:** None. Low-value migration; keep as-is unless Popover improves readability.

---

### 9. Blog Post Card (`BlogIndex.tsx:84–99`)

**Canonical match:** Card (with interactive mode)  
**Current shape:** Link wrapping a card-like block. Hover changes title color (text-accent). No explicit Card component, just semantic HTML + class styling.

**Shape gap:**

- Uses Card-like visual (padding, spacing, divider) but not the Card primitive
- Hover affordance is modest (title color shift only, no lift/shadow)
- Ready for direct adoption: import Card, wrap the content, set `interactive={true}`

**Recommended extension:** None needed. Just use the Card primitive.

**Migration LoC estimate:** S  
**Blockers:** None.

---

### 10. Pricing Plan Cards (`Enterprise.tsx:85–173`)

**Canonical match:** Card  
**Current shape:** Grid of plan cards with:

- Title, description, price
- Feature list (mixed checkmarks + "+" highlights)
- CTA button (variant changes per plan)
- "Recommended" badge on pro plan

**Shape gap:**

- Canonical Card is simple (bg, padding, optional interactive mode)
- Pricing cards have nested complexity (header, feature list, footer CTA, overlaid badge)
- This is more a "page layout" pattern than a primitive extension
- Ready for Card adoption: wrap the top-level grid items in Card components

**Recommended extension:** None. Compose with Card as the outer container; keep feature list and badge as internal layout.

**Migration LoC estimate:** S  
**Blockers:** None.

---

## Migration roadmap

### Phase 1 (Unblock others) — 2–3 days

1. Extend Button: add `trailingIcon` prop, `size: "xl"` variant, `variant: "light"`
2. Create Accordion primitive (component + stories + tests)

### Phase 2 (Direct adoption) — 1 day

1. Blog post cards → use Card primitive
2. Pricing cards → wrap with Card primitive
3. Mobile menu → optional refactor to Popover (low priority)

### Phase 3 (New patterns) — TBD by design

1. NavLink (periodical-style animated underline) — decision needed
2. Toast/Banner primitive — if cookie consent is the only use, keep bespoke; if a pattern emerges, build it

### Phase 4 (Specialized components) — 1–2 days

1. GitHubButton — copy to apps/ui as-is, or refactor to IconButton + cell (decision needed)

---

## Acceptance criteria

- [ ] Button accepts `trailingIcon` and renders alongside children
- [ ] Button supports `size: "xl"` and `variant: "light"`
- [ ] Accordion primitive ships with `<Accordion.Item question="" answer="" />` API
- [ ] Blog index uses Card primitive for post list
- [ ] Pricing page uses Card primitive for plan containers
- [ ] All 10 landing components mapped to primitives or justified as bespoke
- [ ] Zero dead code in landing after migration (remove bespoke button/card classes)
- [ ] Token sync (sync-tokens.mjs) remains green

---

## Honest assessment

**What migrates cleanly:** Blog cards, pricing cards, nav sign-in button, hero/footer CTA buttons (once Button extends).

**What needs modest work:** Accordion (new primitive, ~3h), Button extensions (2–3h), GitHubButton (decision-dependent, S–M effort).

**What stays bespoke:** Mobile menu (optional — could use Popover but not urgent), nav center links (editorial polish, not a control), cookie banner (specialized context, rare reuse).

**Risk:** The biggest risk is scope creep on "should this be a primitive?" — NavLink, Toast, and GitHubButton are edge cases. Recommend shipping Phase 1 + Phase 2 first, then gathering real usage patterns before deciding.

**Timeline:** Phase 1 + 2 realistic in 1 sprint (5–7d). Phase 3/4 can follow if usage justifies it.
