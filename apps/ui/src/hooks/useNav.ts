import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { useDaemonStore } from "@/store/daemon";
import { entityBasePath, entityPath as makeEntityPath } from "@/lib/entityPath";

/**
 * Navigate within the current organization scope.
 *
 * `go()` / `href()` stay within the current entity's URL scope;
 * `goEntity()` / `entityPath()` target a specific entity by id and
 * resolve to the company route when available.
 */
export function useNav() {
  const navigate = useNavigate();
  const { companyId, companyAddress } = useParams<{
    companyId?: string;
    companyAddress?: string;
  }>();
  const entities = useDaemonStore((s) => s.entities);

  // Resolve the base path for the current route's entity. Company-backed
  // entities use the company route; missing company is treated as not yet
  // launched.
  const base = useMemo(() => {
    if (companyAddress) {
      return `/company/${companyAddress}`;
    }
    if (!companyId) return "";
    const entity = entities.find((e) => e.id === companyId);
    return entity ? entityBasePath(entity) : "/launch";
  }, [companyAddress, companyId, entities]);

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

  /** Absolute path for an organization surface. Resolves to the company route. */
  const entityPath = useCallback(
    (id: string, tab?: string, itemId?: string) => {
      const parts = [tab, itemId].filter(Boolean) as string[];
      const append = (routeBase: string) =>
        parts.length > 0 ? `${routeBase}/${parts.join("/")}` : routeBase;
      if (!id) return base ? append(base) : "/launch";
      const entity = entities.find((e) => e.id === id || e.company_address === id);
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

  // Resolve a stable `companyId` regardless of which route shape is active.
  // On the company route `useParams.companyId` is undefined, so fall back to
  // the entity matching `companyAddress` and keep nested navigation stable.
  const trustEntityId = useMemo(() => {
    if (companyId) return companyId;
    if (!companyAddress) return "";
    return (
      entities.find((e) => e.company_address === companyAddress)?.id ??
      entities.find((e) => e.id === companyAddress)?.id ??
      ""
    );
  }, [companyId, companyAddress, entities]);

  return { go, href, entityPath, goEntity, companyId: trustEntityId, base };
}
