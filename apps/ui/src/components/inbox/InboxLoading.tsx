/**
 * Three-row skeleton for the inbox first paint. Uses the existing
 * `cam-skeleton-shine` keyframe so the shimmer rhythm matches the rest
 * of the app. Renders only when `lastFetchedAt === null` to avoid a
 * flash of empty-state on a slow network for users who actually have
 * pending items.
 */
export default function InboxLoading() {
  return (
    <div className="inbox-skeleton" aria-hidden="true">
      <div className="inbox-skeleton-row" />
      <div className="inbox-skeleton-row" />
      <div className="inbox-skeleton-row" />
    </div>
  );
}
