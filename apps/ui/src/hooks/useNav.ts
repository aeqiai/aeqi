import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { useDaemonStore } from "@/store/daemon";
import { entityBasePath, entityPath as makeEntityPath } from "@/lib/entityPath";

/**
 * Navigate within the current company scope.
 *
 * Supports the canonical trust route plus the id-based fallback route.
 * `go()` / `href()` stay within the current entity's URL scope;
 * `goEntity()` / `entityPath()` target a specific entity by id and
 * resolve to the trust route when available.
 */
export function useNav() {
  const navigate = useNavigate();
  const { entityId, trustAddress } = useParams<{ entityId?: string; trustAddress?: string }>();
  const entities = useDaemonStore((s) => s.entities);

  // Resolve the base path for the current route's entity. Trust-backed
  // entities use the trust route; otherwise fall back to the id route.
  const base = useMemo(() => {
    if (trustAddress) {
      return `/trust/${trustAddress}`;
    }
    if (!entityId) return "";
    const entity = entities.find((e) => e.id === entityId);
    return entity ? entityBasePath(entity) : `/c/${encodeURIComponent(entityId)}`;
  }, [trustAddress, entityId, entities]);

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
   * Absolute path for a company surface. Resolves to the trust route when
   * the entity has a trust_address, otherwise falls back to the id route.
   */
  const entityPath = useCallback(
    (id: string, tab?: string, itemId?: string) => {
      const entity = entities.find((e) => e.id === id);
      const parts = [tab, itemId].filter(Boolean) as string[];
      return entity
        ? makeEntityPath(entity, ...parts)
        : [`/c/${encodeURIComponent(id)}`, ...parts].join("/");
    },
    [entities],
  );

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

  // Resolve a stable `entityId` regardless of which route shape is active.
  // On the trust route `useParams.entityId` is undefined, so fall back to
  // the entity matching `trustAddress` and keep nested navigation stable.
  const trustEntityId = useMemo(() => {
    if (entityId) return entityId;
    if (!trustAddress) return "";
    return entities.find((e) => e.trust_address === trustAddress)?.id ?? "";
  }, [entityId, trustAddress, entities]);

  return { go, href, entityPath, goEntity, entityId: trustEntityId, base };
}
