import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowUpRight, BriefcaseBusiness, CircleDollarSign, Droplets, Search } from "lucide-react";
import TrustAvatar from "@/components/TrustAvatar";
import PageRail from "@/components/PageRail";
import {
  Badge,
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
import { entityBasePath } from "@/lib/entityPath";
import { formatInteger, formatMediumDate } from "@/lib/i18n";
import type { Role, Trust } from "@/lib/types";
import { useEntitiesQuery } from "@/queries/entities";
import { MetricStatus, RegistryCard, TrustDirectory } from "./EconomyPage.parts";
import {
  compactAddress,
  ECONOMY_TABS,
  isEconomyTab,
  matchesPoolQuery,
  matchesRoleQuery,
  matchesTrustQuery,
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

interface PoolRow {
  id: string;
  trust: Trust;
  curve: string;
  assetMint: string;
  quoteMint: string;
  buyAmount: number;
  maxCost: number;
}

interface RoleOpeningRow {
  id: string;
  trust: Trust;
  role: Role;
}

export default function EconomyPage() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const activeTab = isEconomyTab(tab) ? tab : "overview";
  const { data: entities = [], isLoading: entitiesLoading } = useEntitiesQuery();
  const [search, setSearch] = useState("");
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

  const visiblePoolRows = useMemo(
    () => poolRows.filter((row) => matchesPoolQuery(row, normalizedSearch)),
    [poolRows, normalizedSearch],
  );
  const visibleRoleOpenings = useMemo(
    () => roleOpenings.filter((row) => matchesRoleQuery(row, normalizedSearch)),
    [roleOpenings, normalizedSearch],
  );

  const publicTrusts = entities.filter((entity) => entity.public);
  const onChainTrusts = entities.filter((entity) => entity.trust_address);
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
          <Badge variant={trust.public ? "success" : "muted"} size="sm">
            {trust.public ? "Public" : "Private"}
          </Badge>
        ),
        width: "110px",
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
    () => [
      {
        key: "pool",
        header: "Pool",
        cell: (row) => (
          <span className={styles.trustCellText}>
            <span className={styles.trustName}>Genesis curve</span>
            <span className={styles.trustMeta}>{row.trust.name}</span>
          </span>
        ),
        sortable: true,
        sortAccessor: (row) => row.trust.name,
      },
      {
        key: "curve",
        header: "Curve",
        cell: (row) => <span className={styles.mono}>{compactAddress(row.curve)}</span>,
      },
      {
        key: "asset",
        header: "Asset",
        cell: (row) => <span className={styles.mono}>{compactAddress(row.assetMint)}</span>,
      },
      {
        key: "quote",
        header: "Quote",
        cell: (row) => <span className={styles.mono}>{compactAddress(row.quoteMint)}</span>,
      },
      {
        key: "buy",
        header: "First buy",
        cell: (row) => formatInteger(row.buyAmount),
        align: "end",
        width: "110px",
      },
      {
        key: "action",
        header: "",
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            trailingIcon={<ArrowUpRight size={13} strokeWidth={1.5} />}
            onClick={(event) => {
              event.stopPropagation();
              navigate(entityBasePath(row.trust));
            }}
          >
            Open
          </Button>
        ),
        width: "92px",
        align: "end",
      },
    ],
    [navigate],
  );

  const roleColumns = useMemo<Array<TableColumn<RoleOpeningRow>>>(
    () => [
      {
        key: "role",
        header: "Role",
        cell: (row) => (
          <span className={styles.trustCellText}>
            <span className={styles.trustName}>{row.role.title}</span>
            <span className={styles.trustMeta}>{row.trust.name}</span>
          </span>
        ),
        sortable: true,
        sortAccessor: (row) => row.role.title,
      },
      {
        key: "kind",
        header: "Type",
        cell: (row) => (
          <Badge variant="muted" size="sm">
            {row.role.role_type}
          </Badge>
        ),
        width: "130px",
      },
      {
        key: "created",
        header: "Opened",
        cell: (row) => formatMediumDate(row.role.created_at, { fallback: "Unknown" }),
        width: "140px",
        sortable: true,
        sortAccessor: (row) => row.role.created_at,
      },
      {
        key: "action",
        header: "",
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`${entityBasePath(row.trust)}/roles/${encodeURIComponent(row.role.id)}`);
            }}
          >
            Apply
          </Button>
        ),
        width: "96px",
        align: "end",
      },
    ],
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
                  data={visibleTrusts}
                  rowKey={(trust) => trust.id}
                  onRowClick={(trust) => navigate(entityBasePath(trust))}
                  loading={entitiesLoading}
                  skeletonRows={5}
                  scrollWidth="md"
                  ariaLabel="Trust registry"
                  empty={
                    <EmptyState
                      title="No trusts found"
                      description="Create or publish a trust and it will appear here."
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
                  onRowClick={(row) => navigate(entityBasePath(row.trust))}
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
                      title={hasSearch ? "No matching roles" : "No open roles"}
                      description={
                        hasSearch
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
