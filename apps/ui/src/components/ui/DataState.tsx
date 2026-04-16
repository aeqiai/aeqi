import { Spinner } from "./Spinner";
import { EmptyState } from "./EmptyState";
import styles from "./DataState.module.css";

export interface DataStateProps {
  loading: boolean;
  empty: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  loadingText?: string;
  children: React.ReactNode;
}

export function DataState({
  loading,
  empty,
  emptyTitle = "Nothing here",
  emptyDescription = "",
  loadingText,
  children,
}: DataStateProps) {
  if (loading)
    return (
      <div className={styles.loading} role="status">
        <Spinner size="md" />
        {loadingText && <span className={styles.loadingText}>{loadingText}</span>}
      </div>
    );
  if (empty) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return <>{children}</>;
}

DataState.displayName = "DataState";
