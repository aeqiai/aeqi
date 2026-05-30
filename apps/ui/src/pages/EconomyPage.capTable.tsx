import { EmptyState, PageSection, Table, type TableColumn } from "@/components/ui";
import type { CapTableEntry, Trust } from "@/lib/types";
import { TableStatus } from "./EconomyPage.parts";
import styles from "./EconomyPage.module.css";

export interface CapTableSeedRow {
  id: string;
  trust: Trust;
  entry: CapTableEntry;
}

const SECURITY_TYPE_LABEL: Record<string, string> = {
  common: "Common",
  vesting_common: "Founder vesting common",
  option_pool: "Option pool",
};

const HOLDER_KIND_LABEL: Record<string, string> = {
  creator: "Creator",
  unassigned: "Unassigned",
};

const ALLOCATION_KEY_LABEL: Record<string, string> = {
  creator_common: "Creator common",
  founder_vesting_common: "Founder vesting",
  option_pool: "Option pool",
};

function formatBasisPoints(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

function makeCapTableSeedColumns(): Array<TableColumn<CapTableSeedRow>> {
  return [
    {
      key: "trust",
      header: "Trust",
      cell: (row) => (
        <span className={styles.trustCellText}>
          <span className={styles.trustName}>{row.trust.name}</span>
          <span className={styles.trustMeta}>{row.trust.tagline || row.trust.plan || "TRUST"}</span>
        </span>
      ),
      sortable: true,
      sortAccessor: (row) => row.trust.name,
    },
    {
      key: "allocation",
      header: "Allocation",
      cell: (row) => (
        <span className={styles.trustCellText}>
          <span className={styles.trustName}>
            {ALLOCATION_KEY_LABEL[row.entry.allocation_key] ?? row.entry.allocation_key}
          </span>
          <span className={styles.trustMeta}>{row.entry.allocation_key}</span>
        </span>
      ),
      sortable: true,
      sortAccessor: (row) => row.entry.allocation_key,
    },
    {
      key: "holder",
      header: "Holder",
      cell: (row) => (
        <span className={styles.trustCellText}>
          <span className={styles.trustName}>
            {HOLDER_KIND_LABEL[row.entry.holder_kind] ?? row.entry.holder_kind}
          </span>
          <span className={styles.trustMeta}>{row.entry.holder_id || "Unassigned"}</span>
        </span>
      ),
      width: "160px",
    },
    {
      key: "security",
      header: "Security",
      cell: (row) => (
        <TableStatus
          state={row.entry.security_type === "option_pool" ? "in_review" : "done"}
          label={SECURITY_TYPE_LABEL[row.entry.security_type] ?? row.entry.security_type}
        />
      ),
      width: "170px",
    },
    {
      key: "share",
      header: "Share",
      cell: (row) => formatBasisPoints(row.entry.basis_points),
      width: "96px",
      align: "end",
      sortable: true,
      sortAccessor: (row) => row.entry.basis_points,
    },
    {
      key: "vesting",
      header: "Vesting",
      cell: (row) =>
        row.entry.vesting_months
          ? `${row.entry.vesting_months} mo / ${row.entry.cliff_months ?? 0} mo cliff`
          : "None",
      width: "150px",
    },
  ];
}

export function CapTableSeedSection({
  hasSearch,
  loading,
  rows,
}: {
  hasSearch: boolean;
  loading: boolean;
  rows: CapTableSeedRow[];
}) {
  return (
    <PageSection
      title="Cap-table seed rows"
      description="Default allocation rows recorded by AEQI. These are basis-point templates, not holder balances, minted supply, or live liquidity."
    >
      <Table
        columns={makeCapTableSeedColumns()}
        data={rows}
        rowKey={(row) => row.id}
        loading={loading && rows.length === 0}
        skeletonRows={3}
        density="compact"
        scrollWidth="md"
        ariaLabel="Cap-table seed rows"
        empty={
          <EmptyState
            title={hasSearch ? "No matching seed rows" : "No cap-table seed rows"}
            description={
              hasSearch
                ? "Try a trust name, allocation key, holder type, security type, or vesting term."
                : "New TRUSTs should expose creator or founder allocation rows once the orchestrator seed path runs."
            }
          />
        }
      />
    </PageSection>
  );
}
