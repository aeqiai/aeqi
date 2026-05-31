import { useEffect, useState } from "react";

import {
  fetchRolesForCompany,
  fetchRoleRequestsForCompany,
  indexerEnabled,
  type CompanyRole,
  type CompanyRoleRequest,
} from "@/lib/indexer";

export interface OwnershipState {
  roles: CompanyRole[];
  pending: CompanyRoleRequest[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches on-chain role assignments for a COMPANY from the indexer.
 *
 * Queries `rolesForCompany(companyId)` and `roleRequestsForCompany(companyId)`.
 * Both queries degrade gracefully to `[]` when the indexer field is not yet
 * shipped — the hook never throws on missing schema fields.
 *
 * Returns empty state when:
 * - `companyId` is falsy (entity has no on-chain COMPANY yet).
 * - The indexer is not configured (`VITE_INDEXER_URL` unset / empty).
 */
export function useOwnership(companyId: string | undefined | null): OwnershipState {
  const [roles, setRoles] = useState<CompanyRole[]>([]);
  const [pending, setPending] = useState<CompanyRoleRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId || !indexerEnabled()) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [r, req] = await Promise.all([
          fetchRolesForCompany(companyId),
          fetchRoleRequestsForCompany(companyId),
        ]);
        if (!cancelled) {
          setRoles(r);
          setPending(req.filter((rr) => !rr.accepted));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return { roles, pending, loading, error };
}
