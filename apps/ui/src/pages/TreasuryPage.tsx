import EmptyState from "@/components/EmptyState";

export default function TreasuryPage() {
  return (
    <div className="page-content">
      <EmptyState
        title="Treasury"
        description="Track transactions, balances, and financial activity across your agents."
      />
    </div>
  );
}
