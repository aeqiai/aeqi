import { useEffect } from "react";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * `/me/quests` — quests assigned to you across every company you
 * own. Stub today; the real query joins `quests.assignee = "user:<id>"`
 * across the user's entities. Lands when the assignee picker writes
 * user-as-assignee in earnest (today most quests are agent-owned).
 */
export default function MeQuestsPage() {
  useEffect(() => {
    document.title = "my quests · æqi";
  }, []);

  return (
    <div className="me-stub">
      <header className="me-stub-header">
        <h1 className="me-stub-heading">My quests</h1>
        <p className="me-stub-sub">Quests assigned to you across every company.</p>
      </header>
      <EmptyState
        title="Nothing assigned to you yet."
        description="Quests assigned via the assignee picker will appear here. Until then, every company's quests live on its Quests tab."
      />
    </div>
  );
}
