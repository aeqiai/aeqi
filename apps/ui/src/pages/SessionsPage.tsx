import EmptyState from "@/components/EmptyState";

export default function SessionsPage() {
  return (
    <div className="page-content">
      <EmptyState
        title="Sessions"
        description="View agent session transcripts and chat history. Split-pane view coming soon."
      />
    </div>
  );
}
