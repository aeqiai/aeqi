import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useMemo } from "react";

/**
 * Navigate within the current agent scope.
 *
 * Version B (flat URLs): every agent — root or child — lives at
 * `/:agentId/...`. `go()` / `href()` stay within the current agent's URL
 * scope; `goAgent()` / `agentPath()` target a specific agent by id.
 */
export function useNav() {
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();
  const base = useMemo(() => (agentId ? `/${encodeURIComponent(agentId)}` : ""), [agentId]);

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
   * Absolute path for any agent view. Flat — every agent gets
   * `/:id[/:tab[/:itemId]]`, regardless of root/child status.
   */
  const agentPath = useCallback((id: string, tab?: string, itemId?: string) => {
    let p = `/${encodeURIComponent(id)}`;
    if (tab) p += `/${tab}`;
    if (itemId) p += `/${itemId}`;
    return p;
  }, []);

  const goAgent = useCallback(
    (id: string, tab?: string, itemId?: string, options?: { replace?: boolean }) => {
      navigate(agentPath(id, tab, itemId), options);
    },
    [navigate, agentPath],
  );

  return { go, href, agentPath, goAgent, agentId: agentId || "", base };
}
