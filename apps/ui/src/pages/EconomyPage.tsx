import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BriefcaseBusiness, CircleDollarSign, Droplets, Search } from "lucide-react";
import TrustAvatar from "@/components/TrustAvatar";
import PageRail from "@/components/PageRail";
import {
  Button,
  EmptyState,
  Input,
  MetricCard,
  MetricGrid,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Table,
  type TableColumn,
} from "@/components/ui";
import { api } from "@/lib/api";
import { entityBasePath, entityPath } from "@/lib/entityPath";
import { formatMediumDate } from "@/lib/i18n";
import type { Role, RoleType, Trust } from "@/lib/types";
import { useEntitiesQuery } from "@/queries/entities";
import {
  makePoolColumns,
  makeRoleColumns,
  MetricStatus,
  PoolKindChips,
  type PoolRow,
  RegistryCard,
  type RoleOpeningRow,
  RoleTypeChips,
  TableStatus,
  TrustDirectory,
  TrustVisibilityChips,
} from "./EconomyPage.parts";
import {
  compactAddress,
  ECONOMY_TABS,
  isEconomyTab,
  isPoolKind,
  isRoleType,
  isTrustVisibilityParam,
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

interface RoleLoadState {
  roles: Role[];
  loading: boolean;
}

interface LaunchLoadState {
  status: LaunchStatus | null;
  loading: boolean;
}

export default function EconomyPage() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const activeTab = isEconomyTab(tab) ? tab : "overview";
  const { data: entities = [], isLoading: entitiesLoading } = useEntitiesQuery();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search query round-trips through `?q=` so a filtered Economy view is
  // bookmarkable / shareable. Mirrors Blueprints' `?q=` convention. Empty
  // string means no filter.
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

  // Pool kind chip selection round-trips through `?kind=genesis|amm` so a
  // refresh keeps the operator's scope. Missing/invalid param = "all".
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

  // Trusts-tab visibility chip round-trips through `?public=1` so the
  // scoped slice is bookmarkable. Maps directly to the Public TableStatus
  // column. Missing/invalid param = "all".
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

  // Roles-tab role-type chip selection round-trips through
  // `?role_type=owner|director|operational|advisor` so a refresh keeps the
  // operator's scope. Mirrors the `?kind=` multi-value pattern: missing or
  // invalid param = "all".
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

  useEffect(() => {
    if (entities.length === 0) {
      setRoleState({});
      setLaunchState({});
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
  // The visibility chip is a trusts-tab-scoped narrow on top of the search.
  // Overview cards and the search summary keep the search-only count so the
  // chip never silently filters surfaces it isn't visible on.
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

  // Kinds present in the indexed pool set, stable order. Chip strip renders
  // only when >= 1 kind is present; today this is "All | Genesis" — a
  // no-op selector that documents the axis and is ready for AMM rows.
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
  // Role types present in the visible openings set, stable order. Chip strip
  // renders only when >= 1 type is present so the row stays calm when one
  // tier dominates today's vacancies.
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
  const hasNonPublicTrust = entities.some((entity) => !entity.public);
  const hasSearch = normalizedSearch.length > 0;
  const loadingSecondaryData =
    Object.values(roleState).some((state) => state.loading) ||
    Object.values(launchState).some((state) => state.loading);

  const trustColumns = useMemo<Array<TableColumn<Trust>>>(
    () => [
      {
        key: "trust",
        header: "Trust",
        cell: (trust) => (
          <span className={styles.trustCell}>
            <TrustAvatar name={trust.name} size={28} />
            <span className={styles.trustCellText}>
              <span className={styles.trustName}>{trust.name}</span>
              <span className={styles.trustMeta}>
                {trust.tagline || trust.plan || "Operating trust"}
              </span>
            </span>
          </span>
        ),
        sortable: true,
        sortAccessor: (trust) => trust.name,
      },
      {
        key: "public",
        header: "Public",
        cell: (trust) => (
          <TableStatus
            state={trust.public ? "done" : "backlog"}
            label={trust.public ? "Public" : "Private"}
          />
        ),
        width: "96px",
        sortable: true,
        sortAccessor: (trust) => (trust.public ? 1 : 0),
      },
      {
        key: "address",
        header: "TRUST",
        cell: (trust) => <span className={styles.mono}>{compactAddress(trust.trust_address)}</span>,
        width: "150px",
      },
      {
        key: "roles",
        header: "Roles",
        cell: (trust) => roleState[trust.id]?.roles.length ?? "—",
        width: "90px",
        align: "end",
        sortable: true,
        sortAccessor: (trust) => roleState[trust.id]?.roles.length ?? 0,
      },
      {
        key: "created",
        header: "Created",
        cell: (trust) => formatMediumDate(trust.created_at, { fallback: "Unknown" }),
        width: "140px",
        sortable: true,
        sortAccessor: (trust) => trust.created_at,
      },
    ],
    [roleState],
  );

  const poolColumns = useMemo<Array<TableColumn<PoolRow>>>(
    () => makePoolColumns((row) => navigate(entityPath(row.trust, "equity"))),
    [navigate],
  );

  const roleColumns = useMemo<Array<TableColumn<RoleOpeningRow>>>(
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
            description="Browse the public operating layer: trusts, live liquidity, funding surfaces, and roles that can be filled."
            actions={
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<BriefcaseBusiness size={14} strokeWidth={1.5} />}
                onClick={() => navigate("/launch")}
              >
                New Trust
              </Button>
            }
          />

          <div className={styles.toolbar}>
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
            {activeTab === "roles" && roleTypesPresent.length > 0 && (
              <RoleTypeChips
                roleTypes={roleTypesPresent}
                value={roleTypeFilter}
                onChange={setRoleTypeFilter}
              />
            )}
            {hasSearch && (
              <span className={styles.searchSummary}>
                {visibleTrusts.length} trusts / {visiblePoolRows.length} pools /{" "}
                {visibleRoleOpenings.length} roles
              </span>
            )}
          </div>

          <MetricGrid columns={4}>
            <MetricCard
              label="Visible Trusts"
              value={entitiesLoading ? "—" : entities.length}
              detail={
                hasSearch ? (
                  <MetricStatus state="in_progress" label={`${visibleTrusts.length} matching`} />
                ) : publicTrusts.length > 0 ? (
                  <MetricStatus state="done" label={`${publicTrusts.length} public`} />
                ) : (
                  <MetricStatus state="backlog" label="No public trusts" />
                )
              }
            />
            <MetricCard
              label="On-Chain"
              value={onChainTrusts.length}
              detail={
                onChainTrusts.length > 0 ? (
                  <MetricStatus state="done" label="TRUST address present" />
                ) : (
                  <MetricStatus state="backlog" label="No TRUST address" />
                )
              }
            />
            <MetricCard
              label="Liquidity Pools"
              value={poolRows.length}
              detail={
                hasSearch ? (
                  <MetricStatus state="in_progress" label={`${visiblePoolRows.length} matching`} />
                ) : poolRows.length > 0 ? (
                  <MetricStatus state="in_progress" label="Indexed genesis curves" />
                ) : (
                  <MetricStatus state="backlog" label="No indexed pools" />
                )
              }
            />
            <MetricCard
              label="Open Roles"
              value={roleOpenings.length}
              detail={
                hasSearch ? (
                  <MetricStatus
                    state="in_progress"
                    label={`${visibleRoleOpenings.length} matching`}
                  />
                ) : roleOpenings.length > 0 ? (
                  <MetricStatus state="in_review" label={`${allRoles.length} total roles`} />
                ) : (
                  <MetricStatus state="backlog" label={`${allRoles.length} total roles`} />
                )
              }
            />
          </MetricGrid>

          <PageBody gap="6">
            {activeTab === "overview" && (
              <>
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
                    body="Genesis curves and pool addresses surface here as soon as launch status confirms the on-chain pool."
                    onOpen={() => navigate("/economy/pools")}
                  />
                  <RegistryCard
                    icon={<CircleDollarSign size={16} strokeWidth={1.6} />}
                    title="Funding rounds"
                    value={0}
                    tone="pending"
                    body="The funding module lane is wired into the economy surface; live rounds land here when the indexer exposes funding requests."
                    onOpen={() => navigate("/economy/funding")}
                  />
                  <RegistryCard
                    icon={<BriefcaseBusiness size={16} strokeWidth={1.6} />}
                    title="Open roles"
                    value={visibleRoleOpenings.length}
                    tone="pending"
                    body="Vacant roles across visible trusts become the apply surface for joining a trust."
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
                description="Every indexed genesis curve attached to a visible trust."
              >
                <Table
                  columns={poolColumns}
                  data={visiblePoolRows}
                  rowKey={(row) => row.id}
                  onRowClick={(row) => navigate(entityPath(row.trust, "equity"))}
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
                          : "Pools appear here after launch status confirms a provisioned genesis curve."
                      }
                    />
                  }
                />
              </PageSection>
            )}

            {activeTab === "funding" && (
              <PageSection
                title="Funding rounds"
                description="Commitment sales, bonding curves, and exits from the funding module."
              >
                <EmptyState
                  title="No indexed funding rounds yet"
                  description="The page is ready for funding-module rows; the live indexer endpoint still needs to expose funding requests."
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
                        hasSearch || roleTypeFilter !== "all"
                          ? "Try a role title, role type, trust name, or trust address."
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
