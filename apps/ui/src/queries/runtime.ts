import { useQuery } from "@tanstack/react-query";
import * as runtimeApi from "@/api/runtime";
import { runtimeKeys } from "./keys";

export function useStatusQuery() {
  return useQuery({
    queryKey: runtimeKeys.status,
    queryFn: runtimeApi.getStatus,
    staleTime: 15_000,
  });
}

export function useDashboardQuery() {
  return useQuery({
    queryKey: runtimeKeys.dashboard,
    queryFn: runtimeApi.getDashboard,
    staleTime: 15_000,
  });
}

export function useCostQuery() {
  return useQuery({
    queryKey: runtimeKeys.cost,
    queryFn: runtimeApi.getCost,
    staleTime: 15_000,
  });
}
