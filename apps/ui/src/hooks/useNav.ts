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

  return { go, href, root: root || "", base };
}
