import EmptyState from "@/components/EmptyState";

export default function DrivePage() {
  return (
    <div className="page-content">
      <EmptyState
        title="Drive"
        description="Upload, organize, and manage files shared across your agents."
      />
    </div>
  );
}
