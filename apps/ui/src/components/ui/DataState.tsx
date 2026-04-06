import EmptyState from "@/components/EmptyState";

interface DataStateProps {
  loading: boolean;
  empty: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  loadingText?: string;
  children: React.ReactNode;
}

export default function DataState({
  loading,
  empty,
  emptyTitle = "Nothing here",
  emptyDescription = "",
  loadingText = "Loading...",
  children,
}: DataStateProps) {
  if (loading) return <div className="loading">{loadingText}</div>;
  if (empty) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return <>{children}</>;
}
