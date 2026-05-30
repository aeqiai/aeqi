import { useEffect } from "react";
import {
  SESSIONS_VIEW_PARAM,
  sessionsViewFromSearch,
  USER_SESSIONS_VIEW_ID,
  USER_SESSIONS_VIEW_LABEL,
} from "@/lib/sessionViews";
import type { PinnedView, SavePinnedViewInput } from "@/store/ui";

export const PINNED_USER_SESSIONS_STORAGE_KEY = "aeqi_sidebar_pinned_my_sessions";
const USER_SESSIONS_PINNED_SEARCH = `?${SESSIONS_VIEW_PARAM}=${USER_SESSIONS_VIEW_ID}`;

export function isUserSessionsPinnedViewForPath(view: PinnedView, path: string): boolean {
  return (
    !!path && view.path === path && sessionsViewFromSearch(view.search) === USER_SESSIONS_VIEW_ID
  );
}

export function useSeedUserSessionsPinnedView({
  trustId,
  userSessionsPinnedPath,
  pinnedViews,
  savePinnedView,
}: {
  trustId: string | null;
  userSessionsPinnedPath: string;
  pinnedViews: PinnedView[];
  savePinnedView: (input: SavePinnedViewInput) => PinnedView;
}) {
  const hasPinnedUserSessionsView =
    !!trustId &&
    pinnedViews.some(
      (view) =>
        view.trustId === trustId && isUserSessionsPinnedViewForPath(view, userSessionsPinnedPath),
    );

  useEffect(() => {
    if (!trustId || !userSessionsPinnedPath) return;
    if (
      typeof window !== "undefined" &&
      window.localStorage.getItem(PINNED_USER_SESSIONS_STORAGE_KEY) === "false"
    ) {
      return;
    }
    if (hasPinnedUserSessionsView) return;

    savePinnedView({
      label: USER_SESSIONS_VIEW_LABEL,
      path: userSessionsPinnedPath,
      search: USER_SESSIONS_PINNED_SEARCH,
      trustId,
    });
  }, [trustId, userSessionsPinnedPath, hasPinnedUserSessionsView, savePinnedView]);
}
