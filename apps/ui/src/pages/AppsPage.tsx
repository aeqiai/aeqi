import { EmptyState } from "@/components/ui";

export default function AppsPage() {
  return (
    <div className="page-content">
      <EmptyState
        title="Apps"
        description="Install and manage integrations and applications for your agents."
      />
    </div>
  );
}
