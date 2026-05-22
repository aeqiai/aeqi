import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { useDaemonStore } from "@/store/daemon";
import { entityBasePath, entityPath as makeEntityPath } from "@/lib/entityPath";

/**
 * Navigate within the current organization scope.
 *
 * `go()` / `href()` stay within the current entity's URL scope;
 * `goEntity()` / `entityPath()` target a specific entity by id and
 * resolve to the trust route when available.
 */
export function useNav() {
  const navigate = useNavigate();
  const { trustId, trustAddress } = useParams<{ trustId?: string; trustAddress?: string }>();
  const entities = useDaemonStore((s) => s.entities);

  // Resolve the base path for the current route's entity. Trust-backed
  // entities use the trust route; missing trust is treated as not yet
  // launched.
  const base = useMemo(() => {
    if (trustAddress) {
      return `/trust/${trustAddress}`;
    }
    if (!trustId) return "";
    const entity = entities.find((e) => e.id === trustId);
    return entity ? entityBasePath(entity) : "/launch";
  }, [trustAddress, trustId, entities]);

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

  /** Absolute path for an organization surface. Resolves to the trust route. */
  const entityPath = useCallback(
    (id: string, tab?: string, itemId?: string) => {
      const parts = [tab, itemId].filter(Boolean) as string[];
      const append = (routeBase: string) =>
        parts.length > 0 ? `${routeBase}/${parts.join("/")}` : routeBase;
      if (!id) return base ? append(base) : "/launch";
      const entity = entities.find((e) => e.id === id || e.trust_address === id);
      return entity ? makeEntityPath(entity, ...parts) : makeEntityPath({ id }, ...parts);
    },
    [base, entities],
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

  // Resolve a stable `trustId` regardless of which route shape is active.
  // On the trust route `useParams.trustId` is undefined, so fall back to
  // the entity matching `trustAddress` and keep nested navigation stable.
  const trustEntityId = useMemo(() => {
    if (trustId) return trustId;
    if (!trustAddress) return "";
    return (
      entities.find((e) => e.trust_address === trustAddress)?.id ??
      entities.find((e) => e.id === trustAddress)?.id ??
      ""
    );
  }, [trustId, trustAddress, entities]);

  return { go, href, entityPath, goEntity, trustId: trustEntityId, base };
}
