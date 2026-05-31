import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import type { Company } from "@/lib/types";

/**
 * Resolves the active COMPANY from the current route.
 *
 * The canonical route shape is `/company/:companyAddress/...`.
 * Returns null when the param is absent (non-company routes) or when
 * the COMPANY cannot be found in the local store.
 */
export function useCurrentCompany(): {
  entity: Company | null;
  /** The COMPANY id, regardless of which route shape matched. */
  companyId: string;
} {
  const { companyAddress } = useParams<{ companyAddress?: string }>();
  const entities = useDaemonStore((s) => s.entities);

  const entity = useMemo<Company | null>(() => {
    if (!companyAddress) return null;
    // Match by `company_address` first (canonical post-bridge slug),
    // then fall back to entity.id so unbridged / stranded placements
    // (no on-chain COMPANY yet) and any URL that was minted from
    // `entity.id` rather than the chain address still resolve. The
    // pre-fix lookup was company_address-only, which made every
    // null-company_address row in the switcher silently bounce to "/"
    // via AppLayout's `!entityKnown` redirect.
    return (
      entities.find((e) => e.company_address === companyAddress) ??
      entities.find((e) => e.id === companyAddress) ??
      null
    );
  }, [companyAddress, entities]);

  return {
    entity,
    companyId: entity?.id ?? "",
  };
}
