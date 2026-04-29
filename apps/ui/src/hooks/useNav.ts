import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useMemo } from "react";

/**
 * Navigate within the current company scope.
 *
 * Canonical company URLs live at `/c/:entityId/...`. `go()` / `href()` stay
 * within the current entity's URL scope; `goEntity()` / `entityPath()` target
 * a specific entity by id.
 */
export function useNav() {
  const navigate = useNavigate();
  const { entityId } = useParams<{ entityId: string }>();
  const base = useMemo(() => (entityId ? `/c/${encodeURIComponent(entityId)}` : ""), [entityId]);

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
   * Absolute path for a company surface. Every entity gets
   * `/c/:entityId[/:tab[/:itemId]]`.
   */
  const entityPath = useCallback((id: string, tab?: string, itemId?: string) => {
    let p = `/c/${encodeURIComponent(id)}`;
    if (tab) p += `/${tab}`;
    if (itemId) p += `/${itemId}`;
    return p;
  }, []);

  const goEntity = useCallback(
    (
      id: string,
      tab?: string,
      itemId?: string,
      options?: { replace?: boolean; search?: Record<string, string> },
    ) => {
      let path = entityPath(id, tab, itemId);
      if (options?.search) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(options.search)) {
          if (v !== undefined && v !== "") params.set(k, v);
        }
        const qs = params.toString();
        if (qs) path += `?${qs}`;
      }
      navigate(path, { replace: options?.replace });
    },
    [navigate, entityPath],
  );

  return { go, href, entityPath, goEntity, entityId: entityId || "", base };
}
