import EmptyState from "@/components/EmptyState";

export default function MarketPage() {
  return (
    <div className="page-content">
      <EmptyState
        title="Market"
        description="Browse and discover agents, templates, and extensions from the AEQI marketplace."
      />
    </div>
  );
}
