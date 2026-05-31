import { useCallback, useMemo } from "react";
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
import { entityBasePath, entityPath } from "@/lib/entityPath";
import type { RoleType } from "@/lib/types";
import { useEntitiesQuery } from "@/queries/entities";
import { TemplateDiscoverySection } from "./EconomyPage.blueprints";
import { CapTableSeedSection, type CapTableSeedRow } from "./EconomyPage.capTable";
import { useEconomyEntityData } from "./EconomyPage.entityData";
import { EconomyMetricGrid } from "./EconomyPage.metrics";
import {
  CapitalReadinessSection,
  makePoolColumns,
  makeRoleColumns,
  makeCompanyColumns,
  PoolKindChips,
  type PoolRow,
  RegistryCard,
  type RoleOpeningRow,
  RoleTypeChips,
  CompanyDirectory,
  CompanyVisibilityChips,
} from "./EconomyPage.parts";
import {
  ECONOMY_TABS,
  isEconomyTab,
  isPoolKind,
  isRoleType,
  isCompanyVisibilityParam,
  matchesCapTableQuery,
  matchesPoolQuery,
  matchesRoleQuery,
  matchesCompanyQuery,
  type PoolKind,
  type PoolKindFilter,
  type RoleTypeFilter,
  type CompanyVisibilityFilter,
} from "./EconomyPage.utils";
import styles from "./EconomyPage.module.css";

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

  const trustVisibilityFilter: CompanyVisibilityFilter = isCompanyVisibilityParam(
    searchParams.get("public"),
  )
    ? "public"
    : "all";
  const setCompanyVisibilityFilter = useCallback(
    (next: CompanyVisibilityFilter) => {
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
  const { roleState, launchState, capTableState } = useEconomyEntityData(entities);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleCompanies = useMemo(
    () => entities.filter((entity) => matchesCompanyQuery(entity, normalizedSearch)),
    [entities, normalizedSearch],
  );
  const visibleCompaniesForTab = useMemo(
    () =>
      trustVisibilityFilter === "public"
        ? visibleCompanies.filter((company) => company.public)
        : visibleCompanies,
    [visibleCompanies, trustVisibilityFilter],
  );

  const allRoles = useMemo(
    () => Object.values(roleState).flatMap((state) => state.roles),
    [roleState],
  );
  const roleOpenings = useMemo<RoleOpeningRow[]>(
    () =>
      entities.flatMap((company) =>
        (roleState[company.id]?.roles ?? [])
          .filter((role) => role.occupant_kind === "vacant")
          .map((role) => ({ id: `${company.id}:${role.id}`, company, role })),
      ),
    [entities, roleState],
  );

  const capTableRows = useMemo<CapTableSeedRow[]>(
    () =>
      entities.flatMap((company) =>
        (capTableState[company.id]?.entries ?? []).map((entry) => ({
          id: `${company.id}:${entry.id}`,
          company,
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
      entities.flatMap((company) => {
        const unifutures = launchState[company.id]?.status?.unifutures;
        if (!unifutures) return [];
        return [
          {
            id: `${company.id}:${unifutures.curve}`,
            company,
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

  const publicCompanies = entities.filter((entity) => entity.public);
  const onChainCompanies = entities.filter((entity) => entity.company_address);
  const visibleOnChainCompanies = visibleCompanies.filter((entity) => entity.company_address);
  const liquiditySeedGaps = useMemo(
    () =>
      visibleCompanies.filter((company) => {
        if (!company.company_address) return false;
        const launch = launchState[company.id];
        if (launch?.loading) return false;
        return !launch?.status?.unifutures;
      }),
    [launchState, visibleCompanies],
  );
  const hasNonPublicCompany = entities.some((entity) => !entity.public);
  const hasSearch = normalizedSearch.length > 0;
  const loadingSecondaryData =
    Object.values(roleState).some((state) => state.loading) ||
    Object.values(launchState).some((state) => state.loading) ||
    Object.values(capTableState).some((state) => state.loading);

  const trustColumns = useMemo(
    () => makeCompanyColumns((company) => roleState[company.id]?.roles.length),
    [roleState],
  );

  const poolColumns = useMemo(
    () => makePoolColumns((row) => navigate(entityPath(row.company, "shares"))),
    [navigate],
  );

  const roleColumns = useMemo(
    () =>
      makeRoleColumns((row) =>
        navigate(`${entityBasePath(row.company)}/roles/${encodeURIComponent(row.role.id)}`),
      ),
    [navigate],
  );

  return (
    <div className={styles.root}>
      <PageRail
        title="Markets"
        tabs={ECONOMY_TABS}
        defaultTab="overview"
        basePath="/markets"
        currentValue={activeTab}
      />
      <div className={styles.content}>
        <Page width="wide" padding="lg" gap="6">
          <PageHeader
            title="Markets"
            description="Discover Templates, public Companies, open roles, and live capital surfaces across the operating graph."
            actions={
              <Button
                variant="primary"
                size="md"
                leadingIcon={<Blocks size={14} strokeWidth={1.5} />}
                onClick={() => navigate("/templates")}
              >
                Browse Templates
              </Button>
            }
          />

          <PageToolbar grow className={styles.toolbar}>
            <span className={styles.searchField}>
              <span className={styles.searchIcon} aria-hidden>
                <Search size={13} strokeWidth={1.6} />
              </span>
              <Input
                aria-label="Search companies"
                placeholder="Search companies, roles, pools, addresses"
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
            {activeTab === "companies" && hasNonPublicCompany && (
              <CompanyVisibilityChips
                value={trustVisibilityFilter}
                onChange={setCompanyVisibilityFilter}
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
                {visibleCompanies.length} companies / {visiblePoolRows.length} pools /{" "}
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
            onChainCompanies={onChainCompanies}
            publicCompanies={publicCompanies}
            roleOpenings={roleOpenings}
            visibleCapTableRows={visibleCapTableRows}
            visibleRoleOpenings={visibleRoleOpenings}
            visibleCompanies={visibleCompanies}
          />

          <PageBody gap="6">
            {activeTab === "overview" && (
              <>
                <CapitalReadinessSection
                  loading={loadingSecondaryData}
                  capTableRows={visibleCapTableRows}
                  totalCompanies={visibleCompanies.length}
                  onChainCount={visibleOnChainCompanies.length}
                  poolCount={visiblePoolRows.length}
                  riskCompanies={liquiditySeedGaps}
                  onOpenPools={() => navigate("/markets/pools")}
                  onOpenFunding={() => navigate("/markets/funding")}
                />
                <CapTableSeedSection
                  hasSearch={hasSearch}
                  loading={loadingSecondaryData}
                  rows={visibleCapTableRows}
                />
                <TemplateDiscoverySection onBrowse={() => navigate("/templates")} />
                <CompanyDirectory
                  companies={visibleCompanies.slice(0, 6)}
                  loading={entitiesLoading}
                  onOpen={(company) => navigate(entityBasePath(company))}
                  onViewAll={() => navigate("/markets/companies")}
                />
                <div className={styles.registryGrid}>
                  <RegistryCard
                    icon={<Droplets size={16} strokeWidth={1.6} />}
                    title="Liquidity pools"
                    value={poolRows.length}
                    tone="live"
                    body="Genesis curves and pool addresses appear once launch status confirms an on-chain pool."
                    onOpen={() => navigate("/markets/pools")}
                  />
                  <RegistryCard
                    icon={<BriefcaseBusiness size={16} strokeWidth={1.6} />}
                    title="Open roles"
                    value={visibleRoleOpenings.length}
                    tone="pending"
                    body="Vacant COMPANY roles are the clearest path to join an operating company."
                    onOpen={() => navigate("/markets/roles")}
                  />
                </div>
              </>
            )}

            {activeTab === "companies" && (
              <PageSection
                title="All visible companies"
                description="Companies you can operate or browse from this account. Public companies link to their published profile."
              >
                <Table
                  columns={trustColumns}
                  data={visibleCompaniesForTab}
                  rowKey={(company) => company.id}
                  onRowClick={(company) => navigate(entityBasePath(company))}
                  loading={entitiesLoading}
                  skeletonRows={5}
                  scrollWidth="md"
                  ariaLabel="Company registry"
                  empty={
                    <EmptyState
                      title={
                        trustVisibilityFilter === "public"
                          ? "No public companies"
                          : "No companies found"
                      }
                      description={
                        trustVisibilityFilter === "public"
                          ? "Publish a company profile to surface it here."
                          : "Create or publish a company and it will appear here."
                      }
                    />
                  }
                />
              </PageSection>
            )}

            {activeTab === "pools" && (
              <PageSection
                title="Liquidity pools"
                description="Every indexed genesis curve attached to a visible company. No row means Markets has no real seed surface to show."
              >
                <Table
                  columns={poolColumns}
                  data={visiblePoolRows}
                  rowKey={(row) => row.id}
                  onRowClick={(row) => navigate(entityPath(row.company, "shares"))}
                  loading={loadingSecondaryData && visiblePoolRows.length === 0}
                  skeletonRows={3}
                  scrollWidth="lg"
                  ariaLabel="Liquidity pools"
                  empty={
                    <EmptyState
                      title={hasSearch ? "No matching pools" : "No indexed pools yet"}
                      description={
                        hasSearch
                          ? "Try a company name, pool address, asset mint, or quote mint."
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
                  description="The live indexer endpoint still needs to expose funding requests. Markets is intentionally not making fundraising or on-chain round claims before those rows exist."
                />
              </PageSection>
            )}

            {activeTab === "roles" && (
              <PageSection
                title="Open roles"
                description="Vacant company roles that can become the apply surface."
              >
                <Table
                  columns={roleColumns}
                  data={visibleRoleOpenings}
                  rowKey={(row) => row.id}
                  onRowClick={(row) =>
                    navigate(
                      `${entityBasePath(row.company)}/roles/${encodeURIComponent(row.role.id)}`,
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
                            ? "Try a role title, role type, company name, or company address."
                            : "Try a role title, company name, or company address."
                          : roleTypeFilter !== "all"
                            ? roleTypesPresent.length > 1
                              ? "Try another role type, or clear the filter to see every open role."
                              : "Clear the role-type filter to see every open role."
                            : "Vacant roles will appear here when companies publish roles without occupants."
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
