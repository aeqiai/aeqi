/**
 * `useIncorporation` — React Query wrapper around the server-side
 * Incorporation snapshot the surface (and the Overview cockpit rollup)
 * need: the Company account, the list of Module accounts hanging off it,
 * and the list of Role accounts on `aeqi_role`.
 *
 * The COMPANY PDA address (`company_address`) is the cache key for all three
 * query. A 30s staleTime matches the cadence at which these accounts
 * actually change (manual operator actions through aeqi-platform —
 * pause/unpause, adopt new module implementation, ACL edits, role
 * assign / resign) rather than the every-block churn of token balances.
 */
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";

import { api } from "@/lib/api";
import type { ModuleAccountWithPda, RoleAccountWithPda, CompanyAccount } from "@/solana";

const STALE_TIME_MS = 30_000;

export interface UseIncorporationResult {
  company: CompanyAccount | null | undefined;
  modules: ModuleAccountWithPda[] | undefined;
  roles: RoleAccountWithPda[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Resolve a COMPANY's on-chain Incorporation state.
 *
 * Pass the base58-encoded Company PDA (matches `entity.company_address` on
 * the platform-side Company record). When `companyAddress` is null/empty
 * the queries stay disabled — useful for the pre-bridge state where
 * the entity has no on-chain mirror yet.
 */
export function useIncorporation(
  companyAddress: string | null | undefined,
): UseIncorporationResult {
  const enabled = !!companyAddress;

  const snapshotQuery = useQuery({
    queryKey: ["incorporation", "snapshot", companyAddress ?? null],
    queryFn: async () =>
      decodeIncorporationSnapshot(
        await api.getCompanyIncorporationByAddress(companyAddress as string),
      ),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  return {
    company: snapshotQuery.data?.company,
    modules: snapshotQuery.data?.modules,
    roles: snapshotQuery.data?.roles,
    isLoading: enabled && snapshotQuery.isLoading,
    error: (snapshotQuery.error as Error | null) ?? null,
  };
}

type RawIncorporationSnapshot = Awaited<ReturnType<typeof api.getCompanyIncorporationByAddress>>;

function decodeIncorporationSnapshot(raw: RawIncorporationSnapshot): {
  company: CompanyAccount | null;
  modules: ModuleAccountWithPda[];
  roles: RoleAccountWithPda[];
} {
  return {
    company: raw.company
      ? ({
          companyId: raw.company.company_id,
          authority: new PublicKey(raw.company.authority),
          creationMode: raw.company.creation_mode,
          paused: raw.company.paused,
          moduleCount: raw.company.module_count,
          bump: raw.company.bump,
        } as CompanyAccount)
      : null,
    modules: raw.modules.map((m) => ({
      publicKey: new PublicKey(m.public_key),
      account: {
        company: new PublicKey(m.account.company),
        moduleId: m.account.module_id,
        programId: new PublicKey(m.account.program_id),
        provider: new PublicKey(m.account.provider),
        implementationVersion: BigInt(m.account.implementation_version),
        implementationMetadataHash: m.account.implementation_metadata_hash,
        trustAcl: BigInt(m.account.company_acl),
        initialized: m.account.initialized,
        bump: m.account.bump,
      },
    })) as ModuleAccountWithPda[],
    roles: raw.roles.map((r) => ({
      publicKey: new PublicKey(r.public_key),
      account: {
        company: new PublicKey(r.account.company),
        roleId: r.account.role_id,
        roleTypeId: r.account.role_type_id,
        account: new PublicKey(r.account.account),
        parentRoleId: r.account.parent_role_id,
        status: r.account.status,
        statusSince: BigInt(r.account.status_since),
        ipfsCid: r.account.ipfs_cid,
        bump: r.account.bump,
      },
    })) as RoleAccountWithPda[],
  };
}
