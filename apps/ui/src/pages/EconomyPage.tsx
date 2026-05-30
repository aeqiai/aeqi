import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Blocks, BriefcaseBusiness, Droplets, Search } from "lucide-react";
import PageRail from "@/components/PageRail";
import {
  Button,
  EmptyState,
  Input,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  PageToolbar,
  Table,
} from "@/components/ui";
import { api } from "@/lib/api";
import { entityBasePath, entityPath } from "@/lib/entityPath";
import type { Role, RoleType } from "@/lib/types";
import { useEntitiesQuery } from "@/queries/entities";
import { BlueprintDiscoverySection } from "./EconomyPage.blueprints";
import { CapTableSeedSection, type CapTableSeedRow } from "./EconomyPage.capTable";
import { EconomyMetricGrid } from "./EconomyPage.metrics";
import {
  CapitalReadinessSection,
  makePoolColumns,
  makeRoleColumns,
  makeTrustColumns,
  PoolKindChips,
  type PoolRow,
  RegistryCard,
  type RoleOpeningRow,
  RoleTypeChips,
  TrustDirectory,
  TrustVisibilityChips,
} from "./EconomyPage.parts";
import {
  ECONOMY_TABS,
  isEconomyTab,
  isPoolKind,
  isRoleType,
  isTrustVisibilityParam,
  matchesCapTableQuery,
  matchesPoolQuery,
  matchesRoleQuery,
  matchesTrustQuery,
  type PoolKind,
  type PoolKindFilter,
  type RoleTypeFilter,
  type TrustVisibilityFilter,
} from "./EconomyPage.utils";
import styles from "./EconomyPage.module.css";

type LaunchStatus = Awaited<ReturnType<typeof api.getLaunchStatus>>;
type CapTableStatus = Awaited<ReturnType<typeof api.getCapTable>>;

interface RoleLoadState {
  roles: Role[];
  loading: boolean;
}

interface LaunchLoadState {
  status: LaunchStatus | null;
  loading: boolean;
}

interface CapTableLoadState {
  entries: CapTableStatus["entries"];
  loading: boolean;
}

