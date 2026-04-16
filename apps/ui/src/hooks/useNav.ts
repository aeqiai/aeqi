import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useMemo } from "react";

/**
 * Navigate within the current root agent scope.
 * Replaces hardcoded navigate("/agents/...") with go("/agents/...").
 */
export function useNav() {
  const navigate = useNavigate();
  const { root } = useParams<{ root: string }>();
  const base = useMemo(() => (root ? `/${encodeURIComponent(root)}` : ""), [root]);

  const go = useCallback(
    (path: string, options?: { replace?: boolean }) => {
      const full = path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
      navigate(full, options);
    },
    [navigate, base],
  );

  const href = useCallback(
    (path: string) => {
      return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
    },
    [base],
  );

  /**
   * Build the path for an agent view. The root agent collapses to top-level
   * routes (`/sessions/:id`), children nest under `/agents/:id/...`.
   */
  const agentPath = useCallback(
    (agentId: string, tab?: string, itemId?: string) => {
      const isRoot = agentId === root;
      let p = isRoot ? "" : `/agents/${agentId}`;
      if (tab) p += `/${tab}`;
      if (itemId) p += `/${itemId}`;
      return p || "/";
    },
    [root],
  );

  return { go, href, agentPath, root: root || "", base };
}
