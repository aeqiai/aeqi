/**
 * `useRuntimeStatus` — read the platform's view of a TRUST's runtime
 * attachment. Powers the runtime-gated tabs (Agents / Quests / Ideas /
 * Events / Sessions) and the Overview "Add runtime" affordance.
 *
 * Backed by `GET /api/runtime/status?trust_id=<id>` in
 * `aeqi-platform/src/routes/runtime.rs`. `trust_id` is the platform-side
 * entity uuid (`Trust.id` on the frontend), NOT the on-chain
 * `trust_address` — the platform DB indexes placements by entity id.
 *
 * The 30s staleTime matches the cadence at which a placement changes
 * (manual operator action: provision, upgrade, suspend). React Query
 * dedupes parallel calls so wrapping multiple gated surfaces with this
 * hook is cheap.
 */
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { normalizeLaunchPlanId } from "@/lib/pricing";

const STALE_TIME_MS = 30_000;

/**
 * Normalized runtime plan. We map the platform's free-form Stripe-stamped
 * label (`"standard" | "pro" | "company" | …`) onto the canonical
 * runtime labels so callers don't have to keep the legacy strings in mind.
 */
export type RuntimePlan = "standard" | "pro" | "sandbox";

export interface RuntimeBudget {
  periodStart: string;
  limitCents: number;
  usedCents: number;
  remainingCents: number;
}

export interface UseRuntimeStatusResult {
  hasRuntime: boolean;
  plan: RuntimePlan | null;
  budget: RuntimeBudget | null;
  hostActive: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Resolve a TRUST's runtime attachment.
 *
 * Pass the platform-side entity uuid (`Trust.id`). When `trustId` is
 * null/empty the query stays disabled — used by callsites that mount
 * before an entity is selected (LeftSidebar with no `trustId`).
 */
export function useRuntimeStatus(trustId: string | null | undefined): UseRuntimeStatusResult {
  const enabled = !!trustId;

  const query = useQuery({
    queryKey: ["runtime", "status", trustId ?? null],
    queryFn: () => api.getRuntimeStatus(trustId as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const data = query.data;
  // Map the wire plan label (`"standard"` / `"pro"` / `"company"` /
  // `"launch"` / …) onto the canonical pricing plan id. Mirrors the
  // legacy-name normalization in pricing.ts so a placement still on
  // `"company"` displays as Standard.
  const rawPlan = data?.plan?.toLowerCase();
  const plan: RuntimePlan | null = rawPlan
    ? rawPlan === "sandbox"
      ? "sandbox"
      : normalizeLaunchPlanId(rawPlan) === "growth"
        ? "pro"
        : "standard"
    : null;
  const budget = data?.budget
    ? {
        periodStart: data.budget.period_start,
        limitCents: data.budget.limit_cents,
        usedCents: data.budget.used_cents,
        remainingCents: data.budget.remaining_cents,
      }
    : null;

  return {
    hasRuntime: !!data?.has_runtime,
    plan,
    budget,
    hostActive: !!data?.host_active,
    isLoading: enabled && query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
