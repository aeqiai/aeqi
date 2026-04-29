import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import * as entitiesApi from "@/api/entities";
import type { Entity } from "@/lib/types";
import { entityKeys } from "./keys";

const EMPTY_ENTITIES: Entity[] = [];

export function useEntitiesQuery() {
  return useQuery({
    queryKey: entityKeys.all,
    queryFn: entitiesApi.listEntityRoots,
    staleTime: 30_000,
  });
}

export function useEntities() {
  return useEntitiesQuery().data ?? EMPTY_ENTITIES;
}

export function useActiveEntity(activeEntityId: string | null | undefined) {
  const entities = useEntities();
  return useMemo(
    () => entities.find((entity) => entity.id === activeEntityId) ?? null,
    [activeEntityId, entities],
  );
}
