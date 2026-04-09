import EmptyState from "@/components/EmptyState";

export default function CompanyPage() {
  return (
    <div className="page-content">
      <EmptyState
        title="Company"
        description="Manage your company profile, team members, and organization settings."
      />
    </div>
  );
}
