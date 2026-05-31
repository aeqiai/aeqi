import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import CompanyAvatar from "@/components/CompanyAvatar";
import { Button, EmptyState, Loading, PageSection, type TableColumn } from "@/components/ui";
import { formatInteger, formatMediumDate } from "@/lib/i18n";
import type { Role, RoleType, Company } from "@/lib/types";
import type { CapTableSeedRow } from "./EconomyPage.capTable";
import {
  compactAddress,
  POOL_KIND_CHIP_LABEL,
  POOL_KIND_LABEL,
  ROLE_TYPE_CHIP_LABEL,
  type PoolKind,
  type PoolKindFilter,
  type RoleTypeFilter,
  type CompanyVisibilityFilter,
} from "./EconomyPage.utils";
import styles from "./EconomyPage.module.css";
export function CapitalReadinessSection({
  loading,
  capTableRows,
  onChainCount,
  poolCount,
  riskCompanies,
  totalCompanies,
  onOpenFunding,
  onOpenPools,
}: {
  loading: boolean;
  capTableRows: CapTableSeedRow[];
  onChainCount: number;
  poolCount: number;
  riskCompanies: Company[];
  totalCompanies: number;
  onOpenFunding: () => void;
  onOpenPools: () => void;
}) {
  const riskCount = riskCompanies.length;
  const hasRisk = !loading && riskCount > 0;
  const trustNoun = totalCompanies === 1 ? "COMPANY" : "Companies";
  const riskNoun = riskCount === 1 ? "COMPANY" : "Companies";
  const riskVerb = riskCount === 1 ? "has" : "have";
  const allocationNoun = capTableRows.length === 1 ? "allocation" : "allocations";

  return (
    <PageSection
      title="Capital readiness"
      description="Markets reads current entities, orchestrator cap-table seed rows, and launch status. It separates intended allocations from on-chain pool and funding claims."
    >
      <div className={styles.capitalReadiness}>
        {hasRisk && (
          <div className={styles.capitalRisk} role="alert">
            <span className={styles.capitalRiskIcon} aria-hidden>
              <AlertTriangle size={16} strokeWidth={1.7} />
            </span>
            <span className={styles.capitalRiskText}>
              <span className={styles.capitalRiskTitle}>Liquidity seed not confirmed</span>
              <span className={styles.capitalRiskCopy}>
                {riskCount} on-chain {riskNoun} {riskVerb} no Unifutures seed surface in launch
                status. Markets can show allocation templates, but it must stay quiet about live
                liquidity and funding until real rows are indexed.
              </span>
            </span>
          </div>
        )}

        <div className={styles.capitalSignalGrid} aria-label="Capital readiness signals">
          <span className={styles.capitalSignal}>
            <span className={styles.capitalSignalHead}>
              <span className={styles.capitalSignalLabel}>COMPANY identity</span>
              <TableStatus
                state={onChainCount > 0 ? "done" : loading ? "in_progress" : "backlog"}
                label={
                  loading
                    ? "Checking"
                    : onChainCount > 0
                      ? `${onChainCount} on-chain`
                      : "Not bridged"
                }
              />
            </span>
            <span className={styles.capitalSignalBody}>
              {totalCompanies} visible {trustNoun}; COMPANY addresses are shown only when the entity
              API returns them.
            </span>
          </span>

          <span className={styles.capitalSignal}>
            <span className={styles.capitalSignalHead}>
              <span className={styles.capitalSignalLabel}>Cap-table seed</span>
              <TableStatus
                state={
                  loading
                    ? "in_progress"
                    : hasRisk
                      ? "in_review"
                      : capTableRows.length > 0
                        ? "done"
                        : "backlog"
                }
                label={
                  loading
                    ? "Checking"
                    : capTableRows.length > 0
                      ? `${capTableRows.length} ${allocationNoun}`
                      : "No seed rows"
                }
              />
            </span>
            <span className={styles.capitalSignalBody}>
              Seed rows prove the intended allocation model. On-chain vesting and mint status are
              separate confirmations.
              {poolCount > 0 ? ` ${poolCount} Unifutures seed surface indexed.` : ""}
            </span>
          </span>

          <span className={styles.capitalSignal}>
            <span className={styles.capitalSignalHead}>
              <span className={styles.capitalSignalLabel}>Funding index</span>
              <TableStatus state="backlog" label="Endpoint pending" />
            </span>
            <span className={styles.capitalSignalBody}>
              Declared funding rounds are intentionally absent from Markets until the funding
              indexer publishes them.
            </span>
          </span>
        </div>

        <div className={styles.capitalActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenPools}
            trailingIcon={<ArrowUpRight size={13} strokeWidth={1.5} />}
          >
            Pools
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenFunding}
            trailingIcon={<ArrowUpRight size={13} strokeWidth={1.5} />}
          >
            Funding
          </Button>
        </div>
      </div>
    </PageSection>
  );
}

