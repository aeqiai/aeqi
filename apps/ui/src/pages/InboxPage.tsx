import { EmptyState } from "@/components/ui";

/**
 * User-scoped inbox — a single surface for everywhere an agent (from any
 * company) has proactively pinged the user. The backend trigger (agent
 * emits a user-directed event that lands here) is not yet wired, so the
 * page is intentionally a placeholder. Once the trigger lands, this
 * surface becomes the obvious place to resolve outstanding asks without
 * hunting through every agent's sessions rail.
 */
export default function InboxPage() {
  return (
    <div style={{ padding: "32px 28px", height: "100%", overflow: "auto" }}>
      <EmptyState
        eyebrow="Inbox"
        title="Nothing waiting for you"
        description="When an agent needs your input — a clarifying question, an approval, a status update — it will show up here. Coming soon."
      />
    </div>
  );
}
