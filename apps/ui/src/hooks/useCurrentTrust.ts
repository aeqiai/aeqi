import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import type { Trust } from "@/lib/types";

/**
 * Resolves the active TRUST from the current route.
 *
 * The canonical route shape is `/trust/:trustAddress/...`.
 * Returns null when the param is absent (non-trust routes) or when
 * the TRUST cannot be found in the local store.
 */
export function useCurrentTrust(): {
  entity: Trust | null;
  /** The TRUST id, regardless of which route shape matched. */
  trustId: string;
} {
  const { trustAddress } = useParams<{ trustAddress?: string }>();
  const entities = useDaemonStore((s) => s.entities);

  const entity = useMemo<Trust | null>(() => {
    if (!trustAddress) return null;
    // Match by `trust_address` first (canonical post-bridge slug),
    // then fall back to entity.id so unbridged / stranded placements
    // (no on-chain TRUST yet) and any URL that was minted from
    // `entity.id` rather than the chain address still resolve. The
    // pre-fix lookup was trust_address-only, which made every
    // null-trust_address row in the switcher silently bounce to "/"
    // via AppLayout's `!entityKnown` redirect.
    return (
      entities.find((e) => e.trust_address === trustAddress) ??
      entities.find((e) => e.id === trustAddress) ??
      null
    );
  }, [trustAddress, entities]);

  return {
    entity,
    trustId: entity?.id ?? "",
  };
}