export interface RoleOpeningRow {
  id: string;
  company: Company;
  role: Role;
}

export function makeCompanyColumns(getRoleCount: (company: Company) => number | undefined) {
  return [
    {
      key: "company",
      header: "Company",
      cell: (company) => (
        <span className={styles.trustCell}>
          <CompanyAvatar name={company.name} size={28} />
          <span className={styles.trustCellText}>
            <span className={styles.trustName}>{company.name}</span>
            <span className={styles.trustMeta}>
              {company.tagline || company.plan || "Operating company"}
            </span>
          </span>
        </span>
      ),
      sortable: true,
      sortAccessor: (company) => company.name,
    },
    {
      key: "public",
      header: "Public",
      cell: (company) => (
        <TableStatus
          state={company.public ? "done" : "backlog"}
          label={company.public ? "Public" : "Private"}
        />
      ),
      width: "96px",
      sortable: true,
      sortAccessor: (company) => (company.public ? 1 : 0),
    },
    {
      key: "address",
      header: "COMPANY",
      cell: (company) => (
        <span className={styles.mono}>{compactAddress(company.company_address)}</span>
      ),
      width: "150px",
    },
    {
      key: "roles",
      header: "Roles",
      cell: (company) => getRoleCount(company) ?? "-",
      width: "90px",
      align: "end",
      sortable: true,
      sortAccessor: (company) => getRoleCount(company) ?? 0,
    },
    {
      key: "created",
      header: "Created",
      cell: (company) => formatMediumDate(company.created_at, { fallback: "Unknown" }),
      width: "140px",
      sortable: true,
      sortAccessor: (company) => company.created_at,
    },
  ] satisfies Array<TableColumn<Company>>;
}

const ROLE_TYPE_DOT_STATE: Record<RoleType, MetricStatusState> = {
  owner: "done",
  director: "in_progress",
  advisor: "in_review",
  operational: "backlog",
};

export function makeRoleColumns(
  onApply: (row: RoleOpeningRow) => void,
): Array<TableColumn<RoleOpeningRow>> {
  return [
    {
      key: "role",
      header: "Role",
      cell: (row) => (
        <span className={styles.trustCellText}>
          <span className={styles.trustName}>{row.role.title}</span>
          <span className={styles.trustMeta}>{row.company.name}</span>
        </span>
      ),
      sortable: true,
      sortAccessor: (row) => row.role.title,
    },
    {
      key: "kind",
      header: "Type",
      cell: (row) => (
        <TableStatus
          state={ROLE_TYPE_DOT_STATE[row.role.role_type]}
          label={ROLE_TYPE_CHIP_LABEL[row.role.role_type]}
        />
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
            onApply(row);
          }}
        >
          Apply
        </Button>
      ),
      width: "96px",
      align: "end",
    },
  ];
}

export interface PoolRow {
  id: string;
  company: Company;
  kind: PoolKind;
  curve: string;
  assetMint: string;
  quoteMint: string;
  buyAmount: number;
  maxCost: number;
}

export function makePoolColumns(onOpen: (row: PoolRow) => void): Array<TableColumn<PoolRow>> {
  return [
    {
      key: "pool",
      header: "Pool",
      cell: (row) => (
        <span className={styles.trustCellText}>
          <span className={styles.trustName}>{POOL_KIND_LABEL[row.kind]}</span>
          <span className={styles.trustMeta}>{row.company.name}</span>
        </span>
      ),
      sortable: true,
      sortAccessor: (row) => row.company.name,
    },
    {
      key: "liquidity",
      header: "Liquidity",
      cell: (row) => (
        <TableStatus
          state={row.buyAmount > 0 ? "in_progress" : "backlog"}
          label={row.buyAmount > 0 ? "Bonded" : "Dormant"}
        />
      ),
      width: "108px",
      sortable: true,
      sortAccessor: (row) => (row.buyAmount > 0 ? 1 : 0),
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
            onOpen(row);
          }}
        >
          Open
        </Button>
      ),
      width: "92px",
      align: "end",
    },
  ];
}

function FilterChips<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className={styles.kindChips} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`${styles.kindChip}${active ? ` ${styles.kindChipActive}` : ""}`}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function PoolKindChips({
  kinds,
  value,
  onChange,
}: {
  kinds: PoolKind[];
  value: PoolKindFilter;
  onChange: (next: PoolKindFilter) => void;
}) {
  const options = (["all", ...kinds] as PoolKindFilter[]).map((id) => ({
    id,
    label: id === "all" ? "All" : POOL_KIND_CHIP_LABEL[id],
  }));
  return <FilterChips ariaLabel="Pool kind" options={options} value={value} onChange={onChange} />;
}

