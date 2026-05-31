import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Role } from "@/lib/types";

type LaunchStatus = Awaited<ReturnType<typeof api.getLaunchStatus>>;
type CapTableStatus = Awaited<ReturnType<typeof api.getCapTable>>;

export interface RoleLoadState {
  roles: Role[];
  loading: boolean;
}

export interface LaunchLoadState {
  status: LaunchStatus | null;
  loading: boolean;
}

export interface CapTableLoadState {
  entries: CapTableStatus["entries"];
  loading: boolean;
}

export function useEconomyEntityData(entities: Array<{ id: string }>) {
  const [roleState, setRoleState] = useState<Record<string, RoleLoadState>>({});
  const [launchState, setLaunchState] = useState<Record<string, LaunchLoadState>>({});
  const [capTableState, setCapTableState] = useState<Record<string, CapTableLoadState>>({});
  const entityIdsKey = useMemo(
    () =>
      entities
        .map((entity) => entity.id)
        .filter(Boolean)
        .join("|"),
    [entities],
  );

  useEffect(() => {
    const entityIds = entityIdsKey ? entityIdsKey.split("|") : [];
    if (entityIds.length === 0) {
      setRoleState({});
      setLaunchState({});
      setCapTableState({});
      return;
    }

    let cancelled = false;
    setRoleState((current) => seedLoading(current, entityIds, { roles: [], loading: true }));
    setLaunchState((current) => seedLoading(current, entityIds, { status: null, loading: true }));
    setCapTableState((current) => seedLoading(current, entityIds, { entries: [], loading: true }));

    entityIds.forEach((entityId) => {
      void api
        .getRoles(entityId)
        .then((resp) => {
          if (!cancelled) {
            setRoleState((current) => ({
              ...current,
              [entityId]: { roles: resp.roles ?? [], loading: false },
            }));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRoleState((current) => ({
              ...current,
              [entityId]: { roles: [], loading: false },
            }));
          }
        });

      void api
        .getCapTable(entityId)
        .then((resp) => {
          if (!cancelled) {
            setCapTableState((current) => ({
              ...current,
              [entityId]: { entries: resp.entries ?? [], loading: false },
            }));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCapTableState((current) => ({
              ...current,
              [entityId]: { entries: [], loading: false },
            }));
          }
        });

      void api
        .getLaunchStatus(entityId)
        .then((status) => {
          if (!cancelled) {
            setLaunchState((current) => ({
              ...current,
              [entityId]: { status, loading: false },
            }));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLaunchState((current) => ({
              ...current,
              [entityId]: { status: null, loading: false },
            }));
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [entityIdsKey]);

  return { roleState, launchState, capTableState };
}

function seedLoading<T>(current: Record<string, T>, entityIds: string[], seed: T) {
  let changed = false;
  const next = { ...current };
  for (const entityId of entityIds) {
    if (!next[entityId]) {
      next[entityId] = seed;
      changed = true;
    }
  }
  return changed ? next : current;
}