export default function EconomyPage() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const activeTab = isEconomyTab(tab) ? tab : "overview";
  const { data: entities = [], isLoading: entitiesLoading } = useEntitiesQuery();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get("q") ?? "";
  const setSearch = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams);
      if (next === "") params.delete("q");
      else params.set("q", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const kindParam = searchParams.get("kind");
  const poolKindFilter: PoolKindFilter = isPoolKind(kindParam) ? kindParam : "all";
  const setPoolKindFilter = useCallback(
    (next: PoolKindFilter) => {
      const params = new URLSearchParams(searchParams);
      if (next === "all") params.delete("kind");
      else params.set("kind", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const trustVisibilityFilter: TrustVisibilityFilter = isTrustVisibilityParam(
    searchParams.get("public"),
  )
    ? "public"
    : "all";
  const setTrustVisibilityFilter = useCallback(
    (next: TrustVisibilityFilter) => {
      const params = new URLSearchParams(searchParams);
      if (next === "all") params.delete("public");
      else params.set("public", "1");
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const roleTypeParam = searchParams.get("role_type");
  const roleTypeFilter: RoleTypeFilter = isRoleType(roleTypeParam) ? roleTypeParam : "all";
  const setRoleTypeFilter = useCallback(
    (next: RoleTypeFilter) => {
      const params = new URLSearchParams(searchParams);
      if (next === "all") params.delete("role_type");
      else params.set("role_type", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const [roleState, setRoleState] = useState<Record<string, RoleLoadState>>({});
  const [launchState, setLaunchState] = useState<Record<string, LaunchLoadState>>({});
  const [capTableState, setCapTableState] = useState<Record<string, CapTableLoadState>>({});

  useEffect(() => {
    if (entities.length === 0) {
      setRoleState({});
      setLaunchState({});
      setCapTableState({});
      return;
    }

    let cancelled = false;
    setRoleState((current) => {
      const next = { ...current };
      for (const entity of entities) {
        if (!next[entity.id]) next[entity.id] = { roles: [], loading: true };
      }
      return next;
    });
    setLaunchState((current) => {
      const next = { ...current };
      for (const entity of entities) {
        if (!next[entity.id]) next[entity.id] = { status: null, loading: true };
      }
      return next;
    });
    setCapTableState((current) => {
      const next = { ...current };
      for (const entity of entities) {
        if (!next[entity.id]) next[entity.id] = { entries: [], loading: true };
      }
      return next;
    });

    entities.forEach((entity) => {
      void api
        .getRoles(entity.id)
        .then((resp) => {
          if (cancelled) return;
          setRoleState((current) => ({
            ...current,
            [entity.id]: { roles: resp.roles ?? [], loading: false },
          }));
        })
        .catch(() => {
          if (cancelled) return;
          setRoleState((current) => ({
            ...current,
            [entity.id]: { roles: [], loading: false },
          }));
        });

      void api
        .getCapTable(entity.id)
        .then((resp) => {
          if (cancelled) return;
          setCapTableState((current) => ({
            ...current,
            [entity.id]: { entries: resp.entries ?? [], loading: false },
          }));
        })
        .catch(() => {
          if (cancelled) return;
          setCapTableState((current) => ({
            ...current,
            [entity.id]: { entries: [], loading: false },
          }));
        });

      void api
        .getLaunchStatus(entity.id)
        .then((status) => {
          if (cancelled) return;
          setLaunchState((current) => ({
            ...current,
            [entity.id]: { status, loading: false },
          }));
        })
        .catch(() => {
          if (cancelled) return;
          setLaunchState((current) => ({
            ...current,
            [entity.id]: { status: null, loading: false },
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [entities]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleTrusts = useMemo(
    () => entities.filter((entity) => matchesTrustQuery(entity, normalizedSearch)),
    [entities, normalizedSearch],
  );
  const visibleTrustsForTab = useMemo(
    () =>
      trustVisibilityFilter === "public"
        ? visibleTrusts.filter((trust) => trust.public)
        : visibleTrusts,
    [visibleTrusts, trustVisibilityFilter],
  );

  const allRoles = useMemo(
    () => Object.values(roleState).flatMap((state) => state.roles),
    [roleState],
  );
  const roleOpenings = useMemo<RoleOpeningRow[]>(
    () =>
      entities.flatMap((trust) =>
        (roleState[trust.id]?.roles ?? [])
          .filter((role) => role.occupant_kind === "vacant")
          .map((role) => ({ id: `${trust.id}:${role.id}`, trust, role })),
      ),
    [entities, roleState],
  );

  const capTableRows = useMemo<CapTableSeedRow[]>(
    () =>
      entities.flatMap((trust) =>
        (capTableState[trust.id]?.entries ?? []).map((entry) => ({
          id: `${trust.id}:${entry.id}`,
          trust,
          entry,
        })),
      ),
    [capTableState, entities],
  );

  const visibleCapTableRows = useMemo(
    () => capTableRows.filter((row) => matchesCapTableQuery(row, normalizedSearch)),
    [capTableRows, normalizedSearch],
  );

  const poolRows = useMemo<PoolRow[]>(
    () =>
      entities.flatMap((trust) => {
        const unifutures = launchState[trust.id]?.status?.unifutures;
        if (!unifutures) return [];
        return [
          {
            id: `${trust.id}:${unifutures.curve}`,
            trust,
            kind: "genesis" as const,
            curve: unifutures.curve,
            assetMint: unifutures.asset_mint,
            quoteMint: unifutures.quote_mint,
            buyAmount: unifutures.buy_amount,
            maxCost: unifutures.max_cost,
          },
        ];
      }),
    [entities, launchState],
  );

  const poolKindsPresent = useMemo<PoolKind[]>(
    () => (["genesis", "amm"] as PoolKind[]).filter((k) => poolRows.some((r) => r.kind === k)),
    [poolRows],
  );

  const visiblePoolRows = useMemo(
    () =>
      poolRows.filter(
        (row) =>
          (poolKindFilter === "all" || row.kind === poolKindFilter) &&
          matchesPoolQuery(row, normalizedSearch),
      ),
    [poolRows, normalizedSearch, poolKindFilter],
  );
  const roleTypesPresent = useMemo<RoleType[]>(
    () =>
      (["owner", "director", "operational", "advisor"] as RoleType[]).filter((t) =>
        roleOpenings.some((row) => row.role.role_type === t),
      ),
    [roleOpenings],
  );

  const visibleRoleOpenings = useMemo(
    () =>
      roleOpenings.filter(
        (row) =>
          (roleTypeFilter === "all" || row.role.role_type === roleTypeFilter) &&
          matchesRoleQuery(row, normalizedSearch),
      ),
    [roleOpenings, normalizedSearch, roleTypeFilter],
  );

  const publicTrusts = entities.filter((entity) => entity.public);
  const onChainTrusts = entities.filter((entity) => entity.trust_address);
  const visibleOnChainTrusts = visibleTrusts.filter((entity) => entity.trust_address);
  const liquiditySeedGaps = useMemo(
    () =>
      visibleTrusts.filter((trust) => {
        if (!trust.trust_address) return false;
        const launch = launchState[trust.id];
        if (launch?.loading) return false;
        return !launch?.status?.unifutures;
      }),
    [launchState, visibleTrusts],
  );
  const hasNonPublicTrust = entities.some((entity) => !entity.public);
  const hasSearch = normalizedSearch.length > 0;
  const loadingSecondaryData =
    Object.values(roleState).some((state) => state.loading) ||
    Object.values(launchState).some((state) => state.loading) ||
    Object.values(capTableState).some((state) => state.loading);

  const trustColumns = useMemo(
    () => makeTrustColumns((trust) => roleState[trust.id]?.roles.length),
    [roleState],
  );

  const poolColumns = useMemo(
    () => makePoolColumns((row) => navigate(entityPath(row.trust, "shares"))),
    [navigate],
  );

  const roleColumns = useMemo(
    () =>
      makeRoleColumns((row) =>
        navigate(`${entityBasePath(row.trust)}/roles/${encodeURIComponent(row.role.id)}`),
      ),
    [navigate],
  );

  return (
    <div className={styles.root}>
      <PageRail
        title="Economy"
        tabs={ECONOMY_TABS}
        defaultTab="overview"
        basePath="/economy"
        currentValue={activeTab}
      />
      <div className={styles.content}>
        <Page width="wide" padding="lg" gap="6">
          <PageHeader
            title="Economy"
            description="Discover Blueprints, public TRUSTs, open roles, and live capital surfaces across the operating graph."
            actions={
              <Button
                variant="primary"
                size="md"
                leadingIcon={<Blocks size={14} strokeWidth={1.5} />}
                onClick={() => navigate("/blueprints")}
              >
                Browse Blueprints
              </Button>
            }
          />

          <PageToolbar grow className={styles.toolbar}>
            <span className={styles.searchField}>
              <span className={styles.searchIcon} aria-hidden>
                <Search size={13} strokeWidth={1.6} />
              </span>
              <Input
                aria-label="Search trusts"
                placeholder="Search trusts, roles, pools, addresses"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={styles.searchInput}
              />
            </span>
            {activeTab === "pools" && poolKindsPresent.length > 0 && (
              <PoolKindChips
                kinds={poolKindsPresent}
                value={poolKindFilter}
                onChange={setPoolKindFilter}
              />
            )}
            {activeTab === "trusts" && hasNonPublicTrust && (
              <TrustVisibilityChips
                value={trustVisibilityFilter}
                onChange={setTrustVisibilityFilter}
              />
            )}
            {activeTab === "roles" && roleTypesPresent.length > 1 && (
              <RoleTypeChips
                roleTypes={roleTypesPresent}
                value={roleTypeFilter}
                onChange={setRoleTypeFilter}
              />
            )}
            {hasSearch && (
              <span className={styles.searchSummary}>
                {visibleTrusts.length} trusts / {visiblePoolRows.length} pools /{" "}
                {visibleCapTableRows.length} allocations / {visibleRoleOpenings.length} roles
              </span>
            )}
          </PageToolbar>

          <EconomyMetricGrid
            allRoleCount={allRoles.length}
            capTableRows={capTableRows}
            entities={entities}
            entitiesLoading={entitiesLoading}
            hasSearch={hasSearch}
            liquiditySeedGapCount={liquiditySeedGaps.length}
            onChainTrusts={onChainTrusts}
            publicTrusts={publicTrusts}
            roleOpenings={roleOpenings}
            visibleCapTableRows={visibleCapTableRows}
            visibleRoleOpenings={visibleRoleOpenings}
            visibleTrusts={visibleTrusts}
          />

          <PageBody gap="6">
            {activeTab === "overview" && (
              <>
                <CapitalReadinessSection
                  loading={loadingSecondaryData}
                  capTableRows={visibleCapTableRows}
                  totalTrusts={visibleTrusts.length}
                  onChainCount={visibleOnChainTrusts.length}
                  poolCount={visiblePoolRows.length}
                  riskTrusts={liquiditySeedGaps}
                  onOpenPools={() => navigate("/economy/pools")}
                  onOpenFunding={() => navigate("/economy/funding")}
                />
                <CapTableSeedSection
                  hasSearch={hasSearch}
                  loading={loadingSecondaryData}
                  rows={visibleCapTableRows}
                />
                <BlueprintDiscoverySection onBrowse={() => navigate("/blueprints")} />
                <TrustDirectory
                  trusts={visibleTrusts.slice(0, 6)}
                  loading={entitiesLoading}
                  onOpen={(trust) => navigate(entityBasePath(trust))}
                  onViewAll={() => navigate("/economy/trusts")}
                />
                <div className={styles.registryGrid}>
                  <RegistryCard
                    icon={<Droplets size={16} strokeWidth={1.6} />}
                    title="Liquidity pools"
                    value={poolRows.length}
                    tone="live"
                    body="Genesis curves and pool addresses appear once launch status confirms an on-chain pool."
                    onOpen={() => navigate("/economy/pools")}
                  />
                  <RegistryCard
                    icon={<BriefcaseBusiness size={16} strokeWidth={1.6} />}
                    title="Open roles"
                    value={visibleRoleOpenings.length}
                    tone="pending"
                    body="Vacant TRUST roles are the clearest path to join an operating company."
                    onOpen={() => navigate("/economy/roles")}
                  />
                </div>
              </>
            )}

            {activeTab === "trusts" && (
              <PageSection
                title="All visible trusts"
                description="Trusts you can operate or browse from this account. Public trusts link to their published profile."
              >
                <Table
                  columns={trustColumns}
                  data={visibleTrustsForTab}
                  rowKey={(trust) => trust.id}
                  onRowClick={(trust) => navigate(entityBasePath(trust))}
                  loading={entitiesLoading}
                  skeletonRows={5}
                  scrollWidth="md"
                  ariaLabel="Trust registry"
                  empty={
                    <EmptyState
                      title={
                        trustVisibilityFilter === "public" ? "No public trusts" : "No trusts found"
                      }
                      description={
                        trustVisibilityFilter === "public"
                          ? "Publish a trust profile to surface it here."
                          : "Create or publish a trust and it will appear here."
                      }
                    />
                  }
                />
              </PageSection>
            )}

            {activeTab === "pools" && (
              <PageSection
                title="Liquidity pools"
                description="Every indexed genesis curve attached to a visible trust. No row means Economy has no real seed surface to show."
              >
                <Table
                  columns={poolColumns}
                  data={visiblePoolRows}
                  rowKey={(row) => row.id}
                  onRowClick={(row) => navigate(entityPath(row.trust, "shares"))}
                  loading={loadingSecondaryData && visiblePoolRows.length === 0}
                  skeletonRows={3}
                  scrollWidth="lg"
                  ariaLabel="Liquidity pools"
                  empty={
                    <EmptyState
                      title={hasSearch ? "No matching pools" : "No indexed pools yet"}
                      description={
                        hasSearch
                          ? "Try a trust name, pool address, asset mint, or quote mint."
                          : "Pools appear here only after launch status confirms a provisioned genesis curve and asset mint. Until then, do not infer live liquidity or a seeded cap table from this page."
                      }
                    />
                  }
                />
              </PageSection>
            )}

            {activeTab === "funding" && (
              <PageSection
                title="Funding rounds"
                description="Commitment sales, bonding curves, and exits from the funding module once they are indexed."
              >
                <EmptyState
                  title="No indexed funding rounds yet"
                  description="The live indexer endpoint still needs to expose funding requests. Economy is intentionally not making fundraising or on-chain round claims before those rows exist."
                />
              </PageSection>
            )}

            {activeTab === "roles" && (
              <PageSection
                title="Open roles"
                description="Vacant trust roles that can become the apply surface."
              >
                <Table
                  columns={roleColumns}
                  data={visibleRoleOpenings}
                  rowKey={(row) => row.id}
                  onRowClick={(row) =>
                    navigate(
                      `${entityBasePath(row.trust)}/roles/${encodeURIComponent(row.role.id)}`,
                    )
                  }
                  loading={loadingSecondaryData && visibleRoleOpenings.length === 0}
                  skeletonRows={5}
                  scrollWidth="md"
                  ariaLabel="Open roles"
                  empty={
                    <EmptyState
                      title={
                        hasSearch || roleTypeFilter !== "all"
                          ? "No matching roles"
                          : "No open roles"
                      }
                      description={
                        hasSearch
                          ? roleTypesPresent.length > 1
                            ? "Try a role title, role type, trust name, or trust address."
                            : "Try a role title, trust name, or trust address."
                          : roleTypeFilter !== "all"
                            ? roleTypesPresent.length > 1
                              ? "Try another role type, or clear the filter to see every open role."
                              : "Clear the role-type filter to see every open role."
                            : "Vacant roles will appear here when trusts publish roles without occupants."
                      }
                    />
                  }
                />
              </PageSection>
            )}
          </PageBody>
        </Page>
      </div>
    </div>
  );
}
