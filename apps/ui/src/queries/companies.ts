import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import * as companiesApi from "@/api/companies";
import type { Company } from "@/lib/types";
import { trustKeys } from "./keys";

const EMPTY_COMPANIES: Company[] = [];

export function useCompaniesQuery() {
  return useQuery({
    queryKey: trustKeys.all,
    queryFn: companiesApi.listCompanyRoots,
    staleTime: 30_000,
  });
}

export function useCompanies() {
  return useCompaniesQuery().data ?? EMPTY_COMPANIES;
}

export function useActiveCompany(activeCompanyId: string | null | undefined) {
  const companies = useCompanies();
  return useMemo(
    () => companies.find((company) => company.id === activeCompanyId) ?? null,
    [activeCompanyId, companies],
  );
}
