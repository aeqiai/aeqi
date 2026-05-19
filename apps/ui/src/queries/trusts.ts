import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import * as trustsApi from "@/api/trusts";
import type { Trust } from "@/lib/types";
import { trustKeys } from "./keys";

const EMPTY_TRUSTS: Trust[] = [];

export function useTrustsQuery() {
  return useQuery({
    queryKey: trustKeys.all,
    queryFn: trustsApi.listTrustRoots,
    staleTime: 30_000,
  });
}

export function useTrusts() {
  return useTrustsQuery().data ?? EMPTY_TRUSTS;
}

export function useActiveTrust(activeTrustId: string | null | undefined) {
  const trusts = useTrusts();
  return useMemo(
    () => trusts.find((trust) => trust.id === activeTrustId) ?? null,
    [activeTrustId, trusts],
  );
}
