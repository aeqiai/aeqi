import { MetricCard, MetricGrid } from "@/components/ui";
import type { Trust } from "@/lib/types";
import type { CapTableSeedRow } from "./EconomyPage.capTable";
import { MetricStatus, type RoleOpeningRow } from "./EconomyPage.parts";

export function EconomyMetricGrid({
  allRoleCount,
  capTableRows,
  entities,
  entitiesLoading,
  hasSearch,
  liquiditySeedGapCount,
  onChainTrusts,
  publicTrusts,
  roleOpenings,
  visibleCapTableRows,
  visibleRoleOpenings,
  visibleTrusts,
}: {
  allRoleCount: number;
  capTableRows: CapTableSeedRow[];
  entities: Trust[];
  entitiesLoading: boolean;
  hasSearch: boolean;
  liquiditySeedGapCount: number;
  onChainTrusts: Trust[];
  publicTrusts: Trust[];
  roleOpenings: RoleOpeningRow[];
  visibleCapTableRows: CapTableSeedRow[];
  visibleRoleOpenings: RoleOpeningRow[];
  visibleTrusts: Trust[];
}) {
  return (
    <MetricGrid columns={4}>
      <MetricCard
        label="Visible Trusts"
        value={entitiesLoading ? "-" : entities.length}
        detail={
          hasSearch ? (
            <MetricStatus
              state={visibleTrusts.length > 0 ? "in_progress" : "backlog"}
              label={`${visibleTrusts.length} matching`}
            />
          ) : publicTrusts.length > 0 ? (
            <MetricStatus state="done" label={`${publicTrusts.length} public`} />
          ) : (
            <MetricStatus state="backlog" label="No public trusts" />
          )
        }
      />
      <MetricCard
        label="TRUST IDs"
        value={onChainTrusts.length}
        detail={
          onChainTrusts.length > 0 ? (
            <MetricStatus state="done" label="On-chain identity" />
          ) : (
            <MetricStatus state="backlog" label="No TRUST address" />
          )
        }
      />
      <MetricCard
        label="Cap-Table Seeds"
        value={capTableRows.length}
        detail={
          hasSearch ? (
            <MetricStatus
              state={visibleCapTableRows.length > 0 ? "in_progress" : "backlog"}
              label={`${visibleCapTableRows.length} matching`}
            />
          ) : capTableRows.length > 0 ? (
            <MetricStatus state="done" label="Orchestrator rows" />
          ) : liquiditySeedGapCount > 0 ? (
            <MetricStatus state="in_review" label={`${liquiditySeedGapCount} liquidity gaps`} />
          ) : (
            <MetricStatus state="backlog" label="No seed rows" />
          )
        }
      />
      <MetricCard
        label="Open Roles"
        value={roleOpenings.length}
        detail={
          hasSearch ? (
            <MetricStatus
              state={visibleRoleOpenings.length > 0 ? "in_progress" : "backlog"}
              label={`${visibleRoleOpenings.length} matching`}
            />
          ) : roleOpenings.length > 0 ? (
            <MetricStatus state="in_review" label={`${allRoleCount} total roles`} />
          ) : allRoleCount > 0 ? (
            <MetricStatus state="done" label="All roles filled" />
          ) : (
            <MetricStatus state="backlog" label="No roles indexed" />
          )
        }
      />
    </MetricGrid>
  );
}
