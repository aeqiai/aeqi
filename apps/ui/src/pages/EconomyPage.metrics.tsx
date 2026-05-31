import { MetricCard, MetricGrid } from "@/components/ui";
import type { Company } from "@/lib/types";
import type { CapTableSeedRow } from "./EconomyPage.capTable";
import { MetricStatus, type RoleOpeningRow } from "./EconomyPage.parts";

export function EconomyMetricGrid({
  allRoleCount,
  capTableRows,
  entities,
  entitiesLoading,
  hasSearch,
  liquiditySeedGapCount,
  onChainCompanies,
  publicCompanies,
  roleOpenings,
  visibleCapTableRows,
  visibleRoleOpenings,
  visibleCompanies,
}: {
  allRoleCount: number;
  capTableRows: CapTableSeedRow[];
  entities: Company[];
  entitiesLoading: boolean;
  hasSearch: boolean;
  liquiditySeedGapCount: number;
  onChainCompanies: Company[];
  publicCompanies: Company[];
  roleOpenings: RoleOpeningRow[];
  visibleCapTableRows: CapTableSeedRow[];
  visibleRoleOpenings: RoleOpeningRow[];
  visibleCompanies: Company[];
}) {
  return (
    <MetricGrid columns={4}>
      <MetricCard
        label="Visible Companies"
        value={entitiesLoading ? "-" : entities.length}
        detail={
          hasSearch ? (
            <MetricStatus
              state={visibleCompanies.length > 0 ? "in_progress" : "backlog"}
              label={`${visibleCompanies.length} matching`}
            />
          ) : publicCompanies.length > 0 ? (
            <MetricStatus state="done" label={`${publicCompanies.length} public`} />
          ) : (
            <MetricStatus state="backlog" label="No public companies" />
          )
        }
      />
      <MetricCard
        label="COMPANY IDs"
        value={onChainCompanies.length}
        detail={
          onChainCompanies.length > 0 ? (
            <MetricStatus state="done" label="On-chain identity" />
          ) : (
            <MetricStatus state="backlog" label="No COMPANY address" />
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