export function CompanyVisibilityChips({
  value,
  onChange,
}: {
  value: CompanyVisibilityFilter;
  onChange: (next: CompanyVisibilityFilter) => void;
}) {
  const options: Array<{ id: CompanyVisibilityFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "public", label: "Public only" },
  ];
  return (
    <FilterChips
      ariaLabel="Company visibility"
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

export function RoleTypeChips({
  roleTypes,
  value,
  onChange,
}: {
  roleTypes: RoleType[];
  value: RoleTypeFilter;
  onChange: (next: RoleTypeFilter) => void;
}) {
  const options = (["all", ...roleTypes] as RoleTypeFilter[]).map((id) => ({
    id,
    label: id === "all" ? "All" : ROLE_TYPE_CHIP_LABEL[id],
  }));
  return <FilterChips ariaLabel="Role type" options={options} value={value} onChange={onChange} />;
}

export function CompanyDirectory({
  companies,
  loading,
  onOpen,
  onViewAll,
}: {
  companies: Company[];
  loading: boolean;
  onOpen: (company: Company) => void;
  onViewAll: () => void;
}) {
  return (
    <PageSection
      title="COMPANY directory"
      description="Inspect programmable companies that can be operated, joined, or used as launch references."
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={onViewAll}
          trailingIcon={<ArrowUpRight size={13} strokeWidth={1.5} />}
        >
          All Companies
        </Button>
      }
    >
      {loading ? (
        <div className={styles.loadingRow}>
          <Loading size="sm" /> Loading companies...
        </div>
      ) : companies.length === 0 ? (
        <EmptyState
          title="No companies found"
          description="No company matches the current search."
        />
      ) : (
        <div className={styles.trustGrid}>
          {companies.map((company) => (
            <article key={company.id} className={styles.trustCard}>
              <button
                type="button"
                className={styles.trustCardMain}
                onClick={() => onOpen(company)}
              >
                <span className={styles.trustCardHead}>
                  <CompanyAvatar name={company.name} size={36} />
                  <span className={styles.trustCellText}>
                    <span className={styles.trustName}>{company.name}</span>
                    <span className={styles.trustMeta}>
                      {company.tagline || "Operating company"}
                    </span>
                  </span>
                </span>
              </button>
              <span className={styles.trustCardFoot}>
                <span className={styles.trustStatus}>
                  <span
                    className={`quest-status-dot quest-status-dot--${
                      company.public ? "done" : "backlog"
                    }`}
                    aria-hidden
                  />
                  <span className={styles.trustStatusLabel}>
                    {company.public ? "Public" : "Private"}
                  </span>
                </span>
                {company.public && (
                  <Link to={`/${encodeURIComponent(company.id)}`} className={styles.publicLink}>
                    Profile
                  </Link>
                )}
                {!company.public && <span className={styles.publicLink}>Open COMPANY</span>}
              </span>
            </article>
          ))}
        </div>
      )}
    </PageSection>
  );
}

export type RegistryTone = "live" | "pending" | "settled";

const TONE_TO_DOT: Record<RegistryTone, string> = {
  live: "in_progress",
  pending: "in_review",
  settled: "done",
};

export type MetricStatusState = "backlog" | "in_progress" | "in_review" | "done";

export function MetricStatus({ state, label }: { state: MetricStatusState; label: string }) {
  return (
    <span className={styles.metricStatus}>
      <span className={`quest-status-dot quest-status-dot--${state}`} aria-hidden />
      <span className={styles.metricStatusLabel}>{label}</span>
    </span>
  );
}

export function TableStatus({ state, label }: { state: MetricStatusState; label: string }) {
  return (
    <span className={styles.tableStatus}>
      <span className={`quest-status-dot quest-status-dot--${state}`} aria-hidden />
      <span className={styles.tableStatusLabel}>{label}</span>
    </span>
  );
}

function registryToneLabel(tone: RegistryTone, value: number): string {
  if (value === 0) {
    if (tone === "live") return "No live offers";
    if (tone === "pending") return "None pending";
    return "Nothing settled";
  }
  if (tone === "live") return value === 1 ? "1 live" : `${value} live`;
  if (tone === "pending") return value === 1 ? "1 pending" : `${value} pending`;
  return value === 1 ? "1 settled" : `${value} settled`;
}

export function RegistryCard({
  icon,
  title,
  value,
  body,
  tone,
  onOpen,
}: {
  icon: ReactNode;
  title: string;
  value: number;
  body: string;
  tone: RegistryTone;
  onOpen: () => void;
}) {
  const dotState = value === 0 ? "backlog" : TONE_TO_DOT[tone];
  return (
    <button type="button" className={styles.registryCard} onClick={onOpen}>
      <span className={styles.registryCardHead}>
        <span className={styles.registryIcon}>{icon}</span>
        <span className={styles.registryTitle}>{title}</span>
        <span className={styles.registryValue}>{value}</span>
      </span>
      <span className={styles.registryStatus}>
        <span className={`quest-status-dot quest-status-dot--${dotState}`} aria-hidden />
        <span className={styles.registryStatusLabel}>{registryToneLabel(tone, value)}</span>
      </span>
      <span className={styles.registryBody}>{body}</span>
    </button>
  );
}
